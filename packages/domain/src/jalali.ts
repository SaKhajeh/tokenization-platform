import jalaali from "jalaali-js";
import { toPersianDigits } from "./money.js";

/**
 * Calendar dates are plain "YYYY-MM-DD" Gregorian strings in storage and the API (no time zone).
 * Jalali conversion happens at the edges (UI) and inside the return engine.
 */
export type IsoDate = string; // "2025-09-23"

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const JAL_RE = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/;

export function parseIso(d: IsoDate): { y: number; m: number; d: number } {
  const m = ISO_RE.exec(d);
  if (!m) throw new Error(`Invalid ISO date: "${d}"`);
  const y = +m[1], mo = +m[2], da = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, da));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== da) {
    throw new Error(`Invalid calendar date: "${d}"`);
  }
  return { y, m: mo, d: da };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function isoFromUtcDate(dt: Date): IsoDate {
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function isoToUtcDate(d: IsoDate): Date {
  const { y, m, d: da } = parseIso(d);
  return new Date(Date.UTC(y, m - 1, da));
}

export function addDays(d: IsoDate, n: number): IsoDate {
  const dt = isoToUtcDate(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return isoFromUtcDate(dt);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((isoToUtcDate(to).getTime() - isoToUtcDate(from).getTime()) / 86_400_000);
}

/** "1403/07/01" → "2024-09-22" */
export function jalaliToIso(j: string): IsoDate {
  const m = JAL_RE.exec(j.trim());
  if (!m) throw new Error(`Invalid Jalali date: "${j}"`);
  const jy = +m[1], jm = +m[2], jd = +m[3];
  if (!jalaali.isValidJalaaliDate(jy, jm, jd)) throw new Error(`Invalid Jalali date: "${j}"`);
  const g = jalaali.toGregorian(jy, jm, jd);
  return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`;
}

/** "2024-09-22" → "1403/07/01" (Latin digits; use formatJalali for display) */
export function isoToJalali(d: IsoDate): string {
  const { y, m, d: da } = parseIso(d);
  const j = jalaali.toJalaali(y, m, da);
  return `${j.jy}/${pad(j.jm)}/${pad(j.jd)}`;
}

export function formatJalali(d: IsoDate, persian = true): string {
  const s = isoToJalali(d);
  return persian ? toPersianDigits(s) : s;
}

export function jalaliYearOf(d: IsoDate): number {
  const { y, m, d: da } = parseIso(d);
  return jalaali.toJalaali(y, m, da).jy;
}

export function isLeapJalaliYear(jy: number): boolean {
  return jalaali.isLeapJalaaliYear(jy);
}

export function daysInJalaliYear(jy: number): 365 | 366 {
  return isLeapJalaliYear(jy) ? 366 : 365;
}
