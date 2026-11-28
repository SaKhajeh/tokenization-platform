"use client";
import { useState } from "react";
import { useAction, useApi, ErrorBanner } from "@tp/client/react";
import { Button, Card, Chip, REVIEW_REASON_FA, Select, Status, TextArea, TextInput, fa, jdatetime } from "@tp/ui";
import type { Item, StaffCase } from "@/lib/case";
import { trialBalancePeriod } from "@tp/domain/caseFile";

/** S-17: checklist on one side, the file viewer on the other; accept / needs fix / reject per slot (doc 07 §3.3). Every open is logged. */
export function Documents({ c, reload, canReview, canOriginal }: { c: StaffCase; reload: () => void; canReview: boolean; canOriginal: boolean }) {
  const api = useApi();
  const items = c.items.filter((i) => i.state !== "not_required");
  const [sel, setSel] = useState<Item | null>(items.find((i) => i.state === "in_review") ?? items[0] ?? null);
  const [view, setView] = useState<{ url: string; mime: string; name: string } | null>(null);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");
  const [req, setReq] = useState({ title: "", message: "" });
  const current = sel ? c.items.find((i) => i.id === sel.id) ?? sel : null;
  const reviewing = ["submitted", "resubmitted", "document_review", "documents_complete"].includes(c.state);

  const open = useAction(async (_k, fileId: string, mime: string, name: string, action: "view" | "download") => {
    const r = await api.get<{ url: string }>(`/admin/cases/${c.id}/files/${fileId}/${action}`);
    if (action === "download") window.open(r.url, "_blank", "noopener");
    else setView({ url: r.url, mime, name });
  });
  const review = useAction(async (_k, decision: "accept" | "needs_fix" | "reject") => {
    await api.post(`/admin/cases/${c.id}/items/${current!.id}/review`, { decision, ...(decision !== "accept" ? { reason_code: reason || "other", message: msg.trim() || undefined } : {}) });
    setReason(""); setMsg("");
    const next = items.find((i) => i.state === "in_review" && i.id !== current!.id);
    if (next) setSel(next);
    reload();
  });
  const original = useAction(async () => { await api.post(`/admin/cases/${c.id}/items/${current!.id}/original-received`); reload(); });
  const request = useAction(async () => { await api.post(`/admin/cases/${c.id}/requests`, { title: req.title.trim(), message: req.message.trim() }); setReq({ title: "", message: "" }); reload(); });

  return (
    <div className="review">
      <div className="stack">
        <Card>
          <div className="stack-sm">
            {items.map((i) => (
              <div key={i.id} className={`item ${current?.id === i.id ? "active" : ""}`} onClick={() => { setSel(i); setView(null); }} role="button" tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && setSel(i)}>
                <div className="row-between"><span className="t-small t-muted ltr">{i.code}</span><Status kind="item" value={i.state} /></div>
                <div>{i.title}</div>
                <div className="t-small t-muted">{i.label}</div>
              </div>
            ))}
          </div>
        </Card>
        {canReview && reviewing && (
          <Card title="درخواست مدرک اضافه">
            <div className="stack">
              <TextInput label="عنوان" value={req.title} onValue={(v) => setReq({ ...req, title: v })} />
              <TextArea label="پیام به متقاضی" value={req.message} onValue={(v) => setReq({ ...req, message: v })} rows={2} />
              <ErrorBanner error={request.error} />
              <Button size="sm" variant="secondary" busy={request.busy} disabled={req.title.trim().length < 3 || req.message.trim().length < 3} onClick={() => request.run()}>ثبت درخواست</Button>
            </div>
          </Card>
        )}
      </div>
      <div className="stack">
        {current && (
          <Card title={<div className="stack-sm"><h2 className="t-h3">{current.title} — {current.label}</h2>{current.guidance && <span className="t-small t-muted">{current.guidance}</span>}{current.code === "3-2" && (() => { const tb = trialBalancePeriod(new Date(Date.now() + 3.5 * 3600_000).toISOString().slice(0, 10)); return tb ? <span className="t-small">دوره‌ی مورد انتظار: {fa(tb.label)}</span> : null; })()}</div>}
            action={<div className="row">{current.original_required && <Chip tone="info">اصل در بازدید</Chip>}{current.from_kyb && <Chip>از احراز هویت</Chip>}</div>}>
            <div className="stack">
              {current.files.filter((f) => !f.removed_at).map((f) => (
                <div key={f.id} className="row-between" style={{ background: "var(--neutral-100)", borderRadius: 8, padding: "6px 10px" }}>
                  <span>{f.filename} <span className="t-small t-muted">نسخه‌ی {f.version} — {jdatetime(f.uploaded_at)}</span>{f.link_url && <a className="t-small" href={f.link_url} target="_blank" rel="noreferrer"> پیوند گزارش</a>}</span>
                  <span className="row"><Button size="sm" variant="ghost" onClick={() => open.run(f.id, f.mime, f.filename, "view")}>نمایش</Button><Button size="sm" variant="ghost" onClick={() => open.run(f.id, f.mime, f.filename, "download")}>دریافت</Button></span>
                </div>
              ))}
              {!current.files.filter((f) => !f.removed_at).length && <p className="t-muted">{current.state === "not_available" ? "متقاضی «ندارم» زده است." : "فایلی بارگذاری نشده است."}</p>}
              {current.review && <p className="t-small t-muted">آخرین بررسی: {({ accept: "پذیرفته", needs_fix: "نیاز به اصلاح", reject: "رد" } as Record<string, string>)[current.review.decision]} — {jdatetime(current.review.at)}{current.review.message ? ` — ${current.review.message}` : ""}</p>}
              <ErrorBanner error={open.error ?? review.error ?? original.error} />
              {canReview && current.state === "in_review" && (
                <div className="stack">
                  <div className="fieldset-grid">
                    <Select label="دلیل (برای اصلاح یا رد)" value={reason} onValue={setReason} options={Object.entries(REVIEW_REASON_FA)} />
                    <TextInput label="پیام به متقاضی" value={msg} onValue={setMsg} />
                  </div>
                  <div className="row">
                    <Button busy={review.busy} onClick={() => review.run("accept")}>پذیرفتن</Button>
                    <Button variant="outline" busy={review.busy} disabled={!reason} onClick={() => review.run("needs_fix")}>نیاز به اصلاح</Button>
                    <Button variant="danger" busy={review.busy} disabled={!reason} onClick={() => review.run("reject")}>رد</Button>
                  </div>
                </div>
              )}
              {canOriginal && current.original_required && current.state === "accepted" && !current.original_received_at && (
                <Button variant="secondary" busy={original.busy} onClick={() => original.run()}>اصل مدرک تحویل گرفته شد</Button>
              )}
              {current.original_received_at && <span className="chip chip-success">اصل تحویل شد {jdatetime(current.original_received_at)}</span>}
            </div>
          </Card>
        )}
        <div className="viewer">
          {view ? (
            view.mime.startsWith("image/") ? <img src={view.url} alt={view.name} /> : view.mime === "application/pdf" ? <iframe src={view.url} title={view.name} /> :
              <div className="empty"><span>پیش‌نمایش این نوع فایل ممکن نیست.</span><a href={view.url} target="_blank" rel="noreferrer">دریافت فایل</a></div>
          ) : <div className="empty"><span>برای نمایش، روی «نمایش» یک فایل بزنید.</span><span className="t-small">هر نمایش و دریافت در سابقه‌ی دسترسی پرونده ثبت می‌شود.</span></div>}
        </div>
      </div>
    </div>
  );
}
