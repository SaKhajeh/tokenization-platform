/**
 * Double-entry ledger (plan/03 §1.6). Amounts are bigint rials.
 *
 * Lines are signed: + debit, − credit. Postgres itself enforces the rules (migration 002):
 *   - every entry sums to zero and has ≥ 2 lines (checked at commit),
 *   - no account goes below zero on its normal side (unless allow_overdraft),
 *   - entries and lines can never be updated or deleted.
 * Posting is idempotent by key: a retried job gets the existing entry back instead of posting twice.
 */
import { Inject, Injectable } from "@nestjs/common";
import { DB, Db, Queryable } from "../db/db.js";
import { uuidv7 } from "../common/ids.js";
import { ApiError } from "../common/errors.js";

export type OwnerType = "platform" | "org" | "series";
export type Side = "debit" | "credit";

/** Account kinds and their normal side. */
export const KINDS: Record<string, { owner: OwnerType; side: Side; overdraft?: boolean }> = {
  collection_bank: { owner: "platform", side: "debit" },   // money in the fund's collection account
  suspense: { owner: "platform", side: "credit" },         // received, not yet attributable
  org_available: { owner: "org", side: "credit" },         // what the platform owes the org, free to use
  org_reserved: { owner: "org", side: "credit" },          // committed to a series (M-C)
  org_withdrawal_hold: { owner: "org", side: "credit" },   // withdrawal in flight (M-C)
  // D25: service invoices paid by applicants
  fund_revenue_services: { owner: "platform", side: "credit" },     // fund's share of assessment fees
  platform_revenue_services: { owner: "platform", side: "credit" }, // platform's share of assessment fees
  vat_payable: { owner: "platform", side: "credit" },               // VAT collected on invoices, owed to the tax office
  // D26: the fund's income from the rate spread (posted at payout, per series)
  fund_revenue_spread: { owner: "platform", side: "credit" },
};

export interface PostLine {
  account: string; // ledger_accounts.id
  amount: bigint;  // + debit, − credit
}

export interface PostInput {
  entryType: string;
  refType?: string;
  refId?: string;
  description?: string;
  postedBy?: string | null;
  idempotencyKey: string;
  lines: PostLine[];
}

@Injectable()
export class LedgerService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Finds or creates the account; safe under concurrency (unique index + on conflict). */
  async account(q: Queryable, kind: keyof typeof KINDS, ownerId: string | null = null, seriesId: string | null = null): Promise<string> {
    const k = KINDS[kind];
    if (!k) throw new Error(`unknown ledger kind ${kind}`);
    if ((k.owner === "platform") !== (ownerId === null)) throw new Error(`ledger kind ${kind} owner mismatch`);
    const found = await q.query(
      `select id from ledger_accounts where owner_type = $1 and owner_id is not distinct from $2 and kind = $3 and series_id is not distinct from $4`,
      [k.owner, ownerId, kind, seriesId],
    );
    if (found.rows[0]) return found.rows[0].id;
    const id = uuidv7();
    const ins = await q.query(
      `insert into ledger_accounts (id, owner_type, owner_id, kind, series_id, normal_side, allow_overdraft)
       values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing returning id`,
      [id, k.owner, ownerId, kind, seriesId, k.side, k.overdraft ?? false],
    );
    if (ins.rows[0]) return ins.rows[0].id;
    return this.account(q, kind, ownerId, seriesId);
  }

  /** Posts a balanced entry inside the caller's transaction. Returns the entry id (existing one on replay). */
  async post(q: Queryable, p: PostInput): Promise<{ entryId: string; replayed: boolean }> {
    if (p.lines.length < 2) throw new Error("an entry needs at least two lines");
    if (p.lines.some((l) => l.amount === 0n)) throw new Error("zero-amount line");
    const sum = p.lines.reduce((a, l) => a + l.amount, 0n);
    if (sum !== 0n) throw new Error(`unbalanced entry (sum ${sum})`);

    const existing = await q.query(`select id from journal_entries where idempotency_key = $1`, [p.idempotencyKey]);
    if (existing.rows[0]) return { entryId: existing.rows[0].id, replayed: true };

    const entryId = uuidv7();
    await q.query(
      `insert into journal_entries (id, entry_type, ref_type, ref_id, description, posted_by, idempotency_key)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [entryId, p.entryType, p.refType ?? null, p.refId ?? null, p.description ?? null, p.postedBy ?? null, p.idempotencyKey],
    );
    for (const l of p.lines) {
      await q.query(`insert into journal_lines (entry_id, account_id, amount) values ($1,$2,$3)`, [entryId, l.account, l.amount.toString()]);
    }
    return { entryId, replayed: false };
  }

  /** Balance on the account's normal side (positive = normal). */
  async balance(q: Queryable, accountId: string): Promise<bigint> {
    const r = await q.query(
      `select coalesce(b.balance, 0) as balance, a.normal_side from ledger_accounts a left join account_balances b on b.account_id = a.id where a.id = $1`,
      [accountId],
    );
    if (!r.rows[0]) return 0n;
    const b = BigInt(r.rows[0].balance);
    return r.rows[0].normal_side === "debit" ? b : -b;
  }

  async orgBalances(orgId: string) {
    const r = await this.db.query(
      `select a.kind, coalesce(b.balance, 0) as balance from ledger_accounts a left join account_balances b on b.account_id = a.id
       where a.owner_type = 'org' and a.owner_id = $1`,
      [orgId],
    );
    const by = new Map<string, bigint>(r.rows.map((x: any) => [x.kind, -BigInt(x.balance)]));
    const available = by.get("org_available") ?? 0n;
    const reserved = by.get("org_reserved") ?? 0n;
    const hold = by.get("org_withdrawal_hold") ?? 0n;
    return { available: available.toString(), reserved_total: reserved.toString(), withdrawal_hold: hold.toString(), total: (available + reserved + hold).toString() };
  }

  /** The org's own movements, newest first, as the org sees them (+ = money in). */
  async orgStatement(orgId: string, limit = 100) {
    const r = await this.db.query(
      `select e.id as entry_id, e.entry_type, e.description, e.posted_at, a.kind, l.amount
       from journal_lines l join journal_entries e on e.id = l.entry_id join ledger_accounts a on a.id = l.account_id
       where a.owner_type = 'org' and a.owner_id = $1
       order by l.id desc limit $2`,
      [orgId, limit],
    );
    return r.rows.map((x: any) => ({
      entry_id: x.entry_id,
      type: x.entry_type,
      account: x.kind,
      amount: (-BigInt(x.amount)).toString(), // credit to the org's account = money in for the org
      description: x.description,
      posted_at: x.posted_at,
    }));
  }

  /** Every account with its normal-side balance, plus the global check that all signed balances sum to zero. */
  async trialBalance() {
    const r = await this.db.query(
      `select a.id, a.owner_type, a.owner_id, a.kind, a.normal_side, coalesce(b.balance, 0) as balance,
              (select coalesce(sum(amount), 0) from journal_lines l where l.account_id = a.id) as from_lines
       from ledger_accounts a left join account_balances b on b.account_id = a.id order by a.owner_type, a.kind`,
    );
    let sum = 0n;
    let mismatches = 0;
    const accounts = r.rows.map((x: any) => {
      const b = BigInt(x.balance);
      sum += b;
      if (b !== BigInt(x.from_lines)) mismatches++;
      return { id: x.id, owner_type: x.owner_type, owner_id: x.owner_id, kind: x.kind, balance: (x.normal_side === "debit" ? b : -b).toString() };
    });
    return { balanced: sum === 0n && mismatches === 0, signed_sum: sum.toString(), cached_vs_lines_mismatches: mismatches, accounts };
  }
}

export const insufficientBalance = () =>
  new ApiError(409, "INSUFFICIENT_BALANCE", "Not enough balance", "موجودی کافی نیست.");
