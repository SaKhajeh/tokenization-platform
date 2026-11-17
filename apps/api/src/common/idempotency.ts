import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable, catchError, from, mergeMap, of, throwError } from "rxjs";
import { DB, Db } from "../db/db.js";
import { canonicalJson, sha256Hex } from "./crypto.js";
import { ApiError } from "./errors.js";
import type { AppRequest } from "./context.js";

export const IDEMPOTENT = "tp:idempotent";
/** Requires an Idempotency-Key header; replays return the first response (data-model doc §3.1). */
export const Idempotent = () => SetMetadata(IDEMPOTENT, true);

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector, @Inject(DB) private readonly db: Db) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.reflector.get<boolean>(IDEMPOTENT, ctx.getHandler())) return next.handle();
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const res = ctx.switchToHttp().getResponse();
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || key.length < 8 || key.length > 200)
      throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header (8–200 chars) required", "شناسه یکتای درخواست ارسال نشده است.");
    const userId = req.user!.id;
    const path = req.originalUrl.split("?")[0];
    const requestHash = sha256Hex(canonicalJson({ m: req.method, path, org: req.headers["x-org-id"] ?? null, body: req.body ?? {} }));

    const begin = async () => {
      const ins = await this.db.query(
        `insert into idempotency_keys (user_id, key, method, path, request_hash) values ($1,$2,$3,$4,$5)
         on conflict (user_id, key) do nothing returning key`,
        [userId, key, req.method, path, requestHash],
      );
      if (ins.rows.length) return null;
      const { rows } = await this.db.query(`select request_hash, status_code, response from idempotency_keys where user_id=$1 and key=$2`, [userId, key]);
      const ex = rows[0];
      if (ex.request_hash !== requestHash)
        throw new ApiError(422, "IDEMPOTENCY_KEY_REUSED", "Key already used for a different request", "این شناسه برای درخواست دیگری استفاده شده است.");
      if (ex.status_code === null)
        throw new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "The original request is still being processed", "درخواست قبلی در حال پردازش است.");
      return ex as { status_code: number; response: unknown };
    };

    return from(begin()).pipe(
      mergeMap((existing) => {
        if (existing) {
          res.status(existing.status_code);
          res.setHeader("Idempotent-Replay", "true");
          return of(existing.response);
        }
        return next.handle().pipe(
          mergeMap(async (data) => {
            await this.db.query(`update idempotency_keys set status_code=$3, response=$4 where user_id=$1 and key=$2`, [
              userId, key, res.statusCode, JSON.stringify(data ?? null),
            ]);
            return data;
          }),
          // Failed requests release the key so the client can retry with it.
          catchError((err) =>
            from(this.db.query(`delete from idempotency_keys where user_id=$1 and key=$2`, [userId, key])).pipe(mergeMap(() => throwError(() => err))),
          ),
        );
      }),
    );
  }
}
