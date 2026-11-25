/**
 * API client for the apps. The apps call the API through their own origin (`/api/v1/…`, proxied by Next), so no CORS.
 *
 * - Tokens: a 15-min access token and a rotating refresh token (apps/api README). Both are kept in localStorage per app
 *   (`storageKey`). A 401 triggers one refresh (shared between concurrent calls) and a retry; a failed refresh signs out.
 * - Org scope: the active organisation is sent as X-Org-Id on every call once chosen.
 * - Idempotency: callers pass a key per user action (`newKey()`); a retry of the same action reuses it.
 * - Errors: the API's `{ error: { code, message_fa, details, request_id } }` becomes an ApiError.
 */
export class ApiError extends Error {
  constructor(public status: number, public code: string, public messageFa: string, public details?: any, public requestId?: string) {
    super(messageFa || code);
  }
}

export interface Tokens { access: string; refresh: string }
export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export interface ReqOpts { body?: unknown; idem?: string; stepUpToken?: string; noAuth?: boolean; noOrg?: boolean }

export const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export class Api {
  private tokens: Tokens | null = null;
  private refreshing: Promise<boolean> | null = null;
  private listeners = new Set<() => void>();
  orgId: string | null = null;
  readonly base = "/api/v1";

  constructor(private readonly storageKey: string) {
    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) this.tokens = JSON.parse(raw);
        this.orgId = localStorage.getItem(`${storageKey}:org`);
      } catch { /* storage unavailable: session stays in memory */ }
    }
  }

  get signedIn() { return !!this.tokens; }
  onChange(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { this.listeners.forEach((f) => f()); }

  setTokens(t: Tokens | null) {
    this.tokens = t;
    try { t ? localStorage.setItem(this.storageKey, JSON.stringify(t)) : localStorage.removeItem(this.storageKey); } catch { /* ignore */ }
    this.emit();
  }
  setOrg(id: string | null) {
    this.orgId = id;
    try { id ? localStorage.setItem(`${this.storageKey}:org`, id) : localStorage.removeItem(`${this.storageKey}:org`); } catch { /* ignore */ }
    this.emit();
  }

  /** A stable device id for this browser (device binding, FR-AUTH-3). */
  deviceFingerprint(): string {
    const k = `${this.storageKey}:device`;
    try {
      let d = localStorage.getItem(k);
      if (!d) { d = `web-${newKey()}`; localStorage.setItem(k, d); }
      return d;
    } catch { return `web-${newKey()}`; }
  }

  async req<T = any>(method: Method, path: string, o: ReqOpts = {}, retried = false): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (o.body !== undefined) headers["content-type"] = "application/json";
    if (!o.noAuth && this.tokens) headers.authorization = `Bearer ${this.tokens.access}`;
    if (!o.noOrg && this.orgId) headers["x-org-id"] = this.orgId;
    if (o.idem) headers["idempotency-key"] = o.idem;
    if (o.stepUpToken) headers["x-step-up-token"] = o.stepUpToken;
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, { method, headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
    } catch {
      throw new ApiError(0, "NETWORK", "ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.");
    }
    if (res.status === 401 && !o.noAuth && this.tokens && !retried) {
      if (await this.refresh()) return this.req<T>(method, path, o, true);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const e = data?.error ?? {};
      if (res.status === 401 && !o.noAuth) this.setTokens(null);
      throw new ApiError(res.status, e.code ?? `HTTP_${res.status}`, e.message_fa ?? "خطای پیش‌بینی‌نشده رخ داد.", e.details, e.request_id);
    }
    return data as T;
  }

  get = <T = any>(path: string) => this.req<T>("GET", path);
  post = <T = any>(path: string, body?: unknown, o: ReqOpts = {}) => this.req<T>("POST", path, { ...o, body: body ?? {} });
  put = <T = any>(path: string, body?: unknown, o: ReqOpts = {}) => this.req<T>("PUT", path, { ...o, body: body ?? {} });
  patch = <T = any>(path: string, body?: unknown, o: ReqOpts = {}) => this.req<T>("PATCH", path, { ...o, body: body ?? {} });
  del = <T = any>(path: string, o: ReqOpts = {}) => this.req<T>("DELETE", path, o);

  private refresh(): Promise<boolean> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          const r = await this.req<{ access_token: string; refresh_token: string }>("POST", "/auth/refresh", { body: { refresh_token: this.tokens!.refresh }, noAuth: true, noOrg: true });
          this.setTokens({ access: r.access_token, refresh: r.refresh_token });
          return true;
        } catch {
          this.setTokens(null);
          return false;
        } finally {
          setTimeout(() => (this.refreshing = null), 0);
        }
      })();
    }
    return this.refreshing;
  }

  // ---------------------------------------------------------------- auth
  requestOtp(destination: string) {
    return this.req<{ challenge_id: string; expires_in: number; resend_in: number }>("POST", "/auth/otp/request", { body: { destination }, noAuth: true, noOrg: true });
  }
  async verifyOtp(challengeId: string, code: string) {
    const r = await this.req<{ access_token: string; refresh_token: string; is_new_user: boolean }>("POST", "/auth/otp/verify", {
      body: { challenge_id: challengeId, code, device_fingerprint: this.deviceFingerprint(), device_label: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 90) : undefined },
      noAuth: true, noOrg: true,
    });
    this.setTokens({ access: r.access_token, refresh: r.refresh_token });
    return r;
  }
  async logout() {
    try { await this.req("POST", "/auth/logout", { noOrg: true }); } catch { /* signed out anyway */ }
    this.setTokens(null);
    this.setOrg(null);
  }

  /** Step-up (FR-AUTH-4): the token is bound to exactly this method + path + body. */
  stepUpStart(method: Method, path: string, body: unknown) {
    return this.req<{ challenge_id: string; expires_in: number }>("POST", "/auth/step-up", { body: { method, path: `${this.base}${path}`, body: body ?? {} }, noOrg: true });
  }
  stepUpVerify(challengeId: string, code: string) {
    return this.req<{ step_up_token: string }>("POST", "/auth/step-up/verify", { body: { challenge_id: challengeId, code }, noOrg: true });
  }

  // ---------------------------------------------------------------- files
  /** Upload: presigned PUT, then `complete` with the SHA-256 the browser computed. Returns the document id. */
  async upload(file: File, category = "case_document"): Promise<string> {
    const ALLOWED = ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
    if (!ALLOWED.includes(file.type)) throw new ApiError(422, "MIME_NOT_ALLOWED", "این نوع فایل پذیرفته نمی‌شود. PDF، تصویر (JPG، PNG، HEIC)، Word یا Excel بارگذاری کنید.");
    if (file.size > 20 * 1024 * 1024) throw new ApiError(422, "FILE_TOO_LARGE", "حجم فایل باید کمتر از ۲۰ مگابایت باشد.");
    const up = await this.post<{ document_id: string; upload_url: string; headers: Record<string, string> }>(
      "/documents/upload-url", { category, filename: file.name.slice(0, 200), mime: file.type, size: file.size }, { idem: newKey() });
    const put = await fetch(up.upload_url, { method: "PUT", headers: up.headers, body: file });
    if (!put.ok) throw new ApiError(put.status, "UPLOAD_FAILED", "بارگذاری فایل انجام نشد. دوباره تلاش کنید.");
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    await this.post(`/documents/${up.document_id}/complete`, { sha256 });
    return up.document_id;
  }
}
