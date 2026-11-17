import type { Rial } from "./money.js";

/** PRD FR-CLS-2 / D12 — what happens when the subscription window closes. */
export type UnderSubscriptionRule = "all_or_nothing" | "keep_raised";

export interface CloseInput {
  rule: UnderSubscriptionRule;
  faceValuePerUnit: Rial;
  targetAmount: Rial;
  minAmount: Rial | null; // only meaningful for keep_raised
  raisedAmount: Rial; // sum of reserved subscriptions at close
}

export type CloseDecision =
  | { action: "issue"; issuedAmount: Rial; issuedUnits: bigint; fullyFunded: boolean }
  | { action: "cancel"; reason: "below_target" | "below_minimum" | "nothing_raised" };

export function decideClose(i: CloseInput): CloseDecision {
  if (i.faceValuePerUnit <= 0n) throw new Error("faceValuePerUnit must be positive");
  if (i.targetAmount % i.faceValuePerUnit !== 0n) throw new Error("targetAmount must be a multiple of faceValuePerUnit");
  if (i.minAmount !== null && i.minAmount % i.faceValuePerUnit !== 0n)
    throw new Error("minAmount must be a multiple of faceValuePerUnit");
  if (i.raisedAmount % i.faceValuePerUnit !== 0n) throw new Error("raisedAmount must be whole units");
  if (i.raisedAmount > i.targetAmount) throw new Error("raisedAmount cannot exceed targetAmount (capacity check failed)");

  if (i.raisedAmount === 0n) return { action: "cancel", reason: "nothing_raised" };
  const full = i.raisedAmount === i.targetAmount;

  if (i.rule === "all_or_nothing") {
    if (!full) return { action: "cancel", reason: "below_target" };
  } else if (i.minAmount !== null && i.raisedAmount < i.minAmount) {
    return { action: "cancel", reason: "below_minimum" };
  }
  return {
    action: "issue",
    issuedAmount: i.raisedAmount,
    issuedUnits: i.raisedAmount / i.faceValuePerUnit,
    fullyFunded: full,
  };
}

export interface SubscriptionCheck {
  units: bigint;
  faceValuePerUnit: Rial;
  available: Rial; // org's available balance
  alreadyHeldUnits: bigint; // org's existing reserved/allocated units in this series
  minUnitsPerOrg: bigint;
  maxUnitsPerOrg: bigint | null;
  remainingUnits: bigint; // series capacity left
  kybApproved: boolean;
  orgFrozen: boolean;
  seriesOpen: boolean;
  consentsAccepted: boolean;
}

export type SubscriptionError =
  | "KYB_NOT_APPROVED"
  | "ORG_FROZEN"
  | "SERIES_NOT_OPEN"
  | "UNITS_NOT_POSITIVE"
  | "BELOW_MIN_UNITS"
  | "ABOVE_MAX_UNITS"
  | "CAPACITY_EXCEEDED"
  | "INSUFFICIENT_BALANCE"
  | "CONSENTS_MISSING";

/** PRD §8.2 eligibility. Returns every failing reason (UI shows all of them). */
export function checkSubscription(c: SubscriptionCheck): { ok: boolean; amount: Rial; errors: SubscriptionError[] } {
  const errors: SubscriptionError[] = [];
  const amount = c.units * c.faceValuePerUnit;
  if (!c.kybApproved) errors.push("KYB_NOT_APPROVED");
  if (c.orgFrozen) errors.push("ORG_FROZEN");
  if (!c.seriesOpen) errors.push("SERIES_NOT_OPEN");
  if (c.units <= 0n) errors.push("UNITS_NOT_POSITIVE");
  if (c.units > 0n && c.alreadyHeldUnits + c.units < c.minUnitsPerOrg) errors.push("BELOW_MIN_UNITS");
  if (c.maxUnitsPerOrg !== null && c.alreadyHeldUnits + c.units > c.maxUnitsPerOrg) errors.push("ABOVE_MAX_UNITS");
  if (c.units > c.remainingUnits) errors.push("CAPACITY_EXCEEDED");
  if (amount > c.available) errors.push("INSUFFICIENT_BALANCE");
  if (!c.consentsAccepted) errors.push("CONSENTS_MISSING");
  return { ok: errors.length === 0, amount, errors };
}
