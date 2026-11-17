/**
 * The API's only door to Polygon. The chain worker (chain.service.ts) calls it; nothing else does.
 *
 * - EvmChain: real network through MultiRpcProvider (several RPC endpoints with failover), signed by the operator key.
 *   The operator key is a hot key for testnet; in production it moves behind Web3Signer + OpenBao.
 * - MockChain: in-memory registry for tests and local dev.
 */
import { Contract, HDNodeWallet, Network, NonceManager, Wallet, getAddress, keccak256, parseUnits, toUtf8Bytes } from "ethers";
import { MultiRpcProvider } from "./rpc.js";

export const REGISTRY_ABI = [
  "function register(address wallet, bytes32 orgIdHash, uint8 flags, bytes32 kybHash, uint64 expiry)",
  "function update(address wallet, uint8 flags, bytes32 kybHash, uint64 expiry)",
  "function revoke(address wallet)",
  "function reinstate(address wallet)",
  "function isVerified(address wallet) view returns (bool)",
  "function identityOf(address wallet) view returns (tuple(bytes32 orgIdHash, bytes32 kybHash, uint64 expiry, uint8 flags, bool revoked, bool exists))",
  "error AlreadyRegistered(address wallet)",
  "error NotRegistered(address wallet)",
  "error ExpiryInPast(uint64 expiry)",
  "error EmptyHash()",
  "error ZeroAddress()",
  "error NotRevoked(address wallet)",
];

export const FLAG_INVESTOR = 1;
export const FLAG_ISSUER = 2;
export const FLAG_FUND = 4;

export type ChainCall =
  | { kind: "register_identity"; wallet: string; orgIdHash: string; flags: number; kybHash: string; expiry: number }
  | { kind: "update_identity"; wallet: string; flags: number; kybHash: string; expiry: number }
  | { kind: "revoke_identity"; wallet: string }
  | { kind: "reinstate_identity"; wallet: string };

export interface OnchainIdentity {
  exists: boolean;
  revoked: boolean;
  expiry: number;
  kybHash: string;
  flags: number;
}

/** True when the chain already reflects this call (so it must not be sent again). */
export function alreadyApplied(call: ChainCall, id: OnchainIdentity | null): boolean {
  switch (call.kind) {
    case "register_identity":
      return !!id?.exists;
    case "update_identity":
      return !!id?.exists && id.kybHash.toLowerCase() === call.kybHash.toLowerCase() && id.flags === call.flags && id.expiry === call.expiry;
    case "revoke_identity":
      return !!id?.exists && id.revoked;
    case "reinstate_identity":
      return !!id?.exists && !id.revoked;
  }
}

export type Receipt =
  | { status: "pending" }
  | { status: "success" | "reverted"; blockNumber: number; gasUsed: string };

export interface ChainGateway {
  readonly chainId: number;
  readonly explorer: string | null;
  /** Current on-chain record, or null if this wallet was never registered. */
  identity(wallet: string): Promise<OnchainIdentity | null>;
  /** Signs and broadcasts. Returns the tx hash. Throws on a revert found while estimating gas. */
  send(call: ChainCall): Promise<string>;
  /** "success" only once the tx has `confirmations` blocks on top. */
  receipt(hash: string): Promise<Receipt>;
}
export const CHAIN = Symbol("CHAIN");

/** keccak256("<salt>:<org id>") — the on-chain org ID reveals nothing without the salt. */
export const orgIdHash = (salt: string, orgId: string) => keccak256(toUtf8Bytes(`${salt}:${orgId}`));

/**
 * Custodial org addresses are derived from an extended PUBLIC key: the API server can create addresses but holds no
 * private keys for them. The matching private keys stay with custody (offline / vault) and are not needed in v1,
 * because org tokens only move by operator mint/burn and admin forcedTransfer.
 */
export function deriveOrgAddress(xpub: string, index: number): string {
  return getAddress(HDNodeWallet.fromExtendedKey(xpub).deriveChild(index).address);
}

export interface EvmChainConfig {
  chainId: number;
  rpcUrls: string[];
  registryAddress: string;
  operatorPrivateKey: string;
  confirmations: number;
  minPriorityFeeGwei: string;
  explorer: string | null;
}

export class EvmChain implements ChainGateway {
  readonly chainId: number;
  readonly explorer: string | null;
  private readonly provider: MultiRpcProvider;
  private readonly signer: NonceManager;
  private readonly registry: Contract;

  constructor(private readonly cfg: EvmChainConfig) {
    this.chainId = cfg.chainId;
    this.explorer = cfg.explorer;
    this.provider = new MultiRpcProvider(cfg.rpcUrls, Network.from(cfg.chainId));
    this.signer = new NonceManager(new Wallet(cfg.operatorPrivateKey, this.provider));
    this.registry = new Contract(cfg.registryAddress, REGISTRY_ABI, this.signer);
  }

  async identity(wallet: string) {
    const r = await (this.registry.connect(this.provider) as Contract).identityOf(wallet);
    if (!r.exists) return null;
    return { exists: true, revoked: r.revoked, expiry: Number(r.expiry), kybHash: r.kybHash, flags: Number(r.flags) };
  }

  private async fees() {
    if (this.chainId === 31337) return {};
    const block = await this.provider.getBlock("latest");
    const tip = parseUnits(this.cfg.minPriorityFeeGwei, "gwei");
    const base = block?.baseFeePerGas ?? parseUnits("30", "gwei");
    return { maxPriorityFeePerGas: tip, maxFeePerGas: base * 2n + tip };
  }

  async send(call: ChainCall): Promise<string> {
    const fees = await this.fees();
    try {
      const r = this.registry;
      const tx =
        call.kind === "register_identity" ? await r.register(call.wallet, call.orgIdHash, call.flags, call.kybHash, call.expiry, fees)
        : call.kind === "update_identity" ? await r.update(call.wallet, call.flags, call.kybHash, call.expiry, fees)
        : call.kind === "revoke_identity" ? await r.revoke(call.wallet, fees)
        : await r.reinstate(call.wallet, fees);
      return tx.hash;
    } catch (e) {
      this.signer.reset(); // a failed send may have consumed nothing; re-read the nonce next time
      throw e;
    }
  }

  async receipt(hash: string): Promise<Receipt> {
    const r = await this.provider.getTransactionReceipt(hash);
    if (!r) return { status: "pending" };
    // Raw call: ethers caches getBlockNumber() for a few seconds, which would under-count confirmations.
    const head = Number(await this.provider.send("eth_blockNumber", []));
    if (head - r.blockNumber + 1 < this.cfg.confirmations) return { status: "pending" };
    return { status: r.status === 1 ? "success" : "reverted", blockNumber: r.blockNumber, gasUsed: r.gasUsed.toString() };
  }

  destroy() {
    this.provider.destroy();
  }
}

/** In-memory registry with the same rules as the contract. Tests can make it fail or lag. */
export class MockChain implements ChainGateway {
  readonly chainId = 31337;
  readonly explorer = null;
  readonly identities = new Map<string, { exists: boolean; revoked: boolean; expiry: number; kybHash: string; orgIdHash: string; flags: number }>();
  readonly txs = new Map<string, { call: ChainCall; status: "pending" | "success" | "reverted" }>();
  /** Test hooks. */
  failNextSend = 0;
  autoConfirm = true;
  private n = 0;

  async identity(wallet: string) {
    const r = this.identities.get(getAddress(wallet));
    return r ? { exists: r.exists, revoked: r.revoked, expiry: r.expiry, kybHash: r.kybHash, flags: r.flags } : null;
  }

  async send(call: ChainCall): Promise<string> {
    if (this.failNextSend > 0) {
      this.failNextSend--;
      throw new Error("all 3 RPC endpoints failed for eth_sendRawTransaction: timeout");
    }
    const w = getAddress(call.wallet);
    const revert = (m: string) => Object.assign(new Error(`execution reverted: ${m}`), { code: "CALL_EXCEPTION" });
    if (call.kind === "register_identity") {
      if (this.identities.has(w)) throw revert(`AlreadyRegistered(${w})`);
      this.identities.set(w, { exists: true, revoked: false, expiry: call.expiry, kybHash: call.kybHash, orgIdHash: call.orgIdHash, flags: call.flags });
    } else {
      const r = this.identities.get(w);
      if (!r) throw revert(`NotRegistered(${w})`);
      if (call.kind === "update_identity") Object.assign(r, { flags: call.flags, kybHash: call.kybHash, expiry: call.expiry });
      else if (call.kind === "revoke_identity") r.revoked = true;
      else {
        if (!r.revoked) throw revert(`NotRevoked(${w})`);
        r.revoked = false;
      }
    }
    const hash = "0x" + (++this.n).toString(16).padStart(64, "0");
    this.txs.set(hash, { call, status: this.autoConfirm ? "success" : "pending" });
    return hash;
  }

  async receipt(hash: string): Promise<Receipt> {
    const t = this.txs.get(hash);
    if (!t || t.status === "pending") return { status: "pending" };
    return { status: t.status, blockNumber: 1, gasUsed: "104703" };
  }

  confirmAll() {
    for (const t of this.txs.values()) if (t.status === "pending") t.status = "success";
  }
}
