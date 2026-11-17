/**
 * Jibit HTTP client with per-product token caching (see plan/04-integrations-jibit.md).
 * Every product has its own token endpoint and field names; tokens are refreshed shortly before expiry.
 * All calls must leave from the static, allow-listed egress IP (infra concern, not code).
 */
export interface JibitProduct {
  name: "ide" | "pulse" | "cobank";
  tokenPath: string;
  tokenBody: () => Record<string, unknown>;
  readToken: (json: any) => string;
}

export class JibitHttp {
  private tokens = new Map<string, { token: string; exp: number }>();

  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  private async token(p: JibitProduct): Promise<string> {
    const cached = this.tokens.get(p.name);
    if (cached && cached.exp > Date.now() + 60_000) return cached.token;
    const res = await this.raw("POST", p.tokenPath, p.tokenBody());
    const token = p.readToken(res);
    if (!token) throw new Error(`Jibit ${p.name}: no token in response`);
    this.tokens.set(p.name, { token, exp: jwtExpMs(token) ?? Date.now() + 10 * 60_000 });
    return token;
  }

  async call<T>(p: JibitProduct, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const token = await this.token(p);
    try {
      return await this.raw(method, path, body, token);
    } catch (e: any) {
      if (e?.status === 401) {
        this.tokens.delete(p.name); // token revoked early: retry once with a fresh one
        return this.raw(method, path, body, await this.token(p));
      }
      throw e;
    }
  }

  private async raw(method: string, path: string, body?: unknown, token?: string): Promise<any> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.baseUrl + path, {
        method,
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      const json = text ? JSON.parse(text) : {};
      if (!res.ok) throw Object.assign(new Error(`Jibit ${method} ${path} → ${res.status}`), { status: res.status, body: json });
      return json;
    } finally {
      clearTimeout(t);
    }
  }
}

function jwtExpMs(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Cobank token scopes we need (plan/04 §5). */
export const COBANK_SCOPES = ["ACCOUNTS", "AUG_STATEMENT", "AUG_STATEMENT_VARIZ", "VARIZ_PID", "SETTLEMENT", "AUGMENTED_TRANSFER", "BALANCE", "REPORT"];

export const jibitProducts = (cfg: {
  ideApiKey: string; ideSecret: string; smsApiKey: string; smsSecret: string; cobankApiKey?: string; cobankSecret?: string;
}) => ({
  ide: {
    name: "ide",
    tokenPath: "/ide/v1/tokens/generate",
    tokenBody: () => ({ apiKey: cfg.ideApiKey, secretKey: cfg.ideSecret }),
    readToken: (j: any) => j.accessToken,
  } satisfies JibitProduct,
  pulse: {
    name: "pulse",
    tokenPath: "/pulse/api/v1/auth/authenticate",
    tokenBody: () => ({ api_key: cfg.smsApiKey, secret_key: cfg.smsSecret }),
    readToken: (j: any) => j.access_token,
  } satisfies JibitProduct,
  cobank: {
    name: "cobank",
    tokenPath: "/cobank/v1/tokens/generate",
    tokenBody: () => ({ apiKey: cfg.cobankApiKey ?? "", secretKey: cfg.cobankSecret ?? "", scopes: COBANK_SCOPES }) as any,
    readToken: (j: any) => j.accessToken,
  } satisfies JibitProduct,
});
