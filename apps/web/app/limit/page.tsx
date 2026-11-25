"use client";
import Link from "next/link";
import { useApi, useQuery, ErrorBanner } from "@tp/client/react";
import { Banner, Button, COLLATERAL_FA, Card, Empty, KV, Progress, jdate, toman, tomanShort } from "@tp/ui";
import { Shell } from "@/components/Shell";
import { useMe } from "@/lib/me";
import type { Limit } from "@/lib/case";

/** A-74: limit, validity, usage and the fund's note — never the scoring coefficients (doc 07 Q6). */
export default function LimitPage() {
  const api = useApi();
  const { org } = useMe();
  const q = useQuery(org ? `limit:${org.id}` : null, () => api.get<Limit>("/case/limit"));
  const l = q.data?.limit;
  return (
    <Shell title="حد اعتباری">
      <div className="stack">
        <ErrorBanner error={q.error} />
        {q.data && !l && <Card><Empty title="هنوز حد اعتباری صادر نشده است" action={<Link href="/case"><Button variant="outline">مشاهده‌ی پرونده</Button></Link>}>پس از بررسی پرونده و تأیید مدیر صندوق، حد اعتباری اینجا نمایش داده می‌شود.</Empty></Card>}
        {l && (
          <>
            <Card dark>
              <div className="stack">
                <span className="t-small t-muted">حد اعتباری با ضمانت چک و سفته</span>
                <span className="t-display" title={toman(l.limit)}>{tomanShort(l.limit)}</span>
                <Progress value={Number(BigInt(l.used) / 10n)} max={Number(BigInt(l.limit) / 10n)} label="استفاده‌شده" />
                <div className="row-between t-small"><span>استفاده‌شده: {toman(l.used)}</span><span>قابل استفاده: {toman(l.available)}</span></div>
              </div>
            </Card>
            <div className="grid-2">
              <Card title="اعتبار">
                <KV rows={[["از", jdate(l.valid_from)], ["تا", jdate(l.valid_to)]]} />
              </Card>
              <Card title="سقف با وثیقه‌های دیگر">
                <KV rows={(["cheque", "mortgage_2", "mortgage_1"] as const).map((k) => [COLLATERAL_FA[k], <span key={k} title={toman(l.ceilings.guarantee[k])}>{tomanShort(l.ceilings.guarantee[k])}</span>])} />
                <p className="t-small t-muted" style={{ marginTop: 8 }}>با ارائه‌ی وثیقه‌ی ملکی، سقف تأمین مالی بالاتر می‌رود.</p>
              </Card>
            </div>
            {q.data!.note && <Banner tone="info">یادداشت صندوق: {q.data!.note}</Banner>}
            <Link href="/applications/new"><Button>درخواست تأمین مالی</Button></Link>
          </>
        )}
      </div>
    </Shell>
  );
}
