"use client";
import { useState } from "react";
import { useAction, useApi, useQuery, ErrorBanner } from "@tp/client/react";
import { Button, Card, Empty, JalaliDateInput, KV, STAFF_ROLE_FA, Select, Status, TextArea, TextInput, fa, jdate, jdatetime } from "@tp/ui";
import type { StaffCase } from "@/lib/case";

interface Visit { id: string; state: string; visit_date: string; visit_time: string; visitor_id: string; confirmed_at: string | null; change_ticket_id: string | null; findings: string | null; done_at: string | null }
interface StaffMember { id: string; full_name: string | null; mobile: string | null; roles: string[] }

/** D-C16: the analyst proposes a date and a visitor; the applicant confirms or asks for another date; the visitor files the report. */
export function VisitPanel({ c, reload, canPropose, canReport }: { c: StaffCase; reload: () => void; canPropose: boolean; canReport: boolean }) {
  const api = useApi();
  const v = useQuery(`visit:${c.id}`, () => api.get<Visit | null>(`/admin/cases/${c.id}/visit`));
  const staff = useQuery(canPropose ? "staff:tech" : null, () => api.get<StaffMember[]>("/admin/staff"));
  const [f, setF] = useState({ date: "", time: "10:00", visitor: "" });
  const [findings, setFindings] = useState("");
  const propose = useAction(async () => { await api.post(`/admin/cases/${c.id}/visit`, { visit_date: f.date, visit_time: f.time, visitor_id: f.visitor }); v.reload(); reload(); });
  const report = useAction(async () => { await api.post(`/admin/cases/${c.id}/visit/report`, { findings: findings.trim() }); v.reload(); reload(); });
  const visit = v.data;
  const name = (id: string) => { const s = staff.data?.find((x) => x.id === id); return s ? s.full_name ?? s.mobile ?? "—" : "کارشناس صندوق"; };
  const live = visit && ["proposed", "confirmed", "change_requested"].includes(visit.state);
  return (
    <div className="grid-2" style={{ alignItems: "start" }}>
      <Card title="بازدید" action={visit ? <Status kind="visit" value={visit.state} /> : null}>
        <ErrorBanner error={v.error} />
        {visit ? (
          <KV rows={[["تاریخ", jdate(visit.visit_date)], ["ساعت", <span key="t" className="ltr">{fa(visit.visit_time)}</span>], ["بازدیدکننده", name(visit.visitor_id)],
            ["تأیید متقاضی", jdatetime(visit.confirmed_at)], ["انجام", jdatetime(visit.done_at)], ["یافته‌ها", visit.findings ?? "—"]]} />
        ) : <Empty title="بازدیدی برنامه‌ریزی نشده است" />}
        {visit?.state === "change_requested" && <p className="t-small t-muted" style={{ marginTop: 8 }}>متقاضی زمان دیگری خواسته است؛ تیکت مربوط را ببینید و زمان جدید پیشنهاد دهید.</p>}
      </Card>
      <div className="stack">
        {canPropose && (!visit || visit.state !== "done") && (
          <Card title={live ? "پیشنهاد زمان جدید" : "پیشنهاد زمان بازدید"}>
            <div className="stack">
              <div className="fieldset-grid">
                <JalaliDateInput label="تاریخ" value={f.date} onValue={(d) => setF({ ...f, date: d })} />
                <TextInput label="ساعت" ltr value={f.time} onValue={(t) => setF({ ...f, time: t })} placeholder="10:00" />
              </div>
              <Select label="بازدیدکننده" value={f.visitor} onValue={(x) => setF({ ...f, visitor: x })}
                options={(staff.data ?? []).filter((s) => s.roles.some((r) => ["technical_expert", "analyst"].includes(r))).map((s) => [s.id, `${s.full_name ?? s.mobile} — ${s.roles.map((r) => STAFF_ROLE_FA[r] ?? r).join("، ")}`])} />
              <ErrorBanner error={propose.error} />
              <Button busy={propose.busy} disabled={!f.date || !/^\d\d:\d\d$/.test(f.time) || !f.visitor} onClick={() => propose.run()}>ارسال به متقاضی</Button>
            </div>
          </Card>
        )}
        {canReport && visit && ["confirmed", "proposed"].includes(visit.state) && (
          <Card title="گزارش بازدید">
            <div className="stack">
              <TextArea label="یافته‌ها" value={findings} onValue={setFindings} hint="وضعیت محل، نیرو، خط تولید و انبار در مقایسه با اظهار متقاضی." />
              <ErrorBanner error={report.error} />
              <Button busy={report.busy} disabled={findings.trim().length < 10} onClick={() => report.run()}>ثبت گزارش</Button>
              <p className="t-small t-muted">تحویل اصل مدارک را در زبانه‌ی مدارک ثبت کنید.</p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
