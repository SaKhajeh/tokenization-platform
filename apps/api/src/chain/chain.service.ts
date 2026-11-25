/**
 * Custodial wallets + the chain outbox (plan/03 §1.15, §2 `chain.outbox`).
 *
 * Business code never talks to the chain directly. It inserts a `chain_txs` row in the same DB transaction as the
 * business change (e.g. KYB approval), and the worker sends it later. So a DB rollback never leaves a stray on-chain
 * action, and a chain outage never blocks the business flow.
 *
 * Send is safe to retry: before sending a registration we read the registry; if the wallet is already registered
 * (e.g. we crashed after broadcasting), we mark the job confirmed instead of sending again.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { DB, type Db, type Queryable } from "../db/db.js";
import { CONFIG } from "../common/tokens.js";
import type { AppConfig } from "../config.js";
import { uuidv7 } from "../common/ids.js";
import { AuditService } from "../audit/audit.service.js";
import { CHAIN, type ChainCall, type ChainGateway, FLAG_FUND, FLAG_INVESTOR, FLAG_ISSUER, alreadyApplied, deriveOrgAddress, orgIdHash } from "./gateway.js";
import { keccak256, toUtf8Bytes } from "ethers";
import { NotificationsService } from "../notifications/notifications.service.js";
import type { AppRequest } from "../common/context.js";
import { Errors } from "../common/errors.js";

const MAX_ATTEMPTS = 12;

/** On-chain flags (D14): every org is an investor; only the fund org is also issuer + fund. */
export const identityFlags = (orgKind: string) => FLAG_INVESTOR | (orgKind === "fund" ? FLAG_ISSUER | FLAG_FUND : 0);
const backoffSec = (attempt: number) => Math.min(3600, 15 * 2 ** (attempt - 1)); // 15 s, 30 s, 1 min … max 1 h

@Injectable()
export class ChainService {
  private readonly log = new Logger("chain");

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(CHAIN) private readonly chain: ChainGateway,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Creates the org's custodial address (once). Call inside the KYB-approval transaction. */
  async ensureWallet(q: Queryable, orgId: string): Promise<{ id: string; address: string; orgIdHash: string; registryStatus: string }> {
    const found = await q.query(`select * from wallets where org_id = $1`, [orgId]);
    if (found.rows[0]) return { id: found.rows[0].id, address: found.rows[0].address, orgIdHash: found.rows[0].org_id_hash, registryStatus: found.rows[0].registry_status };
    const idx = Number((await q.query(`select nextval('wallet_hd_index_seq') as n`)).rows[0].n);
    const address = deriveOrgAddress(this.cfg.chain.custodyXpub, idx);
    const w = { id: uuidv7(), address, orgIdHash: orgIdHash(this.cfg.chain.orgIdSalt, orgId) };
    await q.query(`insert into wallets (id, org_id, address, hd_index, org_id_hash) values ($1,$2,$3,$4,$5)`, [w.id, orgId, address, idx, w.orgIdHash]);
    await this.audit.append(q, { actorType: "system", orgId, action: "wallet.created", entityType: "wallet", entityId: w.id, after: { address, hd_index: idx } });
    return { ...w, registryStatus: "pending" };
  }

  /** Queues the on-chain registration ("digital ID"). Idempotent per wallet + KYB case. */
  async queueRegistration(q: Queryable, input: { orgId: string; walletId: string; address: string; orgIdHash: string; kybHash: string; expiresAt: Date; orgKind: string; kybCaseId: string }) {
    const call: ChainCall = {
      kind: "register_identity",
      wallet: input.address,
      orgIdHash: input.orgIdHash,
      flags: identityFlags(input.orgKind),
      kybHash: input.kybHash,
      expiry: Math.floor(input.expiresAt.getTime() / 1000),
    };
    await q.query(
      `insert into chain_txs (id, purpose, ref_type, ref_id, payload, idempotency_key) values ($1,'register_identity','wallet',$2,$3,$4)
       on conflict (idempotency_key) do nothing`,
      [uuidv7(), input.walletId, JSON.stringify(call), `register:${input.address}:${input.kybCaseId}`],
    );
  }

  /** One pass of the outbox worker. Returns counts for logs/tests. */
  async processOutbox(limit = 20) {
    const out = { sent: 0, confirmed: 0, failed: 0, retried: 0 };

    // 1) Track submitted transactions.
    const submitted = (await this.db.query(`select * from chain_txs where status = 'submitted' order by created_at limit $1`, [limit])).rows;
    for (const t of submitted) {
      try {
        const r = await this.chain.receipt(t.tx_hash);
        if (r.status === "pending") {
          // A transaction can be dropped from the mempool (or stuck) and never get a receipt. After a while, put it
          // back in the queue: the pre-send check below sees whether it landed after all, so nothing is applied twice.
          const ageSec = (Date.now() - new Date(t.submitted_at).getTime()) / 1000;
          if (t.submitted_at && ageSec > this.cfg.chain.staleAfterSec) {
            await this.reschedule(t, `no confirmed receipt after ${Math.round(ageSec)} s (tx ${t.tx_hash}); re-queued`);
            out.retried++;
          }
          continue;
        }
        if (r.status === "success") {
          await this.db.tx(async (q) => {
            await q.query(`update chain_txs set status='confirmed', confirmed_at=now(), block_number=$2, gas_used=$3, updated_at=now() where id=$1`, [t.id, r.blockNumber, r.gasUsed]);
            await this.applyConfirmed(q, t);
          });
          out.confirmed++;
        } else {
          // Reverted after mining: back to the queue; the pre-send check decides what happens next.
          await this.reschedule(t, `reverted in block ${r.blockNumber}`);
          out.retried++;
        }
      } catch (e: any) {
        this.log.warn(`receipt ${t.tx_hash}: ${e?.message ?? e}`);
      }
    }

    // 2) Send queued transactions whose time has come.
    const queued = (await this.db.query(`select * from chain_txs where status = 'queued' and next_attempt_at <= now() order by created_at limit $1`, [limit])).rows;
    for (const t of queued) {
      const call = t.payload as ChainCall;
      try {
        // Already done on-chain (crash after broadcast, or done by hand)? Then don't send again.
        const onchain = await this.chain.identity(call.wallet);
        if (alreadyApplied(call, onchain)) {
          await this.db.tx(async (q) => {
            await q.query(`update chain_txs set status='confirmed', confirmed_at=now(), last_error='already on-chain', updated_at=now() where id=$1`, [t.id]);
            await this.applyConfirmed(q, t);
          });
          out.confirmed++;
          continue;
        }
        const hash = await this.chain.send(call);
        await this.db.query(
          `update chain_txs set status='submitted', tx_hash=$2, submitted_at=now(), attempts=attempts+1, last_error=null, updated_at=now() where id=$1`,
          [t.id, hash],
        );
        out.sent++;
      } catch (e: any) {
        const msg = String(e?.shortMessage ?? e?.message ?? e).slice(0, 500);
        if (t.attempts + 1 >= MAX_ATTEMPTS) {
          await this.db.tx(async (q) => {
            await q.query(`update chain_txs set status='failed', attempts=attempts+1, last_error=$2, updated_at=now() where id=$1`, [t.id, msg]);
            await this.audit.append(q, { actorType: "system", action: "chain.tx_failed", entityType: "chain_tx", entityId: t.id, after: { error: msg } });
            await q.query(
              `insert into tasks (id, title, description, linked_type, linked_id, assignee_role, priority, source, workflow_key)
               values ($1,$2,$3,'chain_tx',$4,'tokenisation_officer','p0','workflow','chain.tx_failed')`,
              [uuidv7(), "تراکنش زنجیره‌ای ناموفق", `${t.purpose}: ${msg}`, t.id],
            );
          });
          out.failed++;
        } else {
          await this.reschedule(t, msg);
          out.retried++;
        }
      }
    }
    return out;
  }

  private async reschedule(t: any, error: string) {
    await this.db.query(
      `update chain_txs set status='queued', tx_hash=null, attempts=attempts+1, last_error=$2,
       next_attempt_at = now() + ($3 || ' seconds')::interval, updated_at=now() where id=$1`,
      [t.id, error.slice(0, 500), String(backoffSec(t.attempts + 1))],
    );
  }

  private async applyConfirmed(q: Queryable, t: any) {
    const w = (await q.query(`select * from wallets where id = $1`, [t.ref_id])).rows[0];
    const status = { register_identity: "registered", reinstate_identity: "registered", revoke_identity: "revoked", update_identity: null }[
      t.purpose as "register_identity" | "reinstate_identity" | "revoke_identity" | "update_identity"
    ];
    if (status) await q.query(`update wallets set registry_status=$2, registered_at=coalesce(registered_at, now()) where id=$1`, [t.ref_id, status]);
    await this.audit.append(q, { actorType: "system", orgId: w?.org_id ?? null, action: `wallet.${t.purpose}`, entityType: "wallet", entityId: t.ref_id, after: { tx_hash: t.tx_hash } });
    if (t.purpose === "register_identity" && w) {
      await this.notifications.notify(q, { to: { orgId: w.org_id, orgRoles: ["org_admin"] }, event: "wallet.registered", dedupeKey: `wallet.registered:${w.id}` });
    }
  }

  /**
   * Brings the on-chain digital ID in line with the database: registered + up to date while KYB is valid,
   * revoked when it is not. Call inside the transaction that changed KYB.
   */
  async syncIdentity(q: Queryable, orgId: string, reason: string) {
    const org = (await q.query(`select id, org_kind, kyb_expires_at from orgs where id = $1`, [orgId])).rows[0];
    const w = (await q.query(`select * from wallets where org_id = $1`, [orgId])).rows[0];
    if (!org || !w) return;
    const valid = org.kyb_expires_at && new Date(org.kyb_expires_at) > new Date();
    // The key must name the KYB event, not only the call: a revoke or reinstate call has the same payload every
    // time (kind + wallet), so keying on the payload alone silently dropped the second revoke after a second
    // expiry (and the second reinstate). The latest KYB case and its expiry identify the event; repeating the
    // sync for the same event still produces the same key and is a no-op.
    const latest = (await q.query(`select id from kyb_cases where org_id = $1 order by version desc limit 1`, [orgId])).rows[0];
    const event = `${latest?.id ?? "none"}:${org.kyb_expires_at ? new Date(org.kyb_expires_at).toISOString() : "none"}`;
    const queue = async (call: ChainCall) => {
      const key = `${call.kind}:${w.address}:${keccak256(toUtf8Bytes(`${event}|${JSON.stringify(call)}`)).slice(2, 18)}`;
      await q.query(
        `insert into chain_txs (id, purpose, ref_type, ref_id, payload, idempotency_key) values ($1,$2,'wallet',$3,$4,$5) on conflict (idempotency_key) do nothing`,
        [uuidv7(), call.kind, w.id, JSON.stringify(call), key],
      );
    };
    if (!valid) {
      if (w.registry_status !== "pending") await queue({ kind: "revoke_identity", wallet: w.address });
      return;
    }
    const c = (await q.query(`select kyb_hash, expires_at from kyb_cases where org_id = $1 and status = 'approved' order by version desc limit 1`, [orgId])).rows[0];
    if (!c) return;
    const flags = identityFlags(org.org_kind);
    const expiry = Math.floor(new Date(org.kyb_expires_at).getTime() / 1000);
    if (w.registry_status === "revoked") await queue({ kind: "reinstate_identity", wallet: w.address });
    await queue({ kind: "update_identity", wallet: w.address, flags, kybHash: c.kyb_hash, expiry });
    await this.audit.append(q, { actorType: "system", orgId, action: "wallet.sync_queued", entityType: "wallet", entityId: w.id, after: { reason, flags, expiry } });
  }

  // ------------------------------------------------------------------ API views

  async walletForOrg(req: AppRequest) {
    const w = (await this.db.query(`select * from wallets where org_id = $1`, [req.org!.id])).rows[0];
    if (!w) throw Errors.notFound("Wallet");
    const tx = (
      await this.db.query(`select status, tx_hash, attempts, last_error from chain_txs where ref_type='wallet' and ref_id=$1 order by created_at desc limit 1`, [w.id])
    ).rows[0];
    const ex = this.chain.explorer;
    return {
      address: w.address,
      registry_status: w.registry_status,
      registered_at: w.registered_at,
      chain_id: this.chain.chainId,
      explorer_url: ex ? `${ex}/address/${w.address}` : null,
      registration_tx: tx ? { status: tx.status, tx_hash: tx.tx_hash, explorer_url: ex && tx.tx_hash ? `${ex}/tx/${tx.tx_hash}` : null } : null,
    };
  }

  async listTxs(status?: string) {
    const r = await this.db.query(
      `select id, purpose, ref_type, ref_id, status, tx_hash, attempts, last_error, next_attempt_at, block_number, created_at
       from chain_txs where ($1::text is null or status = $1) order by created_at desc limit 200`,
      [status ?? null],
    );
    return r.rows;
  }

  /** Staff action: put a failed tx back in the queue after fixing the cause (e.g. gas wallet topped up). */
  async retry(req: AppRequest, id: string) {
    return this.db.tx(async (q) => {
      const t = (await q.query(`select * from chain_txs where id=$1 for update`, [id])).rows[0];
      if (!t) throw Errors.notFound("Chain transaction");
      if (t.status !== "failed") throw Errors.forbidden("Only failed transactions can be retried");
      await q.query(`update chain_txs set status='queued', attempts=0, next_attempt_at=now(), updated_at=now() where id=$1`, [id]);
      await this.audit.append(q, { actorUserId: req.user!.id, actorType: "staff", action: "chain.tx_retry", entityType: "chain_tx", entityId: id });
      return { id, status: "queued" };
    });
  }
}
