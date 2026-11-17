import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { DB, Db } from "../db/db.js";
import { canonicalJson, sha256Hex } from "./crypto.js";
import { ApiError } from "./errors.js";
import type { AppRequest } from "./context.js";

export const STEP_UP = "tp:stepUp";
/** Requires X-Step-Up-Token bound to this exact method + path + body (FR-AUTH-4). */
export const StepUp = () => SetMetadata(STEP_UP, true);

/** The action a step-up token authorises. The client sends the same method/path/body to /auth/step-up. */
export function actionHash(method: string, path: string, body: unknown): string {
  const cleanPath = path.split("?")[0].replace(/\/+$/, "");
  return sha256Hex(`${method.toUpperCase()} ${cleanPath} ${sha256Hex(canonicalJson(body ?? {}))}`);
}

@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, @Inject(DB) private readonly db: Db) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (!this.reflector.getAllAndOverride<boolean>(STEP_UP, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const token = req.headers["x-step-up-token"];
    const fail = () =>
      new ApiError(403, "STEP_UP_REQUIRED", "Confirm this action with a one-time code", "برای این کار، تأیید با کد یکبارمصرف لازم است.");
    if (typeof token !== "string" || !req.user) throw fail();
    const expected = actionHash(req.method, req.originalUrl, req.body);
    // Consume atomically: a token works once, for one action, before it expires.
    const { rows } = await this.db.query(
      `update step_up_tokens set consumed_at = now()
       where token_hash = $1 and user_id = $2 and action_hash = $3 and consumed_at is null and expires_at > now()
       returning id`,
      [sha256Hex(token), req.user.id, expected],
    );
    if (!rows.length) throw fail();
    return true;
  }
}
