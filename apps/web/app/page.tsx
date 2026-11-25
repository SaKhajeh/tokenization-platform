"use client";
import Link from "next/link";
import { useApi, useQuery } from "@tp/client/react";
import { ApiError } from "@tp/client";
import { Banner, Button, Card, Status, fa, jdate, toman, tomanShort } from "@tp/ui";
import { Shell } from "@/components/Shell";
import { useMe } from "@/lib/me";
import type { Case, Limit } from "@/lib/case";

const PATH = ["حساب کاربری", "سازمان", "پرونده‌ی اعتباری", "بررسی صندوق و حد", "درخواست تأمین مالی", "انتشار اوراق"];

/** A-0H: one next action, the balance, and for applicants the 6-step financing path (doc 07 §2a). */
export default function Home() {
  const api = useApi();
  const { org } = useMe();
  const k = org?.id ?? null;
  const bal = useQuery(k && `bal:${k}`, () => api.get<{ available: string; reserved_total: string; withdrawal_hold: string; total: string }>("/balances"));
  const cs = useQuery(k && `case:${k}`, () => api.get<Case>("/case").catch((e: ApiError) => (e.code === "NO_CASE" ? null : Promise.reject(e))));
  const banks = useQuery(k && `banks:${k}`, () => api.get<{ status: string }[]>("/bank-accounts"));
  const limit = useQuery(k && cs.data?.state === "limit_issued" ? `limit:${k}` : null, () => api.get<Limit>("/case/limit"));

  if (!org) return <Shell><span /></Shell>;
  const kybOk = org.kyb_status === "approved";
  const c = cs.data;
  const hasBank = (banks.data ?? []).some((b) => b.status === "verified");

  // the single next action
  let next: { text: string; href: string; cta: string } | null = null;
  if (!kybOk && org.kyb_status !== "in_review") next = { text: "برای شروع، احراز هویت سازمان را تکمیل کنید.", href: "/kyb", cta: "احراز هویت سازمان" };
  else if (c && ["opened", "in_preparation", "under_review"].includes(c.state)) next = { text: "پرونده‌ی اعتباری خود را تکمیل و ارسال کنید.", href: "/case", cta: "تکمیل پرونده" };
  else if (c?.state === "returned") next = { text: "صندوق مواردی از پرونده را برای اصلاح برگردانده است.", href: "/case", cta: "اصلاح موارد" };
  else if (kybOk && !hasBank && banks.data) next = { text: "برای واریز و برداشت، حساب بانکی سازمان را ثبت کنید.", href: "/bank", cta: "افزودن حساب بانکی" };
  else if (c?.state === "limit_issued") next = { text: "حد اعتباری شما صادر شده است؛ می‌توانید درخواست تأمین مالی ثبت کنید.", href: "/applications/new", cta: "درخواست تأمین مالی" };

  const pathStep = !c ? 2 : ["opened", "in_preparation", "returned", "under_review"].includes(c.state) ? 2 : c.state === "limit_issued" ? 4 : 3;

  return (
    <Shell>
      <div className="stack">
        <Card dark>
          <div className="row-between" style={{ alignItems: "flex-start" }}>
            <div className="hero-figure">
              <span className="t-small t-muted">موجودی قابل استفاده</span>
              <span className="t-display" title={bal.data ? toman(bal.data.available) : undefined}>{bal.data ? toman(bal.data.available) : "—"}</span>
              {bal.data && BigInt(bal.data.withdrawal_hold) > 0n && <span className="t-small t-muted">در حال برداشت: {toman(bal.data.withdrawal_hold)}</span>}
            </div>
            {limit.data?.limit && (
              <div className="hero-figure" style={{ textAlign: "left" }}>
                <span className="t-small t-muted">حد اعتباری قابل استفاده</span>
                <span className="t-h1" title={toman(limit.data.limit.available)}>{tomanShort(limit.data.limit.available)}</span>
                <span className="t-small t-muted">تا {jdate(limit.data.limit.valid_to)}</span>
              </div>
            )}
          </div>
          {c && (
            <div className="stack-sm" style={{ marginTop: 16 }}>
              <div className="path" aria-hidden="true">{PATH.map((p, i) => <span key={p} className={i < pathStep ? "done" : i === pathStep ? "current" : ""} />)}</div>
              <span className="t-small t-muted">مسیر تأمین مالی — گام {fa(pathStep + 1)} از {fa(PATH.length)}: {PATH[pathStep]}</span>
            </div>
          )}
        </Card>

        {next && (
          <Card highlight>
            <div className="next-action">
              <span>{next.text}</span>
              <Link href={next.href}><Button>{next.cta}</Button></Link>
            </div>
          </Card>
        )}
        {org.kyb_status === "in_review" && <Banner tone="info">احراز هویت سازمان در حال بررسی است.</Banner>}

        <div className="grid-2">
          <Card title="سازمان" action={<Status kind="kyb" value={org.kyb_status} />}>
            <p>{org.legal_name}</p>
            <p className="t-small t-muted">شناسه‌ی ملی <span className="ltr">{org.national_id}</span></p>
          </Card>
          {c && (
            <Card title="پرونده‌ی اعتباری" action={<Status kind="case" value={c.state} />}>
              <p className="t-small t-muted">شماره‌ی پرونده <span className="ltr">{c.case_no}</span></p>
              <Link href="/case">مشاهده‌ی پرونده</Link>
            </Card>
          )}
        </div>
      </div>
    </Shell>
  );
}
