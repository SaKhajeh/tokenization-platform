/**
 * Comment threads and tickets — plan/07 §6b (D-C15, D-C18) and §6c (D-C17).
 */
import type { Machine } from "./stateMachines.js";

// ------------------------------------------------------------------ comment threads (§6b)

/** What a thread hangs on: a document item, a form section, one financial figure, or the case as a whole. */
export const COMMENT_TARGETS = ["item", "section", "fin_cell", "case"] as const;
export type CommentTarget = (typeof COMMENT_TARGETS)[number];

/**
 * to_applicant   — staff → applicant, shown next to the item in the app; the applicant can reply.
 * internal       — staff only, never sent to the app; names one or more recipients who get a notification and a task.
 * applicant_reply — applicant → fund, in the same thread.
 */
export const COMMENT_TYPES = ["to_applicant", "internal", "applicant_reply"] as const;
export type CommentType = (typeof COMMENT_TYPES)[number];

/** Staff who can receive an internal note (D-C18): a role, or one named staff user. */
export const NOTE_RECIPIENT_ROLES = ["analyst", "technical_expert", "fund_manager", "compliance_officer"] as const;
export type NoteRecipient = { role: (typeof NOTE_RECIPIENT_ROLES)[number] } | { userId: string };

/** fin_cell target ids look like "1404:sales". */
export const finCellId = (fiscalYear: number, field: string) => `${fiscalYear}:${field}`;

// ------------------------------------------------------------------ tickets (§6c)

export const TICKET_CATEGORIES = ["credit_case", "financing", "payments_wallet", "technical_login", "other"] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];
export const TICKET_LINKS = ["case", "case_item", "application", "withdrawal"] as const;

export type TicketStatus = "waiting_fund" | "waiting_applicant" | "closed";
/** A message from one side hands the ticket to the other; either side may close; a new message reopens. */
export const TICKET: Machine<TicketStatus> = {
  waiting_fund: ["waiting_applicant", "closed"],
  waiting_applicant: ["waiting_fund", "closed"],
  closed: ["waiting_fund", "waiting_applicant"],
};

/**
 * Target response time: `n` business days after `from` (UTC instant). Iranian week: Friday is the weekend;
 * Thursday counts as a working day. Holidays are not modelled yet (a config list can be added).
 */
export function addBusinessDays(from: Date, n: number, holidays: ReadonlySet<string> = new Set()): Date {
  const d = new Date(from.getTime());
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    // the day of week in Tehran (UTC+3:30)
    const tehran = new Date(d.getTime() + 3.5 * 3600_000);
    const iso = tehran.toISOString().slice(0, 10);
    if (tehran.getUTCDay() === 5 || holidays.has(iso)) continue;
    left--;
  }
  return d;
}
