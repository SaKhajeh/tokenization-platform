/** Iranian identifiers. Inputs may contain Persian/Arabic digits. */

export function normalizeDigits(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** "09123456789" | "+989123456789" | "9123456789" → "09123456789" or null. */
export function normalizeMobile(input: string): string | null {
  let s = normalizeDigits(input).replace(/[\s-]/g, "");
  if (s.startsWith("+98")) s = "0" + s.slice(3);
  else if (s.startsWith("0098")) s = "0" + s.slice(4);
  else if (/^9\d{9}$/.test(s)) s = "0" + s;
  return /^09\d{9}$/.test(s) ? s : null;
}

export function normalizeEmail(input: string): string | null {
  const s = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 254 ? s : null;
}

/** کد ملی (10 digits, mod-11 check digit). */
export function isValidNationalCode(input: string): boolean {
  const s = normalizeDigits(input);
  if (!/^\d{10}$/.test(s) || /^(\d)\1{9}$/.test(s)) return false;
  const d = s.split("").map(Number);
  const sum = d.slice(0, 9).reduce((acc, v, i) => acc + v * (10 - i), 0);
  const r = sum % 11;
  return r < 2 ? d[9] === r : d[9] === 11 - r;
}

/**
 * شناسه ملی اشخاص حقوقی (11 digits). Check digit: weights 29,27,23,19,17 (repeating),
 * each digit offset by (10th digit + 2), mod 11, 10 → 0.
 * Verify against a few real IDs before production (VALIDATE_LEGAL_ID_CHECKSUM can disable).
 */
export function isValidLegalNationalId(input: string): boolean {
  const s = normalizeDigits(input);
  if (!/^\d{11}$/.test(s) || /^(\d)\1{10}$/.test(s)) return false;
  const d = s.split("").map(Number);
  const offset = d[9] + 2;
  const w = [29, 27, 23, 19, 17];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (d[i] + offset) * w[i % 5];
  let r = sum % 11;
  if (r === 10) r = 0;
  return r === d[10];
}
