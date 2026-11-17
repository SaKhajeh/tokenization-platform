/**
 * Jibit Cobank: identified deposits into the fund's collection account (plan/04-integrations-jibit.md §2.3).
 *
 * Every org gets a payment ID (شناسه پرداخت) on the collection IBAN. Jibit lists incoming transfers that carry a
 * payment ID as "waiting for verify"; we then verify them (accept), send them to "to be decided" (hold for review)
 * or refund them in full. There are no webhooks in the spec, so a job polls.
 *
 * Amounts: Jibit returns integers; we treat them as rials (to be confirmed with Jibit, open question §7).
 */
import { JibitHttp, JibitProduct } from "./jibit.js";

export interface DepositRecord {
  referenceNumber: string;
  accountIban: string;
  amount: bigint;
  sourceIban: string | null;
  sourceName: string | null;
  payId: string | null;
  kytStatus: "NONE" | "NOT_MATCH" | "MATCH_IBAN_AND_NATIONAL_ID" | string;
  merchantVerificationStatus: string | null;
  bankReferenceNumber: string | null;
  recordType: string | null;
  timestamp: string | null;
  raw: unknown;
}

export type TransferType = "NORMAL" | "ACH" | "RTGS"; // same bank | Paya | Satna
export type SettlementState =
  | "RECEIVED" | "WAITING_FOR_FEE" | "WAITING_FOR_BALANCE" | "CANCELLED" | "SOURCE_PROCESSING" | "DESTINATION_PROCESSING"
  | "TRANSFERRED" | "WAITING_FOR_AUTO_RENEW" | "FAILED" | "TRANSFERRED_REVERTED" | "FAILED_WRONG";

export interface SettlementRequest {
  /** Our withdrawal id: Jibit's idempotency key (recordTrackId). */
  trackId: string;
  transferType: TransferType;
  transferReason: string;
  sourceIban: string;
  destinationIban: string;
  amount: bigint;
  description: string;
}

export interface SettlementStatus {
  trackId: string;
  state: SettlementState;
  failReason: string | null;
  bankReferenceNumber: string | null;
  estimatedSettleAt: string | null;
  raw: unknown;
}

export interface CobankProvider {
  /** Remaining outgoing-transfer allowance on the collection account (plan/04 §2.5 step 1). */
  transferLimits(collectionIban: string): Promise<{ dailyRemaining: bigint; monthlyRemaining: bigint }>;
  createSettlement(req: SettlementRequest): Promise<SettlementStatus>;
  /** null when Jibit has no settlement with this track id. */
  settlementStatus(trackId: string): Promise<SettlementStatus | null>;
  createPayId(collectionIban: string): Promise<string>;
  waitingForVerify(collectionIban: string, pageNumber: number, pageSize: number): Promise<{ items: DepositRecord[]; hasNext: boolean }>;
  verify(collectionIban: string, referenceNumber: string): Promise<void>;
  toBeDecided(collectionIban: string, referenceNumber: string): Promise<void>;
  fullRefund(collectionIban: string, referenceNumber: string): Promise<void>;
}
export const COBANK = Symbol("COBANK");

export function mapRecord(r: any): DepositRecord {
  return {
    referenceNumber: String(r.referenceNumber),
    accountIban: r.accountIban ?? "",
    amount: BigInt(r.creditAmount ?? 0),
    sourceIban: r.sourceIban ?? null,
    sourceName: r.sourceName ?? null,
    payId: r.payId ?? null,
    kytStatus: r.kytStatus ?? "NONE",
    merchantVerificationStatus: r.merchantVerificationStatus ?? null,
    bankReferenceNumber: r.bankReferenceNumber ?? null,
    recordType: r.recordType ?? null,
    timestamp: r.timestamp ?? null,
    raw: r,
  };
}

function mapSettlement(r: any): SettlementStatus {
  // A settlement has one PRIME record (plus ARCHIVE records of earlier attempts); its state is the settlement's state.
  const recs: any[] = r.records ?? [];
  const rec = recs.find((x) => x.recordType === "PRIME") ?? recs[recs.length - 1] ?? {};
  return {
    trackId: String(r.trackId),
    state: rec.state ?? "RECEIVED",
    failReason: rec.failReason ?? null,
    bankReferenceNumber: rec.bankReferenceNumber ?? null,
    estimatedSettleAt: rec.estimatedSettleAt ?? null,
    raw: r,
  };
}

export class JibitCobank implements CobankProvider {
  constructor(private readonly http: JibitHttp, private readonly product: JibitProduct) {}

  async transferLimits(iban: string) {
    const r = await this.http.call<any>(this.product, "GET", `/cobank/v1/orders/augmented-transfer/limitation/${iban}`);
    return { dailyRemaining: BigInt(r.dailyLimitation?.remainingAmount ?? 0), monthlyRemaining: BigInt(r.monthlyLimitation?.remainingAmount ?? 0) };
  }
  async createSettlement(q: SettlementRequest) {
    const r = await this.http.call<any>(this.product, "POST", "/cobank/v1/orders/settlement", {
      recordTrackId: q.trackId,
      transferType: q.transferType,
      transferReason: q.transferReason,
      sourceIban: q.sourceIban,
      destinationIban: q.destinationIban,
      amount: Number(q.amount), // Jibit's spec types amounts as int64 JSON numbers; rials fit safely below 2^53
      requestDescription: q.description,
    });
    return mapSettlement(r);
  }
  async settlementStatus(trackId: string) {
    try {
      return mapSettlement(await this.http.call<any>(this.product, "GET", `/cobank/v1/orders/settlement/${trackId}?showArchive=false`));
    } catch (e: any) {
      if (e?.status === 404) return null;
      throw e;
    }
  }

  async createPayId(iban: string) {
    const r = await this.http.call<{ paymentId: string }>(this.product, "POST", `/cobank/v1/accounts/${iban}/pay-id/random`);
    if (!r.paymentId) throw new Error("Cobank returned no paymentId");
    return String(r.paymentId);
  }
  async waitingForVerify(iban: string, pageNumber: number, pageSize: number) {
    const q = new URLSearchParams({ pageNumber: String(pageNumber), pageSize: String(pageSize) });
    const r = await this.http.call<any>(this.product, "GET", `/cobank/v1/orders/aug-statement/${iban}/variz-pid/waitingForVerify?${q}`);
    return { items: (r.elements ?? []).map(mapRecord), hasNext: r.hasNext === true };
  }
  async verify(iban: string, ref: string) {
    await this.http.call(this.product, "GET", `/cobank/v1/orders/aug-statement/${iban}/variz-pid/${ref}/verify`);
  }
  async toBeDecided(iban: string, ref: string) {
    await this.http.call(this.product, "GET", `/cobank/v1/orders/aug-statement/${iban}/variz-pid/${ref}/to-be-decided`);
  }
  async fullRefund(iban: string, ref: string) {
    await this.http.call(this.product, "POST", `/cobank/v1/orders/aug-statement/${iban}/variz-pid/${ref}/full-refund`);
  }
}

type MockState = "WAITING" | "VERIFIED" | "TO_BE_DECIDED" | "REFUNDED";

/** Dev/test Cobank. `deposit()` simulates an incoming bank transfer; actions move it between states. */
export class MockCobank implements CobankProvider {
  readonly settlements = new Map<string, SettlementStatus & { req: SettlementRequest }>();
  limits = { dailyRemaining: 100_000_000_000n, monthlyRemaining: 1_000_000_000_000n };
  /** Test hook: the next createSettlement reaches Jibit but the response is lost (timeout after success). */
  loseNextSettlementResponse = false;

  async transferLimits(_iban: string) {
    return { ...this.limits };
  }
  async createSettlement(req: SettlementRequest) {
    const existing = this.settlements.get(req.trackId);
    if (existing) throw Object.assign(new Error("duplicate recordTrackId"), { status: 400 });
    const st = { trackId: req.trackId, state: "RECEIVED" as SettlementState, failReason: null, bankReferenceNumber: null, estimatedSettleAt: null, raw: { mock: true }, req };
    this.settlements.set(req.trackId, st);
    this.limits.dailyRemaining -= req.amount;
    this.limits.monthlyRemaining -= req.amount;
    if (this.loseNextSettlementResponse) {
      this.loseNextSettlementResponse = false;
      throw Object.assign(new Error("timeout"), { status: 504 });
    }
    return { ...st };
  }
  async settlementStatus(trackId: string) {
    const s = this.settlements.get(trackId);
    return s ? { ...s } : null;
  }
  /** Test hook: move a settlement to a new Jibit state. */
  setSettlement(trackId: string, state: SettlementState, failReason: string | null = null) {
    const s = this.settlements.get(trackId);
    if (!s) throw new Error(`no settlement ${trackId}`);
    Object.assign(s, { state, failReason, bankReferenceNumber: state === "TRANSFERRED" ? `BR${Date.now()}` : s.bankReferenceNumber });
  }

  readonly records = new Map<string, { rec: DepositRecord; state: MockState }>();
  readonly payIds = new Set<string>();
  readonly actions: string[] = [];
  /** Test hook: make the next N calls to verify() fail (simulates an outage). */
  failNextVerify = 0;
  private seq = 0;

  async createPayId(_iban: string) {
    let id: string;
    do id = String(1_000_000_000 + Math.floor(Math.random() * 8_999_999_999));
    while (this.payIds.has(id));
    this.payIds.add(id);
    return id;
  }

  deposit(input: { payId: string | null; amount: bigint; sourceIban: string; kyt?: DepositRecord["kytStatus"]; sourceName?: string }): string {
    const ref = `JB${Date.now()}${++this.seq}`;
    this.records.set(ref, {
      state: "WAITING",
      rec: {
        referenceNumber: ref, accountIban: "", amount: input.amount, sourceIban: input.sourceIban, sourceName: input.sourceName ?? "واریزکننده",
        payId: input.payId, kytStatus: input.kyt ?? "MATCH_IBAN_AND_NATIONAL_ID", merchantVerificationStatus: "SYSTEM_REVIEW",
        bankReferenceNumber: `B${this.seq}`, recordType: "VARIZ_TRANSFER_ACH", timestamp: new Date().toISOString(), raw: { mock: true },
      },
    });
    return ref;
  }

  async waitingForVerify(_iban: string, pageNumber: number, pageSize: number) {
    const all = [...this.records.values()].filter((r) => r.state === "WAITING").map((r) => r.rec);
    const items = all.slice(pageNumber * pageSize, (pageNumber + 1) * pageSize);
    return { items, hasNext: (pageNumber + 1) * pageSize < all.length };
  }
  private move(ref: string, from: MockState[], to: MockState, action: string) {
    const r = this.records.get(ref);
    if (!r) throw Object.assign(new Error("record not found"), { status: 404 });
    if (r.state === to) return; // idempotent repeat
    if (!from.includes(r.state)) throw Object.assign(new Error(`cannot ${action} from ${r.state}`), { status: 400 });
    r.state = to;
    this.actions.push(`${action}:${ref}`);
  }
  async verify(_iban: string, ref: string) {
    if (this.failNextVerify > 0) {
      this.failNextVerify--;
      throw Object.assign(new Error("Jibit unavailable"), { status: 503 });
    }
    this.move(ref, ["WAITING", "TO_BE_DECIDED"], "VERIFIED", "verify");
  }
  async toBeDecided(_iban: string, ref: string) {
    this.move(ref, ["WAITING"], "TO_BE_DECIDED", "to-be-decided");
  }
  async fullRefund(_iban: string, ref: string) {
    this.move(ref, ["WAITING", "TO_BE_DECIDED"], "REFUNDED", "refund");
  }
  state(ref: string) {
    return this.records.get(ref)?.state;
  }
}
