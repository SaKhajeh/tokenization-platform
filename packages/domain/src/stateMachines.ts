/**
 * State machines from PRD §7. The backend must route every status change through
 * `transition()` so illegal jumps are impossible and every change is auditable.
 */

export type Machine<S extends string> = Readonly<Record<S, readonly S[]>>;

export class IllegalTransitionError extends Error {
  constructor(
    public readonly machine: string,
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`${machine}: illegal transition ${from} → ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export function canTransition<S extends string>(m: Machine<S>, from: S, to: S): boolean {
  return (m[from] ?? []).includes(to);
}

export function transition<S extends string>(name: string, m: Machine<S>, from: S, to: S): S {
  if (!canTransition(m, from, to)) throw new IllegalTransitionError(name, from, to);
  return to;
}

export function terminalStates<S extends string>(m: Machine<S>): S[] {
  return (Object.keys(m) as S[]).filter((s) => m[s].length === 0);
}

// ---------------------------------------------------------------- Series (PRD §7.2, FR-SER-4)
export type SeriesStatus =
  | "draft"
  | "terms_signed"
  | "tokenisation_review"
  | "deployed"
  | "subscription_open"
  | "subscription_closed"
  | "issued"
  | "cancelled"
  | "active"
  | "matured"
  | "defaulted"
  | "paid_out"
  | "redeemed"
  | "closed";

export const SERIES: Machine<SeriesStatus> = {
  draft: ["terms_signed", "cancelled"],
  terms_signed: ["tokenisation_review", "cancelled"],
  tokenisation_review: ["deployed", "terms_signed", "cancelled"], // back to terms_signed if the config is rejected
  deployed: ["subscription_open", "cancelled"],
  subscription_open: ["subscription_closed"],
  subscription_closed: ["issued", "cancelled"],
  issued: ["active"],
  active: ["matured"],
  matured: ["paid_out", "defaulted"],
  defaulted: ["redeemed"], // after final default distribution
  paid_out: ["redeemed"],
  redeemed: ["closed"],
  cancelled: [],
  closed: [],
};

// ---------------------------------------------------------------- Application (PRD §7.1)
export type ApplicationStatus =
  | "draft"
  | "submitted"
  | "screening"
  | "awaiting_payment"
  | "returned"
  | "resubmitted"
  | "credit_assessment"
  | "due_diligence"
  | "committee"
  | "approved"
  | "approved_with_conditions"
  | "rejected"
  | "terms_negotiation"
  | "terms_signed"
  | "handed_to_tokenisation"
  | "withdrawn"
  | "expired";

export const APPLICATION: Machine<ApplicationStatus> = {
  draft: ["submitted", "withdrawn", "expired"],
  submitted: ["screening", "withdrawn"],
  // D25: when the price list charges for assessment, screening passes into awaiting_payment first.
  screening: ["returned", "awaiting_payment", "credit_assessment", "rejected", "withdrawn"],
  awaiting_payment: ["credit_assessment", "withdrawn", "expired"],
  returned: ["resubmitted", "withdrawn", "expired"],
  resubmitted: ["screening", "withdrawn"],
  credit_assessment: ["due_diligence", "rejected", "withdrawn"],
  due_diligence: ["committee", "rejected", "withdrawn"],
  committee: ["approved", "approved_with_conditions", "rejected"],
  approved: ["terms_negotiation"],
  approved_with_conditions: ["terms_negotiation"],
  terms_negotiation: ["terms_signed", "withdrawn"],
  terms_signed: ["handed_to_tokenisation"],
  handed_to_tokenisation: [],
  rejected: [],
  withdrawn: [],
  expired: [],
};

// ---------------------------------------------------------------- Subscription (PRD §7.3)
export type SubscriptionStatus = "draft" | "pending_approval" | "reserved" | "allocated" | "released" | "cancelled";

export const SUBSCRIPTION: Machine<SubscriptionStatus> = {
  draft: ["pending_approval", "reserved", "cancelled"], // → reserved directly in single-user mode
  pending_approval: ["reserved", "cancelled"],
  reserved: ["allocated", "released", "cancelled"],
  allocated: [],
  released: [],
  cancelled: [],
};

// ---------------------------------------------------------------- KYB (PRD §7.4)
export type KybStatus = "not_started" | "submitted" | "in_review" | "approved" | "rejected" | "info_requested" | "expired";

export const KYB: Machine<KybStatus> = {
  not_started: ["submitted"],
  submitted: ["in_review"],
  in_review: ["approved", "rejected", "info_requested"],
  info_requested: ["submitted"],
  approved: ["expired", "submitted"], // re-KYB on signatory change
  expired: ["submitted"],
  rejected: ["submitted"],
};

// ---------------------------------------------------------------- Withdrawal (PRD §7.6)
export type WithdrawalStatus =
  | "requested"
  | "org_approved"
  | "finance_queued"
  | "internal_approved"
  | "sent"
  | "completed"
  | "failed"
  | "cancelled"
  | "reverted";

export const WITHDRAWAL: Machine<WithdrawalStatus> = {
  requested: ["org_approved", "cancelled"],
  org_approved: ["finance_queued", "cancelled"],
  finance_queued: ["internal_approved", "sent", "failed"], // internal approval only above threshold
  internal_approved: ["sent", "failed"],
  sent: ["completed", "failed"],
  completed: ["reverted"], // the bank returned a completed transfer (Jibit TRANSFERRED_REVERTED)
  failed: [],
  cancelled: [],
  reverted: [],
};
