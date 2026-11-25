"use client";
import { useState } from "react";
import { useAction, useApi, useQuery, useStepUp, ErrorBanner } from "@tp/client/react";
import { Button, Card, Select, TextInput, jdatetime } from "@tp/ui";

interface Ex { id: string; charge_point: string; reason: string; granted_at: string; revoked_at: string | null; granted_by_name: string | null }
const POINT_FA: Record<string, string> = { case_submission: "کارمزد ارزیابی پرونده", after_screening: "کارمزد درخواست تأمین مالی" };

/** The fund manager exempts this company from a fee in advance (e.g. a free assessment); unpaid invoices are waived. */
export function Exemptions({ orgId, canEdit }: { orgId: string; canEdit: boolean }) {
  const api = useApi();
  const stepUp = useStepUp();
  const q = useQuery(`ex:${orgId}`, () => api.get<Ex[]>(`/admin/orgs/${orgId}/fee-exemptions`));
  const [point, setPoint] = useState("case_submission");
  const [reason, setReason] = useState("");
  const grant = useAction(async () => {
    await stepUp("POST", `/admin/orgs/${orgId}/fee-exemptions`, { charge_point: point, reason: reason.trim() }, { title: "معافیت از کارمزد", summary: <span>{POINT_FA[point]}</span> });
    setReason(""); q.reload();
  });
  const revoke = useAction(async (_k, id: string) => { await api.del(`/admin/orgs/${orgId}/fee-exemptions/${id}`); q.reload(); });
  const active = (q.data ?? []).filter((x) => !x.revoked_at);
  return (
    <Card title="معافیت از کارمزد">
      <div className="stack">
        <ErrorBanner error={q.error ?? revoke.error} />
        {active.length ? (
          <ul className="list">{active.map((x) => (
            <li key={x.id}>
              <span>{POINT_FA[x.charge_point]} — {x.reason} <span className="t-small t-muted">({x.granted_by_name ?? ""}، {jdatetime(x.granted_at)})</span></span>
              {canEdit && <Button size="sm" variant="ghost" onClick={() => revoke.run(x.id)}>لغو معافیت</Button>}
            </li>
          ))}</ul>
        ) : <p className="t-muted t-small">این شرکت معافیتی ندارد؛ کارمزدها طبق تعرفه است.</p>}
        {canEdit && (
          <div className="stack">
            <div className="fieldset-grid">
              <Select label="کارمزد" value={point} onValue={setPoint} options={Object.entries(POINT_FA)} />
              <TextInput label="دلیل" value={reason} onValue={setReason} />
            </div>
            <ErrorBanner error={grant.error} />
            <Button size="sm" busy={grant.busy} disabled={reason.trim().length < 5} onClick={() => grant.run()}>رایگان کردن برای این شرکت</Button>
          </div>
        )}
      </div>
    </Card>
  );
}
