import { S3Client, HeadObjectCommand, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { JibitHttp, JibitProduct } from "./jibit.js";

// ------------------------------------------------------------------ SMS / email (OTP delivery only)
export interface MessageSender {
  /** Sends a one-time code. Our backend generates and verifies the code; providers only deliver it. */
  sendOtp(to: string, code: string, clientMessageId: string): Promise<void>;
  /** Free-form notification (invitation links etc.). */
  sendText(to: string, text: string, clientMessageId: string): Promise<void>;
}
export const SMS = Symbol("SMS");
export const EMAIL = Symbol("EMAIL");

export class JibitSms implements MessageSender {
  constructor(
    private readonly http: JibitHttp,
    private readonly product: JibitProduct,
    private readonly sender: string,
    private readonly otpTemplate: string,
  ) {}
  async sendOtp(to: string, code: string, clientMessageId: string) {
    await this.http.call(this.product, "POST", "/pulse/api/v1/message/sms/otp/send", {
      receptor: to,
      sender: this.sender,
      template: this.otpTemplate,
      params: { code },
      client_message_id: clientMessageId,
    });
  }
  async sendText(to: string, text: string, clientMessageId: string) {
    // Production uses pre-approved pattern templates (one per event); plain text is a placeholder for M-A.
    await this.http.call(this.product, "POST", "/pulse/api/v1/message/sms/pattern/send", {
      receptor: to,
      sender: this.sender,
      template: "generic_notice",
      params: { text },
      client_message_id: clientMessageId,
    });
  }
}

/** Dev/test sender: keeps messages in memory so tests can read the OTP. Never use in production. */
export class MemorySender implements MessageSender {
  readonly sent: { to: string; kind: "otp" | "text"; body: string; id: string }[] = [];
  async sendOtp(to: string, code: string, id: string) {
    this.sent.push({ to, kind: "otp", body: code, id });
    // Local development only: the mock provider is refused in production by loadConfig.
    if (process.env.APP_ENV === "development") console.log(`[mock-sms] OTP for ${to}: ${code}`);
  }
  async sendText(to: string, text: string, id: string) {
    this.sent.push({ to, kind: "text", body: text, id });
  }
  lastOtp(to: string): string | undefined {
    return [...this.sent].reverse().find((m) => m.to === to && m.kind === "otp")?.body;
  }
}

// ------------------------------------------------------------------ identity inquiries
export interface IdentityProvider {
  /** Shahkar: does this mobile number belong to this national code? */
  matchMobileNationalCode(mobile: string, nationalCode: string): Promise<boolean>;
}
export const IDENTITY = Symbol("IDENTITY");

export class JibitIdentity implements IdentityProvider {
  constructor(private readonly http: JibitHttp, private readonly product: JibitProduct) {}
  async matchMobileNationalCode(mobile: string, nationalCode: string) {
    const q = new URLSearchParams({ mobileNumber: mobile, nationalCode });
    const r = await this.http.call<{ matched: boolean }>(this.product, "GET", `/ide/v1/services/matching?${q}`);
    return r.matched === true;
  }
}

/** Mock: matches unless the national code is listed in `mismatches`. */
export class MockIdentity implements IdentityProvider {
  readonly mismatches = new Set<string>();
  calls = 0;
  async matchMobileNationalCode(_mobile: string, nationalCode: string) {
    this.calls++;
    return !this.mismatches.has(nationalCode);
  }
}

// ------------------------------------------------------------------ object storage
export interface ObjectStorage {
  presignPut(key: string, mime: string, size: number, ttlSec: number): Promise<string>;
  presignGet(key: string, filename: string, ttlSec: number): Promise<string>;
  head(key: string): Promise<{ size: number } | null>;
}
export const STORAGE = Symbol("STORAGE");

export class S3Storage implements ObjectStorage {
  private s3: S3Client;
  constructor(private readonly cfg: { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string }) {
    this.s3 = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: true, // MinIO
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }
  presignPut(key: string, mime: string, size: number, ttlSec: number) {
    return getSignedUrl(this.s3, new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, ContentType: mime, ContentLength: size }), {
      expiresIn: ttlSec,
    });
  }
  presignGet(key: string, filename: string, ttlSec: number) {
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      }),
      { expiresIn: ttlSec },
    );
  }
  async head(key: string) {
    try {
      const r = await this.s3.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return { size: Number(r.ContentLength ?? 0) };
    } catch (e: any) {
      if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NotFound") return null;
      throw e;
    }
  }
}

/** Dev/test storage: "uploads" are recorded with put(). */
/**
 * Dev/test storage. Objects live in memory. With a `devBaseUrl` (local development) the presigned URLs point at the
 * API's dev-only upload/download routes (DevStorageController), so the apps can upload and view files without MinIO.
 */
export class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, number>();
  readonly bytes = new Map<string, { data: Buffer; mime: string; filename?: string }>();
  constructor(private readonly devBaseUrl: string | null = null) {}
  put(key: string, size: number) {
    this.objects.set(key, size);
  }
  putBytes(key: string, data: Buffer, mime: string) {
    this.objects.set(key, data.length);
    this.bytes.set(key, { data, mime });
  }
  async presignPut(key: string) {
    return this.devBaseUrl ? `${this.devBaseUrl}/dev/storage/${Buffer.from(key).toString("base64url")}` : `memory://upload/${key}`;
  }
  async presignGet(key: string) {
    return this.devBaseUrl ? `${this.devBaseUrl}/dev/storage/${Buffer.from(key).toString("base64url")}` : `memory://download/${key}`;
  }
  async head(key: string) {
    const size = this.objects.get(key);
    return size === undefined ? null : { size };
  }
}
