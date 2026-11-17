/**
 * Multi-provider Polygon RPC client (decision D6: no own node for now).
 *
 * - Endpoints come from env as a comma-separated list, in priority order:
 *     AMOY_RPC_URLS=https://lb.drpc.org/ogrpc?network=polygon-amoy&dkey=<key>,https://polygon-amoy.drpc.org
 *     POLYGON_RPC_URLS=https://lb.drpc.org/ogrpc?network=polygon&dkey=<key>,https://polygon.drpc.org
 * - Reads go to the first healthy endpoint. A transport failure (timeout, no connection, HTTP 5xx/429, rate-limit or
 *   "node not synced" errors) moves to the next endpoint and benches the bad one for 60 s. Real answers, including
 *   "execution reverted", are returned as-is: they are the chain's answer, not the provider's fault.
 * - Signed transactions are broadcast to every endpoint: the same signed bytes, so no duplicates are possible.
 * - Keys never leave this machine; providers only ever see signed transactions.
 * - Confirmation is cross-checked on two different endpoints when two are configured.
 * - Polygon enforces a minimum priority fee; we never go below MIN_PRIORITY_FEE_GWEI (default 30).
 *
 * The backend chain worker will reuse this module.
 */
import {
  FetchRequest,
  JsonRpcApiProvider,
  JsonRpcProvider,
  Network,
  NonceManager,
  Wallet,
  parseUnits,
  TransactionResponse,
} from "ethers";
import type { JsonRpcError, JsonRpcPayload, JsonRpcResult } from "ethers";

export interface ChainSpec {
  name: "amoy" | "polygon" | "localhost";
  chainId: number;
  envVar: string;
  explorer: string | null;
}

export const CHAINS: Record<string, ChainSpec> = {
  amoy: { name: "amoy", chainId: 80002, envVar: "AMOY_RPC_URLS", explorer: "https://amoy.polygonscan.com" },
  polygon: { name: "polygon", chainId: 137, envVar: "POLYGON_RPC_URLS", explorer: "https://polygonscan.com" },
  localhost: { name: "localhost", chainId: 31337, envVar: "LOCALHOST_RPC_URLS", explorer: null },
};

export function chainSpec(name: string): ChainSpec {
  const c = CHAINS[name];
  if (!c) throw new Error(`Unknown network "${name}". Use one of: ${Object.keys(CHAINS).join(", ")}`);
  return c;
}

/** Reads the endpoint list; the legacy single-URL variable (AMOY_RPC_URL / POLYGON_RPC_URL) is accepted too. */
export function rpcUrls(c: ChainSpec): string[] {
  const legacy = process.env[c.envVar.replace(/_URLS$/, "_URL")];
  const raw = process.env[c.envVar] ?? legacy ?? (c.name === "localhost" ? "http://127.0.0.1:8545" : "");
  const urls = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!urls.length) throw new Error(`Set ${c.envVar} in .env (comma-separated RPC URLs).`);
  return urls;
}

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

export function makeEndpoints(c: ChainSpec, urls = rpcUrls(c)): JsonRpcProvider[] {
  const net = Network.from(c.chainId);
  // staticNetwork: skip per-call chain detection, and never silently follow a provider onto another chain.
  return urls.map((u) => new JsonRpcProvider(u, net, { staticNetwork: net, batchMaxCount: 1 }));
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

export function makeProvider(c: ChainSpec, _endpoints?: JsonRpcProvider[], urls = rpcUrls(c)) {
  return new MultiRpcProvider(urls, Network.from(c.chainId));
}

/** Checks every endpoint answers with the expected chain id. Returns per-endpoint results. */
export async function checkEndpoints(c: ChainSpec, urls = rpcUrls(c)) {
  const results = [];
  for (const url of urls) {
    // staticNetwork: no detection retries (eth_chainId below still returns the real chain id).
    const p = new JsonRpcProvider(url, Network.from(c.chainId), { staticNetwork: Network.from(c.chainId), batchMaxCount: 1 });
    const t0 = Date.now();
    try {
      const [chainHex, block] = await Promise.race([
        Promise.all([p.send("eth_chainId", []), p.send("eth_blockNumber", [])]),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout after 10s")), 10_000)),
      ]);
      const chainId = Number(chainHex);
      results.push({ url: redact(url), ok: chainId === c.chainId, chainId, block: Number(block), ms: Date.now() - t0, error: chainId === c.chainId ? null : `wrong chain ${chainId}` });
    } catch (e: any) {
      // Show the HTTP status / provider message: an empty message is useless when a key is wrong.
      const status = e?.info?.responseStatus ?? e?.error?.status ?? "";
      const body = e?.info?.responseBody ?? e?.error?.message ?? "";
      const msg = [e?.code, status, e?.shortMessage || e?.message, body].filter(Boolean).join(" · ") || String(e);
      results.push({ url: redact(url), ok: false, chainId: null, block: null, ms: Date.now() - t0, error: msg.replace(/\s+/g, " ").slice(0, 240) });
    } finally {
      p.destroy();
    }
  }
  return results;
}

export function signerFromEnv(provider: JsonRpcApiProvider): NonceManager {
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk) throw new Error("DEPLOYER_PRIVATE_KEY is not set. Run `npm run wallet:new -w @tp/contracts` first.");
  // NonceManager keeps the nonce locally, so a lagging endpoint cannot hand us a stale nonce mid-script.
  return new NonceManager(new Wallet(pk, provider));
}

/** EIP-1559 fees with Polygon's priority-fee floor. Pass the result as overrides on every transaction. */
export async function feeOverrides(provider: JsonRpcApiProvider, c: ChainSpec, endpoints: JsonRpcProvider[] = []) {
  if (c.name === "localhost") return {};
  const floor = parseUnits(process.env.MIN_PRIORITY_FEE_GWEI ?? "30", "gwei");
  const block = await provider.getBlock("latest");
  const base = block?.baseFeePerGas ?? parseUnits("30", "gwei");
  let tip = floor;
  for (const e of endpoints) {
    try {
      const suggested = BigInt(await e.send("eth_maxPriorityFeePerGas", []));
      if (suggested > tip) tip = suggested;
      break;
    } catch {
      /* try the next endpoint; the floor is a safe default */
    }
  }
  return { maxPriorityFeePerGas: tip, maxFeePerGas: base * 2n + tip };
}

/**
 * Waits for `confirmations` blocks, then requires TWO different endpoints (when two or more are configured) to
 * return the receipt with the same status and block hash. Unreachable endpoints are skipped. Protects against one
 * provider lying, lagging or sitting on a fork.
 */
export async function confirmed(tx: TransactionResponse, endpoints: JsonRpcProvider[], confirmations = 3) {
  const r = await tx.wait(confirmations);
  if (!r || r.status !== 1) throw new Error(`tx ${tx.hash} failed`);
  const needed = Math.min(2, endpoints.length);
  if (needed < 2) return r;
  for (let attempt = 0; attempt < 15; attempt++) {
    const receipts = await Promise.all(endpoints.map((e) => e.getTransactionReceipt(tx.hash).catch(() => null)));
    const seen = receipts.filter((x) => x !== null);
    if (seen.some((x) => x!.status !== 1 || x!.blockHash !== r.blockHash)) throw new Error(`endpoints disagree on tx ${tx.hash}`);
    if (seen.length >= needed) return r;
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error(`tx ${tx.hash} was confirmed by fewer than ${needed} endpoints`);
}

export function txLink(c: ChainSpec, hash: string) {
  return c.explorer ? `${c.explorer}/tx/${hash}` : hash;
}
export function addrLink(c: ChainSpec, addr: string) {
  return c.explorer ? `${c.explorer}/address/${addr}` : addr;
}
