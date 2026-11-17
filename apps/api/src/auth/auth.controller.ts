import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { AuthService } from "./auth.service.js";
import { Public, Req } from "../common/guards.js";
import type { AppRequest } from "../common/context.js";
import { parse, zUuid } from "../common/zod.js";

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("auth/otp/request")
  @HttpCode(200)
  request(@Body() body: unknown) {
    const b = parse(z.object({ destination: z.string().min(5).max(254) }), body);
    return this.auth.requestLoginOtp(b.destination);
  }

  @Public()
  @Post("auth/otp/verify")
  @HttpCode(200)
  verify(@Req() req: AppRequest, @Body() body: unknown) {
    const b = parse(
      z.object({ challenge_id: zUuid, code: z.string().min(4).max(8), device_fingerprint: z.string().min(8).max(200), device_label: z.string().max(100).optional() }),
      body,
    );
    return this.auth.verifyLogin(req, b);
  }

  @Public()
  @Post("auth/refresh")
  @HttpCode(200)
  refresh(@Body() body: unknown) {
    return this.auth.refresh(parse(z.object({ refresh_token: z.string().min(20) }), body).refresh_token);
  }

  @Post("auth/logout")
  @HttpCode(204)
  async logout(@Req() req: AppRequest) {
    await this.auth.logout(req);
  }

  @Post("auth/step-up")
  @HttpCode(200)
  stepUp(@Req() req: AppRequest, @Body() body: unknown) {
    const b = parse(z.object({ method: z.enum(["POST", "PUT", "PATCH", "DELETE"]), path: z.string().startsWith("/"), body: z.unknown().optional() }), body);
    return this.auth.requestStepUp(req, b);
  }

  @Post("auth/step-up/verify")
  @HttpCode(200)
  stepUpVerify(@Req() req: AppRequest, @Body() body: unknown) {
    return this.auth.verifyStepUp(req, parse(z.object({ challenge_id: zUuid, code: z.string().min(4).max(8) }), body));
  }

  @Get("me")
  me(@Req() req: AppRequest) {
    return this.auth.me(req);
  }

  @Patch("me")
  updateMe(@Req() req: AppRequest, @Body() body: unknown) {
    return this.auth.updateProfile(req, parse(z.object({ full_name: z.string().trim().min(2).max(120) }), body).full_name);
  }

  @Post("me/national-code")
  @HttpCode(200)
  nationalCode(@Req() req: AppRequest, @Body() body: unknown) {
    return this.auth.setNationalCode(req, parse(z.object({ national_code: z.string().min(10).max(12) }), body).national_code);
  }

  @Get("me/devices")
  devices(@Req() req: AppRequest) {
    return this.auth.listDevices(req);
  }

  @Delete("me/devices/:id")
  @HttpCode(204)
  async revokeDevice(@Req() req: AppRequest, @Param("id") id: string) {
    await this.auth.revokeDevice(req, parse(zUuid, id));
  }
}
