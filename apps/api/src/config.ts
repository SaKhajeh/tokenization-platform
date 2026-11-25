import { randomBytes } from "node:crypto";
import { HDNodeWallet } from "ethers";

/** Hardhat's public test mnemonic: dev/test only, never holds value. */
const TEST_MNEMONIC = "test test test test test test test test test test test junk";

export interface AppConfig {
  env: "development" | "test" | "staging" | "production";
  port: number;
  databaseUrl: string;
  jwtSecret: Uint8Array; // HS256 key for access tokens
  accessTokenTtlSec: number;
  refreshTokenTtlSec: number;
  otpTtlSec: number;
  otpResendCooldownSec: number;
  otpMaxPerHour: number;
  otpMaxAttempts: number;
  stepUpTtlSec: number;
  invitationTtlSec: number;
  /** Return invitation tokens in API responses (dev/test only; production sends them by SMS/email). */
  exposeInvitationTokens: boolean;
  /** HMAC pepper for OTP codes, national codes and lookup hashes. */
  pepper: string;
  /** 32-byte AES-256-GCM key for field-level encryption (national codes). */
  dataEncryptionKey: Buffer;
  /** Validate the 11-digit legal national ID (شناسه ملی) check digit. */
  validateLegalIdChecksum: boolean;
  documentMaxBytes: number;
  documentUrlTtlSec: number;
  /** An idempotency key with no recorded response older than this is treated as abandoned (the request died before committing). */
  idempotencyStaleSec: number;
  /** Development only: the API base URL the browser uses (through the apps' proxy), for dev upload/download links. */
  devPublicApiUrl: string;
  s3: { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string };
  jibit: {
    baseUrl: string; smsApiKey: string; smsSecret: string; smsSender: string; smsOtpTemplate: string; ideApiKey: string; ideSecret: string;
    cobankApiKey: string; cobankSecret: string;
  };
  /** sms/identity(+registry)/storage/cobank/chain: real providers in staging+prod, mocks in dev/test. */
  providers: { sms: "jibit" | "mock"; identity: "jibit" | "mock"; storage: "s3" | "memory"; cobank: "jibit" | "mock"; chain: "evm" | "mock" };
  /** The fund's collection account (connected to Jibit Cobank): where every deposit lands. */
  collection: { iban: string; bankName: string; holderName: string };
  kyb: { validityDays: number; snapshotMaxAgeDays: number };
  bank: { coolingOffHours: number };
  withdrawals: {
    /** Off in production until tested against Jibit's sandbox. */
    enabled: boolean;
    /** At or above this amount (rials) the fund manager must also approve. */
    fundApprovalThreshold: bigint;
    /** At or above this amount (rials) transfers to another bank go by Satna (RTGS), below by Paya (ACH). To confirm with Jibit. */
    satnaThreshold: bigint;
    /** Jibit transferReason for investor withdrawals. To confirm with Jibit (open question §7.5). */
    transferReason: string;
  };
  chain: {
    chainId: number;
    rpcUrls: string[];
    registryAddress: string;
    operatorPrivateKey: string;
    confirmations: number;
    /** A sent transaction with no confirmed receipt after this many seconds goes back to the queue (dropped or stuck). */
    staleAfterSec: number;
    minPriorityFeeGwei: string;
    explorer: string | null;
    /** Extended PUBLIC key for custodial org addresses: the API can derive addresses but holds no private keys. */
    custodyXpub: string;
    /** Salt for orgIdHash on-chain. */
    orgIdSalt: string;
  };
}

const req = (name: string, fallback?: string): string => {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env ${name}`);
  return v;
};

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const env = (process.env.APP_ENV ?? "development") as AppConfig["env"];
  const prod = env === "production" || env === "staging";
  const devKey = randomBytes(32);
  const cfg: AppConfig = {
    env,
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: req("DATABASE_URL", prod ? undefined : "postgres://tp:tp_dev_password@localhost:5432/tp"),
    jwtSecret: new TextEncoder().encode(req("JWT_SECRET", prod ? undefined : "dev-only-jwt-secret-change-me-0123456789")),
    accessTokenTtlSec: 15 * 60,
    refreshTokenTtlSec: 30 * 24 * 3600,
    otpTtlSec: 120,
    otpResendCooldownSec: 60,
    otpMaxPerHour: 5,
    otpMaxAttempts: 5,
    stepUpTtlSec: 300,
    invitationTtlSec: 7 * 24 * 3600,
    exposeInvitationTokens: !prod,
    pepper: req("HASH_PEPPER", prod ? undefined : "dev-only-pepper"),
    dataEncryptionKey: process.env.DATA_ENCRYPTION_KEY ? Buffer.from(process.env.DATA_ENCRYPTION_KEY, "base64") : prod ? (() => { throw new Error("Missing env DATA_ENCRYPTION_KEY"); })() : devKey,
    validateLegalIdChecksum: process.env.VALIDATE_LEGAL_ID_CHECKSUM !== "false",
    documentMaxBytes: 20 * 1024 * 1024,
    documentUrlTtlSec: 300,
    idempotencyStaleSec: Number(process.env.IDEMPOTENCY_STALE_SEC ?? 300),
    devPublicApiUrl: process.env.DEV_PUBLIC_API_URL ?? "/api/v1",
    s3: {
      endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
      region: process.env.S3_REGION ?? "us-east-1",
      bucket: process.env.S3_BUCKET ?? "tp-documents",
      accessKeyId: process.env.S3_ACCESS_KEY ?? "tp",
      secretAccessKey: process.env.S3_SECRET_KEY ?? "tp_dev_password",
    },
    jibit: {
      baseUrl: process.env.JIBIT_BASE_URL ?? "https://napi.jibit.ir",
      smsApiKey: process.env.JIBIT_PULSE_API_KEY ?? "",
      smsSecret: process.env.JIBIT_PULSE_SECRET ?? "",
      smsSender: process.env.JIBIT_SMS_SENDER ?? "",
      smsOtpTemplate: process.env.JIBIT_SMS_OTP_TEMPLATE ?? "",
      ideApiKey: process.env.JIBIT_IDE_API_KEY ?? "",
      ideSecret: process.env.JIBIT_IDE_SECRET ?? "",
      cobankApiKey: process.env.JIBIT_COBANK_API_KEY ?? "",
      cobankSecret: process.env.JIBIT_COBANK_SECRET ?? "",
    },
    providers: {
      sms: (process.env.SMS_PROVIDER as "jibit" | "mock") ?? (prod ? "jibit" : "mock"),
      identity: (process.env.IDENTITY_PROVIDER as "jibit" | "mock") ?? (prod ? "jibit" : "mock"),
      storage: (process.env.STORAGE_PROVIDER as "s3" | "memory") ?? (prod ? "s3" : "memory"),
      cobank: (process.env.COBANK_PROVIDER as "jibit" | "mock") ?? (prod ? "jibit" : "mock"),
      chain: (process.env.CHAIN_PROVIDER as "evm" | "mock") ?? (prod ? "evm" : "mock"),
    },
    collection: {
      iban: req("COLLECTION_IBAN", prod ? undefined : "IR000000000000000000000001"),
      bankName: process.env.COLLECTION_BANK_NAME ?? "بانک آزمون",
      holderName: process.env.COLLECTION_HOLDER_NAME ?? "صندوق پژوهش و فناوری",
    },
    kyb: { validityDays: Number(process.env.KYB_VALIDITY_DAYS ?? 365), snapshotMaxAgeDays: 30 },
    bank: { coolingOffHours: Number(process.env.BANK_COOLING_OFF_HOURS ?? 24) },
    withdrawals: {
      enabled: (process.env.WITHDRAWALS_ENABLED ?? (prod ? "false" : "true")) === "true",
      fundApprovalThreshold: BigInt(process.env.WITHDRAWAL_FUND_APPROVAL_THRESHOLD ?? "10000000000"),
      satnaThreshold: BigInt(process.env.SATNA_THRESHOLD ?? "1500000000"),
      transferReason: process.env.WITHDRAWAL_TRANSFER_REASON ?? "MODIRIAT_NAGHDINEGI",
    },
    chain: {
      chainId: Number(process.env.CHAIN_ID ?? (prod ? 137 : 80002)),
      rpcUrls: (process.env.CHAIN_RPC_URLS ?? "").split(",").map((x) => x.trim()).filter(Boolean),
      registryAddress: process.env.IDENTITY_REGISTRY_ADDRESS ?? "",
      operatorPrivateKey: process.env.OPERATOR_PRIVATE_KEY ?? "",
      confirmations: Number(process.env.CHAIN_CONFIRMATIONS ?? 5),
      staleAfterSec: Number(process.env.CHAIN_TX_STALE_SEC ?? 1800),
      minPriorityFeeGwei: process.env.MIN_PRIORITY_FEE_GWEI ?? "30",
      explorer: process.env.CHAIN_EXPLORER ?? "https://amoy.polygonscan.com",
      custodyXpub: process.env.CUSTODY_XPUB ?? (prod ? "" : HDNodeWallet.fromPhrase(TEST_MNEMONIC, undefined, "m/44'/60'/0'/1").neuter().extendedKey),
      orgIdSalt: req("ORG_ID_SALT", prod ? undefined : "dev-only-org-salt"),
    },
    ...overrides,
  };
  if (cfg.dataEncryptionKey.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes (base64)");
  if (cfg.env === "production") {
    const p = cfg.providers;
    if (p.sms === "mock" || p.identity === "mock" || p.storage === "memory" || p.cobank === "mock" || p.chain === "mock")
      throw new Error("Mock/memory providers are not allowed in production");
    if (cfg.exposeInvitationTokens) throw new Error("exposeInvitationTokens must be false in production");
  }
  if (cfg.providers.chain === "evm") {
    const c = cfg.chain;
    if (!c.rpcUrls.length || !c.registryAddress || !c.operatorPrivateKey || !c.custodyXpub)
      throw new Error("CHAIN_PROVIDER=evm needs CHAIN_RPC_URLS, IDENTITY_REGISTRY_ADDRESS, OPERATOR_PRIVATE_KEY and CUSTODY_XPUB");
  }
  if (!cfg.chain.custodyXpub.startsWith("xpub")) throw new Error("CUSTODY_XPUB must be an extended public key (xpub…), never a private key");
  return cfg;
}
