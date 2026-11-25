"use client";
import Link from "next/link";
import { useState } from "react";
import { useApi, useQuery, ErrorBanner } from "@tp/client/react";
import { Card, Chip, Empty, Status, Tabs, jdatetime } from "@tp/ui";
import { Shell } from "@/components/Shell";

interface Row { id: string; org_id: string; legal_name: string; national_id: string; version: number; status: string; risk_flags: string[]; authority_basis: string; submitted_at: string }

/** S-02: KYB queue. */
export default function KybQueue() {
  const api = useApi();
  const [status, setStatus] = useState("in_review");
  const q = useQuery(`kyb:${status}`, () => api.get<Row[]>(`/admin/kyb?status=${status}`));
  return (
    <Shell title="احراز هویت سازمان‌ها">
      <div className="stack">
        <Tabs tabs={[["in_review", "در انتظار بررسی"], ["info_requested", "نیاز به اطلاعات"], ["approved", "تأییدشده"], ["rejected", "ردشده"]]} value={status} onChange={setStatus} />
        <ErrorBanner error={q.error} />
        <Card>
          {q.data?.length ? (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>سازمان</th><th>شناسه‌ی ملی</th><th>نسخه</th><th>اختیار نماینده</th><th>هشدارها</th><th>ارسال</th><th>وضعیت</th></tr></thead>
              <tbody>{q.data.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/kyb/${r.id}`}>{r.legal_name}</Link></td>
                  <td className="ltr">{r.national_id}</td>
                  <td>{r.version.toLocaleString("fa-IR")}</td>
                  <td>{r.authority_basis === "registry" ? "در سامانه‌ی ثبت" : <Chip tone="warning">معرفی‌نامه</Chip>}</td>
                  <td>{r.risk_flags.length ? <Chip tone="danger">{r.risk_flags.length.toLocaleString("fa-IR")} هشدار</Chip> : "—"}</td>
                  <td>{jdatetime(r.submitted_at)}</td>
                  <td><Status kind="kyb" value={r.status} /></td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : q.data ? <Empty title="موردی در این صف نیست" /> : null}
        </Card>
      </div>
    </Shell>
  );
}
