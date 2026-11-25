"use client";
import Link from "next/link";
import { useState } from "react";
import { useApi, useQuery, ErrorBanner } from "@tp/client/react";
import { Card, Chip, Empty, Progress, Status, Tabs, fa, jdatetime } from "@tp/ui";
import { Shell } from "@/components/Shell";
import type { CaseRow } from "@/lib/case";

const FILTERS: [string, string, string[]][] = [
  ["review", "در انتظار بررسی", ["submitted", "resubmitted", "document_review"]],
  ["visit", "بازدید و ارقام", ["documents_complete"]],
  ["scoring", "محاسبه و تأیید", ["scoring", "sent_back_to_analyst", "pending_approval"]],
  ["applicant", "نزد متقاضی", ["opened", "in_preparation", "returned", "under_review"]],
  ["done", "پایان‌یافته", ["limit_issued", "declined", "expired", "withdrawn", "closed_inactive"]],
];

/** S-16: credit cases by stage. */
export default function Cases() {
  const api = useApi();
  const [f, setF] = useState("review");
  const q = useQuery("cases", () => api.get<CaseRow[]>("/admin/cases"));
  const states = FILTERS.find((x) => x[0] === f)![2];
  const rows = (q.data ?? []).filter((r) => states.includes(r.state));
  return (
    <Shell title="پرونده‌های اعتباری">
      <div className="stack">
        <Tabs tabs={FILTERS.map(([k, l, s]) => [k, `${l} (${fa((q.data ?? []).filter((r) => s.includes(r.state)).length)})`] as [string, string])} value={f} onChange={setF} />
        <ErrorBanner error={q.error} />
        <Card>
          {rows.length ? (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>پرونده</th><th>شرکت</th><th>مدارک پذیرفته</th><th>ارسال</th><th>آخرین فعالیت</th><th>وضعیت</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/cases/${r.id}`} className="ltr">{r.case_no}</Link></td>
                  <td>{r.org_name} <span className="t-small t-muted ltr">{r.national_id}</span>{r.kyb_update_needed && <> <Chip tone="warning">به‌روزرسانی احراز هویت</Chip></>}</td>
                  <td style={{ minWidth: 140 }}><div className="stack-sm"><Progress value={r.accepted} max={r.items} label="مدارک پذیرفته" /><span className="t-small t-muted">{fa(r.accepted)} از {fa(r.items)}</span></div></td>
                  <td>{jdatetime(r.submitted_at)}</td>
                  <td>{jdatetime(r.last_activity_at)}</td>
                  <td><Status kind="case" value={r.state} /></td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : q.data ? <Empty title="پرونده‌ای در این مرحله نیست" /> : null}
        </Card>
      </div>
    </Shell>
  );
}
