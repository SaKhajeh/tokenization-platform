import { describe, it, expect } from "vitest";
import {
  APPLICATION,
  canTransition,
  checkSubscription,
  decideClose,
  formatJalali,
  formatMoney,
  IllegalTransitionError,
  isoToJalali,
  jalaliToIso,
  KYB,
  parseIso,
  parseRial,
  SERIES,
  SUBSCRIPTION,
  termsHash,
  canonicalJson,
  terminalStates,
  toPersianDigits,
  transition,
  WITHDRAWAL,
  addDays,
} from "../src/index.js";

describe("money", () => {
  it("formats rials as toman with Persian digits", () => {
    expect(formatMoney(24_500_000_000n)).toBe("۲٬۴۵۰٬۰۰۰٬۰۰۰ تومان");
    expect(formatMoney(125n)).toBe("۱۲٫۵ تومان");
    expect(formatMoney(-50n, { persian: false })).toBe("-5 تومان");
    expect(formatMoney(1_000n, { unit: "rial", persian: false, withUnit: false })).toBe("1,000");
  });
  it("parses API and Persian-digit strings, rejects decimals and junk", () => {
    expect(parseRial("125000000")).toBe(125_000_000n);
    expect(parseRial("۱۲۵٬۰۰۰")).toBe(125_000n);
    expect(parseRial("١٢٣")).toBe(123n);
    for (const s of ["1.5", "abc", "", "1e9"]) expect(() => parseRial(s)).toThrow();
  });
  it("converts digits", () => {
    expect(toPersianDigits("1405/08/13")).toBe("۱۴۰۵/۰۸/۱۳");
  });
});

describe("jalali", () => {
  it("round-trips dates", () => {
    expect(jalaliToIso("1405/08/13")).toBe("2026-11-04");
    expect(isoToJalali("2026-11-04")).toBe("1405/08/13");
    expect(formatJalali("2026-11-04")).toBe("۱۴۰۵/۰۸/۱۳");
  });
  it("rejects invalid dates", () => {
    expect(() => parseIso("2025-02-30")).toThrow();
    expect(() => parseIso("2025/02/01")).toThrow();
    expect(() => jalaliToIso("1405/13/01")).toThrow();
    expect(() => jalaliToIso("abc")).toThrow();
  });
  it("adds days across month/year ends", () => {
    expect(addDays("2025-03-20", 1)).toBe("2025-03-21"); // Esfand 30 1403 → Farvardin 1 1404
  });
});

describe("decideClose (under-subscription rule)", () => {
  const base = { faceValuePerUnit: 100n, targetAmount: 10_000n, minAmount: null as bigint | null };
  it("all_or_nothing: issues only when fully funded", () => {
    expect(decideClose({ ...base, rule: "all_or_nothing", raisedAmount: 10_000n })).toEqual({
      action: "issue", issuedAmount: 10_000n, issuedUnits: 100n, fullyFunded: true,
    });
    expect(decideClose({ ...base, rule: "all_or_nothing", raisedAmount: 9_900n })).toEqual({ action: "cancel", reason: "below_target" });
  });
  it("keep_raised: issues the raised amount above the minimum", () => {
    expect(decideClose({ ...base, rule: "keep_raised", minAmount: 5_000n, raisedAmount: 6_800n })).toEqual({
      action: "issue", issuedAmount: 6_800n, issuedUnits: 68n, fullyFunded: false,
    });
    expect(decideClose({ ...base, rule: "keep_raised", minAmount: 5_000n, raisedAmount: 4_900n })).toEqual({ action: "cancel", reason: "below_minimum" });
    expect(decideClose({ ...base, rule: "keep_raised", raisedAmount: 100n }).action).toBe("issue");
  });
  it("nothing raised always cancels", () => {
    expect(decideClose({ ...base, rule: "keep_raised", raisedAmount: 0n })).toEqual({ action: "cancel", reason: "nothing_raised" });
  });
  it("validates inputs", () => {
    expect(() => decideClose({ ...base, rule: "keep_raised", raisedAmount: 150n })).toThrow(/whole units/);
    expect(() => decideClose({ ...base, rule: "keep_raised", raisedAmount: 10_100n })).toThrow(/exceed/);
    expect(() => decideClose({ ...base, targetAmount: 150n, rule: "keep_raised", raisedAmount: 100n })).toThrow(/multiple/);
    expect(() => decideClose({ ...base, minAmount: 150n, rule: "keep_raised", raisedAmount: 100n })).toThrow(/multiple/);
    expect(() => decideClose({ ...base, faceValuePerUnit: 0n, rule: "keep_raised", raisedAmount: 0n })).toThrow();
  });
});

describe("checkSubscription (PRD §8.2)", () => {
  const ok = {
    units: 10n, faceValuePerUnit: 10_000_000n, available: 2_450_000_000n, alreadyHeldUnits: 0n,
    minUnitsPerOrg: 10n, maxUnitsPerOrg: 500n as bigint | null, remainingUnits: 160n,
    kybApproved: true, orgFrozen: false, seriesOpen: true, consentsAccepted: true,
  };
  it("passes a valid subscription and returns the amount", () => {
    expect(checkSubscription(ok)).toEqual({ ok: true, amount: 100_000_000n, errors: [] });
  });
  it("reports every failing reason", () => {
    const r = checkSubscription({ ...ok, units: 600n, available: 1n, kybApproved: false, orgFrozen: true, seriesOpen: false, consentsAccepted: false });
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(["KYB_NOT_APPROVED", "ORG_FROZEN", "SERIES_NOT_OPEN", "ABOVE_MAX_UNITS", "CAPACITY_EXCEEDED", "INSUFFICIENT_BALANCE", "CONSENTS_MISSING"]);
    expect(checkSubscription({ ...ok, units: 5n }).errors).toEqual(["BELOW_MIN_UNITS"]);
    expect(checkSubscription({ ...ok, units: 0n }).errors).toEqual(["UNITS_NOT_POSITIVE"]);
    expect(checkSubscription({ ...ok, units: 5n, alreadyHeldUnits: 10n }).ok).toBe(true); // top-up above the minimum
    expect(checkSubscription({ ...ok, units: 600n, maxUnitsPerOrg: null, remainingUnits: 1000n, available: 10n ** 12n }).ok).toBe(true);
  });
});

describe("state machines", () => {
  it("series follows the happy path and cannot skip steps", () => {
    const path = ["draft", "terms_signed", "tokenisation_review", "deployed", "subscription_open", "subscription_closed", "issued", "active", "matured", "paid_out", "redeemed", "closed"] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(SERIES, path[i], path[i + 1])).toBe(true);
    expect(() => transition("series", SERIES, "subscription_open", "issued")).toThrow(IllegalTransitionError);
    expect(canTransition(SERIES, "matured", "defaulted")).toBe(true);
    expect(canTransition(SERIES, "active", "cancelled")).toBe(false);
  });
  it("terminal states have no exits", () => {
    expect(terminalStates(SERIES).sort()).toEqual(["cancelled", "closed"]);
    expect(terminalStates(SUBSCRIPTION).sort()).toEqual(["allocated", "cancelled", "released"]);
    expect(terminalStates(APPLICATION).sort()).toEqual(["expired", "handed_to_tokenisation", "rejected", "withdrawn"]);
    expect(terminalStates(WITHDRAWAL).sort()).toEqual(["cancelled", "failed", "reverted"]); // completed → reverted if the bank returns it
    expect(terminalStates(KYB)).toEqual([]);
  });
  it("every target state is a known state", () => {
    for (const m of [SERIES, APPLICATION, SUBSCRIPTION, KYB, WITHDRAWAL] as Record<string, readonly string[]>[]) {
      for (const tos of Object.values(m)) for (const t of tos) expect(Object.keys(m)).toContain(t);
    }
  });
  it("transition returns the new state", () => {
    expect(transition("kyb", KYB, "in_review", "approved")).toBe("approved");
  });
});

describe("termsHash", () => {
  it("is independent of key order and changes with any value", () => {
    const a = { b: 1n, a: "x", nested: { z: 1, y: [2n, { q: null }] } };
    const b = { nested: { y: [2n, { q: null }], z: 1 }, a: "x", b: 1n };
    expect(termsHash(a)).toBe(termsHash(b));
    expect(termsHash(a)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(termsHash({ ...a, b: 2n })).not.toBe(termsHash(a));
    expect(canonicalJson({ b: 1, a: undefined, c: [1n] })).toBe('{"b":1,"c":["1"]}');
    expect(() => canonicalJson({ x: Infinity })).toThrow();
  });
});
