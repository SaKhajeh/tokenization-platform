"use client";
import { useState } from "react";
import { useAction, useApi, useQuery, useStepUp, ErrorBanner } from "@tp/client/react";
import { Button, Card, Empty, Status, Tabs, TextInput, jdatetime, toman } from "@tp/ui";
import { Shell } from "@/components/Shell";
import { useStaff } from "@/lib/me";

interface Inv { id: string; invoice_no: string; legal_name?: string; org_id: string; linked_type: string; charge_point: string; status: string; total: string; fund_share: string; platform_share: string; vat: string; issued_at: string; closed_reason: string | null; policy_version: number }
const POINT_FA: Record<string, string> = { case_submission: "کارمزد ارزیابی پرونده", application_screening: "کارمزد درخواست" };

/** Fee invoices (D25, D-C13): the fund manager can waive with a reason (step-up). */
export default function Invoices() {
  const api = useApi();
  const stepUp = useStepUp();
  const { has } = useStaff();
  const [status, setStatus] = useState("issued");
  const q = useQuery(`inv:${status}`, () => api.get<Inv[]>(`/admin/invoices?status=${status}`));
  const [reason, setReason] = useState<Record<string, string>>({});
  const waive = useAction(async (_k, i: Inv) => {
    await stepUp("POST", `/admin/invoices/${i.id}/waive`, { reason: reason[i.id].trim() }, { title: "بخشودن کارمزد", summary: <span>{i.invoice_no} — {toman(i.total)}</span> });
    q.reload();
  });
  return (
    <Shell title="صورتحساب‌ها">
      <div className="stack">
        <Tabs tabs={[["issued", "پرداخت‌نشده"], ["paid", "پرداخت‌شده"], ["waived", "بخشوده"], ["cancelled", "لغوشده"]]} value={status} onChange={setStatus} />
        <ErrorBanner error={q.error ?? waive.error} />
        <Card>
          {q.data?.length ? (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>شماره</th><th>بابت</th><th>مبلغ کل</th><th>سهم صندوق / پلتفرم</th><th>نسخه‌ی تعرفه</th><th>صدور</th><th>وضعیت</th>{status === "issued" && has("fund_manager") && <th>بخشودن</th>}</tr></thead>
              <tbody>{q.data.map((i) => (
                <tr key={i.id}>
                  <td className="ltr">{i.invoice_no}</td>
                  <td>{POINT_FA[i.charge_point] ?? i.charge_point}{i.legal_name ? ` — ${i.legal_name}` : ""}</td>
                  <td className="num">{toman(i.total)}</td>
                  <td className="num">{toman(i.fund_share)} / {toman(i.platform_share)}</td>
                  <td>{i.policy_version?.toLocaleString("fa-IR") ?? "—"}</td>
                  <td>{jdatetime(i.issued_at)}</td>
                  <td><Status kind="invoice" value={i.status} />{i.closed_reason && <div className="t-small t-muted">{i.closed_reason}</div>}</td>
                  {status === "issued" && has("fund_manager") && (
                    <td><div className="row">
                      <input className="input" style={{ minHeight: 36, width: 180 }} placeholder="دلیل" aria-label="دلیل بخشودن" value={reason[i.id] ?? ""} onChange={(e) => setReason({ ...reason, [i.id]: e.target.value })} />
                      <Button size="sm" disabled={(reason[i.id] ?? "").trim().length < 5} onClick={() => waive.run(i)}>بخشودن</Button>
                    </div></td>
                  )}
                </tr>
              ))}</tbody>
            </table></div>
          ) : q.data ? <Empty title="صورتحسابی در این وضعیت نیست" /> : null}
        </Card>
      </div>
    </Shell>
  );
}
