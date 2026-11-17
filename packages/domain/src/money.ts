/**
 * Money is always integer RIALS as bigint (PRD FR-LED-1). Never use JS number for money.
 * API transport: decimal strings. UI display: toman, Persian digits, "٬" separator.
 */

export type Rial = bigint;

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function toPersianDigits(s: string | number | bigint): string {
  return String(s).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

export function fromPersianDigits(s: string): string {
  return s.replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d))).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** Parse an API money string ("125000000") into rials. Rejects decimals, signs other than '-', and junk. */
export function parseRial(s: string): Rial {
  const t = fromPersianDigits(s.trim()).replace(/[,٬]/g, "");
  if (!/^-?\d+$/.test(t)) throw new Error(`Invalid rial amount: "${s}"`);
  return BigInt(t);
}

export function rialToString(r: Rial): string {
  return r.toString();
}

function groupThousands(digits: string, sep: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/**
 * Format rials for display.
 * - unit "toman" (default): divides by 10; a non-zero remainder is shown as a decimal (e.g. ۱۲٫۵ تومان).
 * - Persian digits and "٬" thousands separator by default.
 */
export function formatMoney(
  amount: Rial,
  opts: { unit?: "toman" | "rial"; persian?: boolean; withUnit?: boolean } = {},
): string {
  const unit = opts.unit ?? "toman";
  const persian = opts.persian ?? true;
  const withUnit = opts.withUnit ?? true;
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  let body: string;
  if (unit === "toman") {
    const whole = abs / 10n;
    const rem = abs % 10n;
    body = groupThousands(whole.toString(), persian ? "٬" : ",") + (rem ? (persian ? "٫" : ".") + rem.toString() : "");
  } else {
    body = groupThousands(abs.toString(), persian ? "٬" : ",");
  }
  if (persian) body = toPersianDigits(body);
  const label = unit === "toman" ? "تومان" : "ریال";
  return `${neg ? "-" : ""}${body}${withUnit ? " " + label : ""}`;
}

export const tomanToRial = (toman: bigint): Rial => toman * 10n;

/** Sum without float drift. */
export const sumRial = (xs: Rial[]): Rial => xs.reduce((a, b) => a + b, 0n);
