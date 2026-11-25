"use client";
import { useState } from "react";
import { useAction, useApi, useQuery, useStepUp, ErrorBanner } from "@tp/client/react";
import { Button, Card, Chip, Empty, Status, Tabs, jdatetime, toman } from "@tp/ui";
import { Shell } from "@/components/Shell";
import { useStaff } from "@/lib/me";

interface W { id: string; legal_name: string; destination_iban: string; amount: string; status: string; needs_fund_approval: boolean; transfer_type: string | null; fail_reason: string | null; created_at: string; bank_reference: string | null }

/** S-21 (D24): finance queues → fund manager approves at or above the threshold → finance sends through Cobank. */
export default function Withdrawals() {
  const api = useApi();
  const stepUp = useStepUp();
  const { has } = useStaff();
  const [status, setStatus] = useState("org_approved");
  const q = useQuery(`wd:${status}`, () => api.get<W[]>(`/admin/withdrawals?status=${status}`));
  const act = useAction(async (_k, w: W, action: "queue" | "fund-approve" | "send" | "reject") => {
    const path = `/admin/withdrawals/${w.id}/${action}`;
    if (action === "queue") await api.post(path);
    else if (action === "reject") await api.post(path, { reason: "رد توسط واحد مالی" });
    else await stepUp("POST", path, {}, { title: action === "send" ? "ارسال به بانک" : "تأیید مدیر صندوق", summary: <span>{w.legal_name} — {toman(w.amount)}</span> });
    q.reload();
  });
  return (
    <Shell title="برداشت‌ها">
      <div className="stack">
        <Tabs tabs={[["org_approved", "تأیید سازمان"], ["finance_queued", "صف مالی"], ["internal_approved", "تأیید مدیر صندوق"], ["sent", "ارسال‌شده"], ["completed", "انجام‌شده"], ["failed", "ناموفق"]]} value={status} onChange={setStatus} />
        <ErrorBanner error={q.error ?? act.error} />
        <Card>
          {q.data?.length ? (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>سازمان</th><th>مبلغ</th><th>به حساب</th><th>زمان</th><th>وضعیت</th><th /></tr></thead>
              <tbody>{q.data.map((w) => (
                <tr key={w.id}>
                  <td>{w.legal_name}</td>
                  <td className="num">{toman(w.amount)} {w.needs_fund_approval && <Chip tone="warning">نیاز به تأیید مدیر</Chip>}</td>
                  <td className="ltr">{w.destination_iban}</td>
                  <td>{jdatetime(w.created_at)}</td>
                  <td><Status kind="withdrawal" value={w.status} />{w.fail_reason && <div className="t-small field-error">{w.fail_reason}</div>}</td>
                  <td><div className="row">
                    {w.status === "org_approved" && has("finance_officer") && <Button size="sm" onClick={() => act.run(w, "queue")}>بررسی و صف</Button>}
                    {w.status === "finance_queued" && w.needs_fund_approval && has("fund_manager") && <Button size="sm" onClick={() => act.run(w, "fund-approve")}>تأیید مدیر</Button>}
                    {(w.status === "internal_approved" || (w.status === "finance_queued" && !w.needs_fund_approval)) && has("finance_officer") && <Button size="sm" onClick={() => act.run(w, "send")}>ارسال</Button>}
                    {["org_approved", "finance_queued"].includes(w.status) && has("finance_officer", "compliance_officer") && <Button size="sm" variant="ghost" onClick={() => act.run(w, "reject")}>رد</Button>}
                  </div></td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : q.data ? <Empty title="موردی در این وضعیت نیست" /> : null}
        </Card>
      </div>
    </Shell>
  );
}
