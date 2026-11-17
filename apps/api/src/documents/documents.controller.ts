import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { DocumentsService } from "./documents.service.js";
import { OrgRoute, Req } from "../common/guards.js";
import { Idempotent } from "../common/idempotency.js";
import type { AppRequest } from "../common/context.js";
import { parse, zUuid } from "../common/zod.js";

@Controller("documents")
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  @Get()
  @OrgRoute()
  list(@Req() req: AppRequest) {
    return this.docs.listForOrg(req);
  }

  @Post("upload-url")
  @OrgRoute()
  @Idempotent()
  upload(@Req() req: AppRequest, @Body() body: unknown) {
    const b = parse(
      z.object({
        category: z.enum(["kyb_articles", "kyb_gazette", "kyb_id_card", "authority_letter", "financial_statement", "contract", "evidence", "report", "other"]),
        filename: z.string().trim().min(1).max(200),
        mime: z.string().max(100),
        size: z.number().int().positive(),
      }),
      body,
    );
    return this.docs.createUpload(req, b);
  }

  @Post(":id/complete")
  @OrgRoute()
  @HttpCode(200)
  complete(@Req() req: AppRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.docs.complete(req, parse(zUuid, id), parse(z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/) }), body).sha256);
  }

  @Get(":id")
  get(@Req() req: AppRequest, @Param("id") id: string) {
    return this.docs.get(req, parse(zUuid, id));
  }

  @Get(":id/download")
  download(@Req() req: AppRequest, @Param("id") id: string) {
    return this.docs.download(req, parse(zUuid, id));
  }
}
