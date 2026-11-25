import { formatMoney, toPersianDigits } from "@tp/domain/money";
import { formatJalali, isoFromUtcDate } from "@tp/domain/jalali";

export const fa = (x: string | number | bigint | null | undefined) => (x === null || x === undefined ? "—" : toPersianDigits(String(x)));

/** Rials (string from the API) → "۱۲٬۵۰۰ تومان". */
export function toman(rials: string | bigint | null | undefined, withUnit = true): string {
  if (rials === null || rials === undefined || rials === "") return "—";
  return formatMoney(BigInt(rials), { unit: "toman", withUnit });
}

/** Large amounts: "۱٫۲ میلیارد تومان" (§6); the exact figure belongs in a title attribute. */
export function tomanShort(rials: string | bigint | null | undefined): string {
  if (rials === null || rials === undefined || rials === "") return "—";
  const t = Number(BigInt(rials) / 10n);
  const units: [number, string][] = [[1e12, "هزار میلیارد"], [1e9, "میلیارد"], [1e6, "میلیون"]];
  for (const [v, w] of units) if (Math.abs(t) >= v) return `${toPersianDigits((t / v).toFixed(t / v >= 100 ? 0 : 1).replace(/\.0$/, "").replace(".", "٫"))} ${w} تومان`;
  return toman(rials);
}

/** Million rials (financial statements) → "۳۱۰٬۰۰۰". */
export function millions(x: number | string | null | undefined): string {
  if (x === null || x === undefined || x === "") return "—";
  const n = Math.round(Number(x));
  const s = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "٬");
  return toPersianDigits(`${n < 0 ? "-" : ""}${s}`);
}

export const pct = (x: number | null | undefined, digits = 1) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : `${toPersianDigits((x * 100).toFixed(digits).replace(".", "٫"))}٪`);
export const dec = (x: number | null | undefined, digits = 2) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : toPersianDigits(x.toFixed(digits).replace(".", "٫")));

/** Calendar date (YYYY-MM-DD) or timestamp → Jalali date, Tehran time zone for timestamps. */
export function jdate(v: string | null | undefined): string {
  if (!v) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return formatJalali(v);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return formatJalali(isoFromUtcDate(new Date(d.getTime() + 3.5 * 3600_000)));
}

export function jdatetime(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const t = new Date(d.getTime() + 3.5 * 3600_000);
  const hh = String(t.getUTCHours()).padStart(2, "0"), mm = String(t.getUTCMinutes()).padStart(2, "0");
  return `${jdate(v)} ${toPersianDigits(`${hh}:${mm}`)}`;
}

/** Persian/Arabic digits typed by the user → Latin digits for the API. */
export const latin = (s: string) => s.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
