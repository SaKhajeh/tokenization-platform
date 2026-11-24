/**
 * The idempotency key of the request being handled, carried through async calls (AsyncLocalStorage).
 *
 * Why: the response used to be stored after the business transaction had committed. A crash in between left the
 * key "in progress" forever, and the client could not tell whether the action had happened. Now `Db.tx` stores the
 * transaction's result as the key's response inside that same transaction, so the business change and its
 * recorded response commit together, or not at all.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Queryable } from "../db/db.js";

export interface IdempotencyContext {
  userId: string;
  key: string;
  /** The status code the route answers with on success (201 for POST unless @HttpCode says otherwise). */
  statusCode: number;
  /** Set once the handler has finished; transactions started after that (stray async work) record nothing. */
  done: boolean;
  /** True once a transaction of this request has committed its result as the key's response. */
  recorded: boolean;
}

export const idempotencyContext = new AsyncLocalStorage<IdempotencyContext>();

/** The JSON stored as the response, exactly as the interceptor stores it. */
export const responseJson = (data: unknown) => JSON.stringify(data ?? null);

/**
 * Called by `Db.tx` just before COMMIT, on the transaction's own connection. Records the transaction's result as the
 * response of the current idempotency key, if the request has one. Every idempotent handler does its writes in one
 * transaction and returns its result, so after a commit the key always holds a response to replay.
 */
export async function recordInTransaction(q: Queryable, result: unknown): Promise<void> {
  const ctx = idempotencyContext.getStore();
  if (!ctx || ctx.done) return;
  await q.query(`update idempotency_keys set status_code = $3, response = $4 where user_id = $1 and key = $2`, [
    ctx.userId, ctx.key, ctx.statusCode, responseJson(result),
  ]);
  ctx.recorded = true;
}
