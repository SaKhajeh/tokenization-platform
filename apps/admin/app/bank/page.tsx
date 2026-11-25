"use client";
import { useState } from "react";
import { useAction, useApi, useQuery, ErrorBanner } from "@tp/client/react";
import { Button, Card, Empty, TextInput, jdatetime } from "@tp/ui";
import { Shell } from "@/components/Shell";
import { useStaff } from "@/lib/me";

interface Pending { id: string; iban: string; bank_name: string | null; owner_names: string[] | null; legal_name: string; national_id: string; created_at: string }

/** S-03: IBANs whose owner did not match the company automatically — never auto-verified (FR-BANK-2). */
export default function BankExceptions() {
  const api = useApi();
  const { has } = useStaff();
  const q = useQuery("bank-pending", () => api.get<Pending[]>("/admin/bank-accounts/pending"));
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const review = useAction(async (_k, id: string, approved: boolean) => { await api.post(`/admin/bank-accounts/${id}/review`, { approved, reason: reasons[id].trim() }); q.reload(); });
  return (
    <Shell title="حساب‌های بانکی در انتظار بررسی">
      <Card>
        <ErrorBanner error={q.error ?? review.error} />
        {q.data?.length ? (
          <ul className="list">{q.data.map((a) => (
            <li key={a.id} style={{ alignItems: "flex-start" }}>
              <div className="stack-sm">
                <strong>{a.legal_name} <span className="t-small t-muted ltr">{a.national_id}</span></strong>
                <span className="ltr">{a.iban}</span>
                <span className="t-small t-muted">صاحب حساب طبق بانک: {(a.owner_names ?? []).join("، ") || "—"} — {a.bank_name ?? ""} — {jdatetime(a.created_at)}</span>
              </div>
              {has("compliance_officer") && (
                <div className="stack-sm" style={{ minWidth: 260 }}>
                  <TextInput label="دلیل تصمیم" value={reasons[a.id] ?? ""} onValue={(v) => setReasons({ ...reasons, [a.id]: v })} />
                  <div className="row">
                    <Button size="sm" busy={review.busy} disabled={(reasons[a.id] ?? "").trim().length < 3} onClick={() => review.run(a.id, true)}>تأیید</Button>
                    <Button size="sm" variant="danger" busy={review.busy} disabled={(reasons[a.id] ?? "").trim().length < 3} onClick={() => review.run(a.id, false)}>رد</Button>
                  </div>
                </div>
              )}
            </li>
          ))}</ul>
        ) : q.data ? <Empty title="موردی در انتظار نیست" /> : null}
      </Card>
    </Shell>
  );
}
