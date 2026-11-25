"use client";
import Link from "next/link";
import { ApiError } from "@tp/client";
import { useApi, useQuery, ErrorBanner } from "@tp/client/react";
import { Button, Card, Empty, Status, jdate, toman } from "@tp/ui";
import { Shell } from "@/components/Shell";
import { useMe } from "@/lib/me";
import type { Case } from "@/lib/case";

interface App { id: string; application_no: string; status: string; requested_amount: string; created_at: string; submitted_at: string | null }

/** Financing hub (A-40): the credit case and the applications that use its limit. */
export default function FinancingPage() {
  const api = useApi();
  const { org } = useMe();
  const k = org?.id ?? null;
  const cs = useQuery(k && `case:${k}`, () => api.get<Case>("/case").catch((e: ApiError) => (e.code === "NO_CASE" ? null : Promise.reject(e))));
  const apps = useQuery(k && `apps:${k}`, () => api.get<App[]>("/applications"));
  return (
    <Shell title="تأمین مالی">
      <div className="stack">
        <ErrorBanner error={cs.error ?? apps.error} />
        <Card title="پرونده‌ی اعتباری" action={cs.data ? <Status kind="case" value={cs.data.state} /> : null}>
          {cs.data === null ? (
            <Empty title="پرونده‌ای ندارید" action={<Link href="/onboarding"><Button>شروع درخواست تأمین مالی</Button></Link>}>برای دریافت تأمین مالی ابتدا صندوق برای شرکت شما حد اعتباری تعیین می‌کند.</Empty>
          ) : cs.data ? (
            <div className="row">
              <Link href="/case"><Button variant="secondary">مشاهده‌ی پرونده</Button></Link>
              {cs.data.state === "limit_issued" && <Link href="/limit"><Button variant="outline">حد اعتباری</Button></Link>}
            </div>
          ) : null}
        </Card>
        <Card title="درخواست‌های تأمین مالی" action={cs.data?.state === "limit_issued" ? <Link href="/applications/new"><Button size="sm">درخواست جدید</Button></Link> : null}>
          {apps.data?.length ? (
            <ul className="list">{apps.data.map((a) => (
              <li key={a.id}>
                <Link href={`/applications/${a.id}`}><div><div>{a.application_no ?? "پیش‌نویس"} — {toman(a.requested_amount)}</div><div className="t-small t-muted">{jdate(a.submitted_at ?? a.created_at)}</div></div></Link>
                <Status kind="application" value={a.status} />
              </li>
            ))}</ul>
          ) : <Empty title="درخواستی ثبت نشده است">{cs.data?.state === "limit_issued" ? "در محدوده‌ی حد اعتباری خود درخواست ثبت کنید." : "درخواست تأمین مالی پس از صدور حد اعتباری ممکن است."}</Empty>}
        </Card>
      </div>
    </Shell>
  );
}
