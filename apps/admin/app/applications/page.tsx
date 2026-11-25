"use client";
import Link from "next/link";
import { useState } from "react";
import { useApi, useQuery, ErrorBanner } from "@tp/client/react";
import { Card, Empty, Status, Tabs, jdatetime, toman } from "@tp/ui";
import { Shell } from "@/components/Shell";

interface Row { id: string; application_no: string; status: string; requested_amount: string; investment_type: string; submitted_at: string | null; legal_name: string; title: string }
const F: [string, string, string[]][] = [
  ["screening", "غربالگری", ["submitted", "resubmitted", "screening"]], ["limit", "بررسی حد", ["credit_assessment"]],
  ["waiting", "نزد متقاضی", ["returned", "awaiting_payment"]], ["dd", "بررسی دقیق و بعد", ["due_diligence", "committee", "approved", "approved_with_conditions", "terms_negotiation", "terms_signed", "handed_to_tokenisation"]],
  ["closed", "بسته", ["rejected", "withdrawn", "expired"]],
];

/** S-10: applications pipeline by stage. */
export default function Applications() {
  const api = useApi();
  const [f, setF] = useState("screening");
  const q = useQuery("apps", () => api.get<Row[]>("/admin/applications"));
  const rows = (q.data ?? []).filter((r) => F.find((x) => x[0] === f)![2].includes(r.status));
  return (
    <Shell title="درخواست‌های تأمین مالی">
      <div className="stack">
        <Tabs tabs={F.map(([k, l]) => [k, l] as [string, string])} value={f} onChange={setF} />
        <ErrorBanner error={q.error} />
        <Card>
          {rows.length ? (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>شماره</th><th>شرکت</th><th>طرح</th><th>مبلغ</th><th>ارسال</th><th>وضعیت</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}><td><Link href={`/applications/${r.id}`} className="ltr">{r.application_no}</Link></td><td>{r.legal_name}</td><td>{r.title}</td>
                  <td className="num">{toman(r.requested_amount)}</td><td>{jdatetime(r.submitted_at)}</td><td><Status kind="application" value={r.status} /></td></tr>
              ))}</tbody>
            </table></div>
          ) : q.data ? <Empty title="درخواستی در این مرحله نیست" /> : null}
        </Card>
      </div>
    </Shell>
  );
}
