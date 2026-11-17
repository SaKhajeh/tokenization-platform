import { describe, expect, it } from "vitest";
import {
  bankTotals, CASE, CASE_ITEM, canTransition, casePeople, expectedSlots, FINANCIAL_FIELDS, reconcileSlots, sectionProblems, terminalStates, yearProblems,
} from "../src/index.js";

const board = {
  gazette_no: "12345", gazette_date: "2026-03-01",
  people: [
    { national_id: "0012345678", name: "مریم احمدی", roles: ["ceo", "board", "shareholder"], share_pct: 60, signing_right: true },
    { national_id: "0087654321", name: "رضا کریمی", roles: ["board", "shareholder"], share_pct: 30, signing_right: true },
    { national_id: "0011111111", name: "سارا امینی", roles: ["shareholder"], share_pct: 10 },
  ],
};
const ctx = {
  people: casePeople(board), latestFiscalYear: 1404,
  locations: [{ id: "L1", usage: "head_office", address: "تهران" }, { id: "L2", usage: "factory" }],
  banks: [{ id: "B1", name: "ملت", account_no: "123" }],
};

describe("case state machines", () => {
  it("visit/financials are parallel, so documents_complete leads to scoring; terminal states", () => {
    expect(canTransition(CASE, "document_review", "documents_complete")).toBe(true);
    expect(canTransition(CASE, "documents_complete", "returned")).toBe(true); // extra documents requested later
    expect(canTransition(CASE, "submitted", "limit_issued")).toBe(false);
    expect(terminalStates(CASE).sort()).toEqual(["closed_inactive", "withdrawn"]);
  });
  it("accepted items are locked for the applicant; staff can re-open them", () => {
    expect(canTransition(CASE_ITEM, "accepted", "uploaded")).toBe(false);
    expect(canTransition(CASE_ITEM, "accepted", "needs_fix")).toBe(true);
    expect(canTransition(CASE_ITEM, "in_review", "accepted")).toBe(true);
  });
});

describe("dynamic slots (§3.2)", () => {
  const slots = expectedSlots(ctx);
  const of = (code: string) => slots.filter((s) => s.code === code).map((s) => s.slotKey);
  it("company + each director, never non-director shareholders", () => {
    expect(of("1-2")).toEqual(["company", "person:0012345678", "person:0087654321"]);
    expect(of("2-3")).toEqual(["person:0012345678", "person:0087654321"]);
    expect(of("1-6")).toEqual(["person:0012345678", "person:0087654321"]); // signatories
  });
  it("per year (Y-3 optional), per location, per bank", () => {
    expect(slots.filter((s) => s.code === "3-1").map((s) => [s.slotKey, s.required])).toEqual([
      ["year:1404", "yes"], ["year:1403", "yes"], ["year:1402", "yes"], ["year:1401", "if_available"],
    ]);
    expect(of("2-4")).toEqual(["location:L1", "location:L2"]);
    expect(of("3-3")).toEqual(["bank:B1"]);
    expect(slots.find((s) => s.code === "1-2" && s.slotKey !== "company")!.label).toBe("مریم احمدی (مدیرعامل)");
  });
  it("changing the people list adds, drops and revives slots; ad-hoc items untouched", () => {
    const existing = expectedSlots(ctx).map((s, i) => ({ id: `i${i}`, code: s.code, slotKey: s.slotKey, kind: "checklist" as const, state: "accepted" as const, label: s.label }));
    existing.push({ id: "x", code: "X-1", slotKey: "adhoc", kind: "adhoc" as any, state: "requested" as any, label: "مدرک اضافه" });
    const fewer = expectedSlots({ ...ctx, people: ctx.people.filter((p) => p.national_id !== "0087654321") });
    const r = reconcileSlots(existing, fewer);
    expect(r.add).toEqual([]);
    expect(r.drop.map((d) => `${d.code} ${d.slotKey}`)).toEqual(["1-2 person:0087654321", "1-5 person:0087654321", "1-6 person:0087654321", "1-7 person:0087654321", "2-3 person:0087654321"]);
    const back = reconcileSlots(existing.map((e) => (r.drop.some((d) => d.id === e.id) ? { ...e, state: "not_required" as const } : e)), expectedSlots(ctx));
    expect(back.revive).toHaveLength(5);
    expect(back.add).toEqual([]);
  });
});

describe("form completeness (§4)", () => {
  it("board rules: shares total 100%, one CEO, a signatory, unique IDs", () => {
    expect(sectionProblems("board", board)).toEqual([]);
    const bad = { ...board, people: [{ ...board.people[0], share_pct: 50 }, board.people[1], { ...board.people[1], roles: ["ceo"] }] };
    expect(sectionProblems("board", bad)).toEqual(["rule:duplicate_national_id", "rule:shares_total_100", "rule:one_ceo"]);
  });
  it("CVs are needed for every director", () => {
    expect(sectionProblems("cvs", { entries: [{ national_id: "0012345678", position: "مدیرعامل", field_degree: "دکتری مواد", experience_years: 12 }] }, { board })).toEqual(["entries.0087654321"]);
  });
  it("locations need a head office; knowledge-based fields only when yes", () => {
    expect(sectionProblems("locations", { rows: [{ id: "L2", usage: "factory", area_m2: 500, ownership: "leased", province: "البرز", address: "x", postcode: "1" }] })).toEqual(["rule:head_office_required"]);
    expect(sectionProblems("knowledge_based", { is_knowledge_based: false })).toEqual([]);
    expect(sectionProblems("knowledge_based", { is_knowledge_based: true, type: "فناور" })).toEqual(["approval_date", "validity_date", "products", "field"]);
  });
  it("bank totals (tables 12–13)", () => {
    expect(bankTotals({ facilities: [{ amount: "100", outstanding: 40 }, { amount: 50, outstanding: 0 }], guarantees: [{ amount: 30, status: "active" }, { amount: 20, status: "cancelled" }] }))
      .toEqual({ facilitiesTotal: 150, facilitiesCurrent: 100, facilitiesOutstanding: 40, guaranteesTotal: 50, guaranteesCurrent: 30 });
  });
});

describe("financial summary (§5)", () => {
  const zero = Object.fromEntries(FINANCIAL_FIELDS.map((k) => [k, "0"]));
  it("whole million rials, every field, balanced", () => {
    expect(yearProblems({ ...zero, cash: "100", capital: "100", sales: "500", cogs: "300" })).toEqual([]);
    expect(yearProblems({ ...zero, cash: "100" })).toEqual(["rule:not_balanced:100"]);
    expect(yearProblems({ ...zero, cash: "1.5", sales: undefined as any })).toEqual(["field:cash", "field:sales"]);
    expect(yearProblems({ ...zero, retainedEarnings: "-20", cash: "-20" })).toEqual([]); // losses allowed
  });
});

import { addBusinessDays, TICKET } from "../src/index.js";
describe("tickets (§6c)", () => {
  it("one business day skips Friday (Tehran time)", () => {
    // Wednesday 10:00 Tehran → Thursday; Thursday → Saturday
    expect(addBusinessDays(new Date("2026-11-18T06:30:00Z"), 1).toISOString()).toBe("2026-11-19T06:30:00.000Z");
    expect(addBusinessDays(new Date("2026-11-19T06:30:00Z"), 1).toISOString()).toBe("2026-11-21T06:30:00.000Z");
    expect(addBusinessDays(new Date("2026-11-19T06:30:00Z"), 1, new Set(["2026-11-21"])).toISOString()).toBe("2026-11-22T06:30:00.000Z");
  });
  it("messages hand the ticket over; a new message reopens a closed one", () => {
    expect(canTransition(TICKET, "waiting_fund", "waiting_applicant")).toBe(true);
    expect(canTransition(TICKET, "closed", "waiting_fund")).toBe(true);
  });
});

import { feeRegion, VISIT, ROUND } from "../src/index.js";
describe("visit, rounds, fee region", () => {
  it("fee region follows the factory, else the head office", () => {
    expect(feeRegion([{ usage: "head_office", province: "تهران" }, { usage: "factory", province: "البرز" }])).toBe("outside");
    expect(feeRegion([{ usage: "head_office", province: "تهران" }])).toBe("tehran");
    expect(feeRegion([{ usage: "head_office", province: "اصفهان" }, { usage: "workshop", province: "تهران" }])).toBe("tehran");
  });
  it("machines", () => {
    expect(canTransition(VISIT, "proposed", "done")).toBe(false);
    expect(canTransition(VISIT, "confirmed", "done")).toBe(true);
    expect(canTransition(ROUND, "sent_back", "pending_approval")).toBe(true);
    expect(canTransition(ROUND, "approved", "pending_approval")).toBe(false);
  });
});
