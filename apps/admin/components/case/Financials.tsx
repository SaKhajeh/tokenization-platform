"use client";
import { Fragment, useState } from "react";
import { useAction, useApi, ErrorBanner } from "@tp/client/react";
import { Banner, Button, Card, FIN_GROUPS, FIN_TOTALS, STATEMENT_TYPE_FA, TextInput, fa, jdatetime, latin, millions } from "@tp/ui";
import type { StaffCase } from "@/lib/case";

/** S-18: declared vs verified figures per year; each change needs a reason and is kept; lock before scoring (doc 07 §5.2). */
export function Financials({ c, reload, canEdit }: { c: StaffCase; reload: () => void; canEdit: boolean }) {
  const api = useApi();
  const years = [c.latest_fiscal_year, c.latest_fiscal_year - 1, c.latest_fiscal_year - 2];
  const fin = (y: number) => c.financials.find((f) => f.fiscal_year === y);
  const [edit, setEdit] = useState<{ y: number; k: string; label: string; value: string; reason: string } | null>(null);
  const locked = !!c.financials_locked_at;
  const editable = canEdit && !locked && ["documents_complete", "document_review", "scoring", "sent_back_to_analyst"].includes(c.state);
  const save = useAction(async () => {
    await api.put(`/admin/cases/${c.id}/financials/${edit!.y}/${edit!.k}`, { value: latin(edit!.value).replace(/[^\d-]/g, ""), reason: edit!.reason.trim() });
    setEdit(null); reload();
  });
  const lock = useAction(async () => { await api.post(`/admin/cases/${c.id}/financials/lock`); reload(); });
  return (
    <div className="stack">
      {locked ? <Banner tone="success">ارقام تأییدشده در {jdatetime(c.financials_locked_at)} قفل شد و مبنای محاسبه است.</Banner>
        : <Banner tone="info">ارقام متقاضی را با صورت‌های مالی بارگذاری‌شده تطبیق دهید. برای تغییر هر رقم، روی آن بزنید و دلیل بنویسید. پیش از محاسبه، ارقام را قفل کنید.</Banner>}
      {edit && (
        <Card highlight title={`اصلاح «${edit.label}» — سال ${fa(edit.y)}`}>
          <div className="fieldset-grid">
            <TextInput label="رقم تأییدشده (میلیون ریال)" ltr value={edit.value} onValue={(v) => setEdit({ ...edit, value: v })} />
            <TextInput label="دلیل (مثلاً مطابق یادداشت ۱۲ صورت مالی)" value={edit.reason} onValue={(v) => setEdit({ ...edit, reason: v })} />
          </div>
          <ErrorBanner error={save.error} />
          <div className="row" style={{ marginTop: 12 }}>
            <Button busy={save.busy} disabled={edit.reason.trim().length < 3} onClick={() => save.run()}>ثبت</Button>
            <Button variant="outline" onClick={() => setEdit(null)}>انصراف</Button>
          </div>
        </Card>
      )}
      <Card>
        <div className="table-wrap"><table className="table fin">
          <thead>
            <tr><th>قلم</th>{years.map((y) => <th key={y} colSpan={2}>سال {fa(y)} — {STATEMENT_TYPE_FA[fin(y)?.statement_type ?? ""] ?? "—"}</th>)}</tr>
            <tr><th />{years.map((y) => <Fragment key={y}><th>اظهار</th><th>تأییدشده</th></Fragment>)}</tr>
          </thead>
          <tbody>
            {FIN_GROUPS.map(([g, rows]) => (
              <Fragment key={g}>
                <tr className="group"><td colSpan={7}>{g}</td></tr>
                {rows.map(([k, label]) => (
                  <tr key={k}>
                    <td>{label}</td>
                    {years.map((y) => {
                      const f = fin(y);
                      const d = f?.declared?.[k], v = f?.verified?.[k] ?? d;
                      return (
                        <Fragment key={y}>
                          <td className="num">{millions(d)}</td>
                          <td className={`num ${v !== d ? "changed" : ""}`}>
                            {editable ? <button className="btn btn-ghost btn-sm" style={{ minHeight: 28, padding: "0 4px" }} onClick={() => setEdit({ y, k, label, value: v ?? "", reason: "" })}>{millions(v)}</button> : millions(v)}
                          </td>
                        </Fragment>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
            <tr className="group"><td colSpan={7}>جمع‌ها</td></tr>
            {FIN_TOTALS.map(([k, label]) => (
              <tr key={k} className="total"><td>{label}</td>{years.map((y) => {
                const f = fin(y); const camel = k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
                const d = (f?.totals as any)?.[camel] ?? (f?.totals as any)?.[k]; const v = (f?.verified_totals as any)?.[camel] ?? (f?.verified_totals as any)?.[k] ?? d;
                return <Fragment key={y}><td className="num">{millions(d)}</td><td className="num">{millions(v)}</td></Fragment>;
              })}</tr>
            ))}
          </tbody>
        </table></div>
      </Card>
      {c.financials.some((f) => f.adjustments?.length) && (
        <Card title="سابقه‌ی اصلاح ارقام">
          <ul className="list">{c.financials.flatMap((f) => (f.adjustments ?? []).map((a, i) => (
            <li key={`${f.fiscal_year}-${i}`}><span>سال {fa(f.fiscal_year)} — {FIN_GROUPS.flatMap((g) => g[1]).find((x) => x[0] === a.field)?.[1] ?? a.field}: {millions(a.declared)} ← {millions(a.verified)} — {a.reason}</span><span className="t-small t-muted">{jdatetime(a.at)}</span></li>
          )))}</ul>
        </Card>
      )}
      <ErrorBanner error={lock.error} />
      {editable && <div className="row"><Button busy={lock.busy} onClick={() => lock.run()}>قفل ارقام تأییدشده</Button></div>}
    </div>
  );
}
