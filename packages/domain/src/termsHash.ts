import { createHash } from "node:crypto";

/**
 * Canonical JSON (FR-SER-3): object keys sorted, no whitespace, bigint as decimal string,
 * undefined dropped. The SHA-256 of this string is the series `termsHash` stored on-chain.
 * Any change to the terms produces a different hash.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalise(value));
}

function normalise(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (v === null || typeof v !== "object") {
    if (typeof v === "number" && !Number.isFinite(v)) throw new Error("Non-finite number in terms");
    return v;
  }
  if (Array.isArray(v)) return v.map(normalise);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as Record<string, unknown>).sort()) {
    const x = (v as Record<string, unknown>)[k];
    if (x !== undefined) out[k] = normalise(x);
  }
  return out;
}

/** 0x-prefixed 32-byte hex, ready to pass as `bytes32 termsHash`. */
export function termsHash(terms: unknown): `0x${string}` {
  return `0x${createHash("sha256").update(canonicalJson(terms), "utf8").digest("hex")}`;
}
