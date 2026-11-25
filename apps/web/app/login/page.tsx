"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useApi, ErrorBanner } from "@tp/client/react";
import { ApiError } from "@tp/client";
import { Button, OtpInput, TextInput, fa, latin } from "@tp/ui";

function Login() {
  const api = useApi();
  const router = useRouter();
  const next = useSearchParams().get("next") || "/";
  const [dest, setDest] = useState("");
  const [challenge, setChallenge] = useState<{ id: string; resendIn: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [round, setRound] = useState(0);

  const send = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.requestOtp(latin(dest.trim()));
      setChallenge({ id: r.challenge_id, resendIn: r.resend_in });
      setRound((x) => x + 1);
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  };
  const verify = async (code: string) => {
    if (!challenge) return;
    setBusy(true); setErr(null);
    try {
      await api.verifyOtp(challenge.id, code);
      router.replace(next.startsWith("/") ? next : "/");
    } catch (e) { setErr(e as ApiError); setRound((x) => x + 1); } finally { setBusy(false); }
  };

  return (
    <div className="auth">
      <div className="card stack">
        <div className="stack-sm">
          <h1 className="t-h1">ورود یا ثبت‌نام</h1>
          <p className="t-muted">با شماره‌ی همراه یا ایمیل وارد شوید. اگر حساب ندارید، همین‌جا ساخته می‌شود.</p>
        </div>
        {!challenge ? (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <TextInput label="شماره‌ی همراه یا ایمیل" ltr autoFocus value={dest} onValue={setDest} placeholder="09121234567" autoComplete="username" />
            <ErrorBanner error={err} />
            <Button type="submit" block busy={busy} disabled={dest.trim().length < 5}>دریافت کد</Button>
          </form>
        ) : (
          <div className="stack">
            <p>کد ۶ رقمی ارسال‌شده به <span className="ltr">{dest}</span> را وارد کنید.</p>
            <OtpInput key={round} onComplete={verify} disabled={busy} />
            <ErrorBanner error={err} />
            <div className="row-between">
              <Button variant="ghost" onClick={() => { setChallenge(null); setErr(null); }}>تغییر شماره</Button>
              <Button variant="ghost" onClick={send} disabled={busy}>ارسال دوباره‌ی کد</Button>
            </div>
            <p className="t-small t-muted">کد تا {fa(2)} دقیقه معتبر است.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return <Suspense><Login /></Suspense>;
}
