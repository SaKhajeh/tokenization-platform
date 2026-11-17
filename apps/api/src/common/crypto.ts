import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const sha256Hex = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
export const hmacHex = (key: string, s: string) => createHmac("sha256", key).update(s).digest("hex");

/** URL-safe random token (default 32 bytes). */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** 6-digit numeric OTP from a CSPRNG. */
export const otpCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** AES-256-GCM. Output: base64(iv | tag | ciphertext). */
export function encrypt(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function decrypt(key: Buffer, blob: string): string {
  const b = Buffer.from(blob, "base64");
  const d = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}

/** Sorted-key JSON; bigint → string; Date → ISO; undefined dropped. Same rules as @tp/domain termsHash. */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(norm(v));
}
function norm(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(norm);
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(v as object).sort()) {
    const x = (v as Record<string, unknown>)[k];
    if (x !== undefined) o[k] = norm(x);
  }
  return o;
}
