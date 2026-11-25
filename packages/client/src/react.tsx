"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Banner, Button, OtpInput, Sheet } from "@tp/ui";
import { Api, ApiError, newKey, type Method } from "./index";

const ApiCtx = createContext<Api | null>(null);
export const ApiProvider = ({ api, children }: { api: Api; children: ReactNode }) => <ApiCtx.Provider value={api}><StepUpHost api={api}>{children}</StepUpHost></ApiCtx.Provider>;
export function useApi(): Api {
  const a = useContext(ApiCtx);
  if (!a) throw new Error("ApiProvider missing");
  return a;
}

/** Re-renders when the session or the active org changes. */
export function useSessionState(api: Api) {
  return useSyncExternalStore(
    (cb) => api.onChange(cb),
    () => `${api.signedIn}|${api.orgId}`,
    () => "false|null",
  );
}

/** Minimal data hook: load on mount and when `key` changes; `reload()` after a mutation. */
export function useQuery<T>(key: string | null, fn: () => Promise<T>) {
  const [state, setState] = useState<{ data?: T; error?: ApiError; loading: boolean }>({ loading: !!key });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!key) return;
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    fnRef.current().then(
      (data) => live && setState({ data, loading: false }),
      (error) => live && setState({ error: error instanceof ApiError ? error : new ApiError(0, "ERROR", String(error?.message ?? error)), loading: false }),
    );
    return () => { live = false; };
  }, [key, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  return { ...state, reload };
}

/** Runs an action with busy/error state; keeps one idempotency key per attempt until it succeeds. */
export function useAction<A extends unknown[], R>(fn: (idem: string, ...args: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const keyRef = useRef(newKey());
  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn(keyRef.current, ...args);
      keyRef.current = newKey();
      return r;
    } catch (e: any) {
      setError(e instanceof ApiError ? e : new ApiError(0, "ERROR", String(e?.message ?? e)));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [fn]);
  return { run, busy, error, clearError: () => setError(null) };
}

export const ErrorBanner = ({ error }: { error: ApiError | null | undefined }) =>
  error ? <Banner tone="danger" code={error.requestId}>{error.messageFa}</Banner> : null;

// ------------------------------------------------------------------ step-up (OTP confirmation of one exact request)

type StepUpRun = <T = any>(method: Method, path: string, body?: unknown, opts?: { idem?: string; title?: string; summary?: ReactNode }) => Promise<T>;
const StepUpCtx = createContext<StepUpRun | null>(null);
export function useStepUp(): StepUpRun {
  const s = useContext(StepUpCtx);
  if (!s) throw new Error("ApiProvider missing");
  return s;
}

interface Pending { method: Method; path: string; body: unknown; idem?: string; title: string; summary?: ReactNode; challengeId?: string; resolve: (v: any) => void; reject: (e: any) => void }

function StepUpHost({ api, children }: { api: Api; children: ReactNode }) {
  const [p, setP] = useState<Pending | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);

  const start = useCallback(async (q: Pending) => {
    setErr(null);
    try {
      const c = await api.stepUpStart(q.method, q.path, q.body);
      setP({ ...q, challengeId: c.challenge_id });
      setRound((r) => r + 1);
    } catch (e: any) {
      setP(null);
      q.reject(e);
    }
  }, [api]);

  const run: StepUpRun = useCallback((method, path, body, opts) => new Promise((resolve, reject) => {
    const q: Pending = { method, path, body: body ?? {}, idem: opts?.idem, title: opts?.title ?? "تأیید با رمز یکبارمصرف", summary: opts?.summary, resolve, reject };
    setP(q);
    void start(q);
  }), [start]);

  const submit = async (code: string) => {
    if (!p?.challengeId) return;
    setBusy(true);
    setErr(null);
    try {
      const v = await api.stepUpVerify(p.challengeId, code);
      const r = await api.req(p.method, p.path, { body: p.method === "DELETE" ? undefined : p.body, idem: p.idem, stepUpToken: v.step_up_token });
      p.resolve(r);
      setP(null);
    } catch (e: any) {
      const ae = e instanceof ApiError ? e : new ApiError(0, "ERROR", String(e));
      if (ae.code === "OTP_INVALID" || ae.code === "OTP_EXPIRED" || ae.code === "OTP_TOO_MANY_ATTEMPTS") { setErr(ae); setRound((r) => r + 1); }
      else { p.reject(ae); setP(null); }
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepUpCtx.Provider value={run}>
      {children}
      <Sheet open={!!p} onClose={() => { p?.reject(new ApiError(0, "CANCELLED", "تأیید لغو شد.")); setP(null); }} title={p?.title ?? ""}>
        {p?.summary ? <div className="card card-highlight">{p.summary}</div> : null}
        <p className="t-muted">کد ۶ رقمی‌ای را که به شماره‌ی همراه شما پیامک شد وارد کنید. این کد فقط همین کار را تأیید می‌کند.</p>
        {p?.challengeId ? <OtpInput key={round} onComplete={submit} disabled={busy} /> : <p className="t-muted">در حال ارسال کد…</p>}
        {err ? <Banner tone="danger">{err.messageFa}</Banner> : null}
        <Button variant="outline" onClick={() => p && start(p)} disabled={busy}>ارسال دوباره‌ی کد</Button>
      </Sheet>
    </StepUpCtx.Provider>
  );
}
