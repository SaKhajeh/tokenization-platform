import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable, catchError, finalize, from, mergeMap, of, throwError } from "rxjs";
import { DB, type Db } from "../db/db.js";
import { CONFIG } from "./tokens.js";
import type { AppConfig } from "../config.js";
import { canonicalJson, sha256Hex } from "./crypto.js";
import { ApiError } from "./errors.js";
import type { AppRequest } from "./context.js";
import { IdempotencyContext, idempotencyContext, responseJson } from "./idempotency-context.js";

export const IDEMPOTENT = "tp:idempotent";
/**
 * Requires an Idempotency-Key header; replays return the first response (data-model doc §3.1).
 *
 * Contract for handlers: do every write in ONE `db.tx(...)` and return its result as the response. The
 * transaction then stores that result as the key's response before it commits (see idempotency-context.ts),
 * so a crash can never leave a committed action without a recorded response.
 */
export const Idempotent = () => SetMetadata(IDEMPOTENT, true);

/**
 * How it behaves:
 *  - new key → the handler runs; its transaction records the response; the interceptor records the final response
 *    again (it can add fields computed after the commit, e.g. a dev-only token).
 *  - same key, same request, response recorded → replay (`Idempotent-Replay: true`).
 *  - same key, different request → 422.
 *  - same key, no response yet:
 *      · younger than IDEMPOTENCY_STALE_SEC → 409 IDEMPOTENCY_IN_PROGRESS (the first request may still be running);
 *      · older → the first request died before committing anything (a commit would have recorded a response), so the
 *        key is taken over and the request runs again. Before this fix such a key stayed blocked forever.
 *  - the handler fails → the key is released only if nothing was committed; if a transaction had already committed,
 *    its recorded response stays, so a retry replays it instead of repeating the action.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

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
    // Nest sets the route's success status (201 for POST, or @HttpCode) before interceptors run.
    const statusCode: number = res.statusCode;

    const claim = () =>
      this.db.query(
        `insert into idempotency_keys (user_id, key, method, path, request_hash) values ($1,$2,$3,$4,$5)
         on conflict (user_id, key) do nothing returning key`,
        [userId, key, req.method, path, requestHash],
      );

    const begin = async (): Promise<{ status_code: number; response: unknown } | null> => {
      if ((await claim()).rows.length) return null;
      const { rows } = await this.db.query(
        `select request_hash, status_code, response, created_at < now() - ($3 || ' seconds')::interval as stale
         from idempotency_keys where user_id=$1 and key=$2`,
        [userId, key, String(this.cfg.idempotencyStaleSec)],
      );
      const ex = rows[0];
      if (!ex) return begin(); // released between our insert and select: try again
      if (ex.request_hash !== requestHash)
        throw new ApiError(422, "IDEMPOTENCY_KEY_REUSED", "Key already used for a different request", "این شناسه برای درخواست دیگری استفاده شده است.");
      if (ex.status_code !== null) return ex;
      if (!ex.stale)
        throw new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "The original request is still being processed", "درخواست قبلی در حال پردازش است.");
      // Abandoned: nothing was committed under this key. Take it over (only one retry can win the delete).
      const taken = await this.db.query(
        `delete from idempotency_keys where user_id=$1 and key=$2 and status_code is null
         and created_at < now() - ($3 || ' seconds')::interval returning key`,
        [userId, key, String(this.cfg.idempotencyStaleSec)],
      );
      if (!taken.rows.length || !(await claim()).rows.length)
        throw new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "The original request is still being processed", "درخواست قبلی در حال پردازش است.");
      return null;
    };

    return from(begin()).pipe(
      mergeMap((existing) => {
        if (existing) {
          res.status(existing.status_code);
          res.setHeader("Idempotent-Replay", "true");
          return of(existing.response);
        }
        const store: IdempotencyContext = { userId, key, statusCode, done: false, recorded: false };
        // next.handle() binds the handler to the async context it is called in, so the handler and every
        // transaction it starts see this key.
        const handled = idempotencyContext.run(store, () => next.handle());
        return handled.pipe(
          mergeMap(async (data) => {
            store.done = true;
            await this.db.query(`update idempotency_keys set status_code=$3, response=$4 where user_id=$1 and key=$2`, [
              userId, key, res.statusCode, responseJson(data),
            ]);
            return data;
          }),
          // Release the key only if nothing was committed under it; a committed result stays and is replayed.
          catchError((err) =>
            from(this.db.query(`delete from idempotency_keys where user_id=$1 and key=$2 and status_code is null`, [userId, key])).pipe(
              mergeMap(() => throwError(() => err)),
            ),
          ),
          finalize(() => {
            store.done = true;
          }),
        );
      }),
    );
  }
}
