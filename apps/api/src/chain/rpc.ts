/**
 * Request-level failover JSON-RPC provider for Polygon (decision D6).
 * Port of packages/contracts/scripts/lib/rpc.ts (proven on Amoy on 2026-11-08); keep the two in sync until both
 * move into a shared packages/chain.
 */
import { FetchRequest, JsonRpcApiProvider, Network } from "ethers";
import type { JsonRpcError, JsonRpcPayload, JsonRpcResult } from "ethers";

/** Hides API keys in logs: https://lb.drpc.live/polygon/AbCd...xyz → https://lb.drpc.live/polygon/AbC…(key) */
export function redact(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").map((p) => (p.length >= 20 ? p.slice(0, 3) + "…(key)" : p));
    const q = u.search ? "?…" : "";
    return `${u.protocol}//${u.host}${parts.join("/")}${q}`;
  } catch {
    return "(invalid url)";
  }
}

/** JSON-RPC error codes/messages that mean "this provider failed", not "the chain said no". */
function isProviderFault(err: { code?: number; message?: string; data?: unknown } | undefined): boolean {
  if (!err) return false;
  const m = (err.message ?? "").toLowerCase();
  // The chain's own answers: reverts (often code -32603 or 3 with revert data), gas/funds/nonce problems.
  if (err.data !== undefined && err.data !== null && err.data !== "0x") return false;
  if (/revert|vm exception|invalid opcode|out of gas|insufficient funds|nonce|underpriced|already known|intrinsic gas/.test(m)) return false;
  if (err.code === -32005 || err.code === -32603 || err.code === -32001) return true; // limit exceeded / internal / resource
  return /rate limit|too many requests|limit exceeded|timeout|header not found|missing trie node|not synced|unavailable|internal error|bad gateway/.test(m);
}

/**
 * One provider object over many endpoints, with failover at the request level (replaces ethers' FallbackProvider,
 * whose quorum logic can pass a single endpoint's 500 straight through to the caller).
 */
export class MultiRpcProvider extends JsonRpcApiProvider {
  private readonly benchedUntil = new Map<string, number>();

  constructor(private readonly urls: string[], network: Network, private readonly timeoutMs = 10_000) {
    super(network, { staticNetwork: network, batchMaxCount: 1 });
  }

  private ordered(): string[] {
    const now = Date.now();
    const ok = this.urls.filter((u) => (this.benchedUntil.get(u) ?? 0) <= now);
    const benched = this.urls.filter((u) => (this.benchedUntil.get(u) ?? 0) > now);
    return [...ok, ...benched]; // benched endpoints are still tried, last
  }

  private async post(url: string, payload: JsonRpcPayload): Promise<JsonRpcResult | JsonRpcError> {
    const req = new FetchRequest(url);
    req.body = JSON.stringify(payload);
    req.setHeader("content-type", "application/json");
    req.timeout = this.timeoutMs;
    req.retryFunc = async () => false; // we do our own failover
    const resp = await req.send();
    if (resp.statusCode === 429 || resp.statusCode >= 500) throw new Error(`HTTP ${resp.statusCode}`);
    const body = resp.bodyJson as JsonRpcResult | JsonRpcError;
    if (!body || typeof body !== "object" || !("id" in body)) throw new Error(`bad JSON-RPC response (HTTP ${resp.statusCode})`);
    if ("error" in body && isProviderFault(body.error)) throw new Error(`provider error ${body.error.code}: ${body.error.message}`);
    return body;
  }

  private bench(url: string, e: unknown) {
    this.benchedUntil.set(url, Date.now() + 60_000);
    if (process.env.RPC_DEBUG) console.warn(`  [rpc] ${redact(url)} failed: ${(e as Error)?.message ?? e}; trying next`);
  }

  async _send(payload: JsonRpcPayload | Array<JsonRpcPayload>): Promise<Array<JsonRpcResult | JsonRpcError>> {
    const one = Array.isArray(payload) ? payload[0] : payload; // batchMaxCount: 1
    if (one.method === "eth_sendRawTransaction") return [await this.broadcast(one)];
    let last: unknown;
    for (const url of this.ordered()) {
      try {
        return [await this.post(url, one)];
      } catch (e) {
        last = e;
        this.bench(url, e);
      }
    }
    throw new Error(`all ${this.urls.length} RPC endpoints failed for ${one.method}: ${(last as Error)?.message ?? last}`);
  }

  /** Sends the same signed bytes to every endpoint; success if any accepts (or reports it already known). */
  private async broadcast(one: JsonRpcPayload): Promise<JsonRpcResult | JsonRpcError> {
    const settled = await Promise.allSettled(this.urls.map((u) => this.post(u, one)));
    const answers = settled.flatMap((r, i) => (r.status === "fulfilled" ? [r.value] : (this.bench(this.urls[i], r.reason), [])));
    const ok = answers.find((a) => "result" in a);
    if (ok) return ok;
    const known = answers.find((a) => "error" in a && /already known|known transaction/i.test(a.error.message ?? ""));
    if (known && "error" in known) {
      // Another endpoint (or an earlier attempt) already has it: report the tx hash as success.
      const { keccak256 } = await import("ethers");
      return { id: one.id, result: keccak256((one.params as string[])[0]) } as JsonRpcResult;
    }
    if (answers.length) return answers[0];
    throw new Error("no RPC endpoint accepted the transaction");
  }
}

