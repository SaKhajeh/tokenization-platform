"use client";
import Link from "next/link";
import { useState } from "react";
import { useAction, useApi, useQuery, ErrorBanner } from "@tp/client/react";
import { Banner, Button, Card, Chip, REVIEW_REASON_FA, Status, TextInput, Toast, jdatetime } from "@tp/ui";
import { Shell } from "@/components/Shell";
import { FilePick } from "@/components/FilePick";
import { useMe } from "@/lib/me";
import { EDITABLE, RETURNED_ITEM, type Case, type CaseItem } from "@/lib/case";

const EDITABLE_ITEM = ["empty", "requested", "uploaded", "not_available", "needs_fix", "rejected"];

/** Doc 07 §3: the checklist, one slot per person / year / location / bank account; guidance, review notes, uploads. */
export default function DocumentsPage() {
  const api = useApi();
  const { org } = useMe();
  const cs = useQuery(org ? `case:${org.id}` : null, () => api.get<Case>("/case"));
  const [links, setLinks] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const c = cs.data;
  const canEdit = !!c && EDITABLE.includes(c.state) && ["org_admin", "preparer"].includes(org?.my_role ?? "");

  const addFile = useAction(async (idem, item: CaseItem, docId: string) => {
    await api.post(`/case/items/${item.id}/files`, { document_id: docId, link_url: links[item.id]?.trim() || undefined }, { idem });
    cs.reload(); setToast("فایل اضافه شد");
  });
  const removeFile = useAction(async (_k, item: CaseItem, fileId: string) => { await api.del(`/case/items/${item.id}/files/${fileId}`); cs.reload(); });
  const notAvailable = useAction(async (_k, item: CaseItem) => { await api.post(`/case/items/${item.id}/not-available`); cs.reload(); });

  const items = (c?.items ?? []).filter((i) => i.state !== "not_required").filter((i) => !onlyOpen || ["empty", ...RETURNED_ITEM].includes(i.state));
  const groups = new Map<string, CaseItem[]>();
  for (const i of items) groups.set(`${i.code}|${i.title}`, [...(groups.get(`${i.code}|${i.title}`) ?? []), i]);

  return (
    <Shell title="مدارک پرونده">
      <div className="stack">
        <Link href="/case">← بازگشت به پرونده</Link>
        <div className="row-between">
          <p className="t-muted">PDF، تصویر (JPG، PNG، HEIC)، Word یا Excel تا ۲۰ مگابایت. هر فایل جداگانه بررسی می‌شود.</p>
          <Button variant="outline" size="sm" onClick={() => setOnlyOpen(!onlyOpen)}>{onlyOpen ? "نمایش همه" : "فقط موارد باز"}</Button>
        </div>
        <ErrorBanner error={cs.error ?? addFile.error ?? removeFile.error ?? notAvailable.error} />
        {[...groups.entries()].map(([key, list]) => {
          const first = list[0];
          return (
            <Card key={key} title={<div className="stack-sm"><h2 className="t-h3">{first.title}</h2>{first.guidance && <span className="t-small t-muted">{first.guidance}</span>}</div>}
              action={<div className="row">{first.required === "if_available" && <Chip>در صورت وجود</Chip>}{first.original_required && <Chip tone="info">تحویل اصل در بازدید</Chip>}</div>}>
              <div>
                {list.map((i) => {
                  const editable = canEdit && EDITABLE_ITEM.includes(i.state) && (c!.state !== "returned" || RETURNED_ITEM.includes(i.state));
                  return (
                    <div key={i.id} className="slot">
                      <div className="row-between">
                        <strong>{i.label}</strong>
                        <div className="row">{i.from_kyb && <Chip>از احراز هویت</Chip>}<Status kind="item" value={i.state} /></div>
                      </div>
                      {i.review && i.review.decision !== "accept" && (
                        <div className="review-note">
                          {i.review.reason_code ? `${REVIEW_REASON_FA[i.review.reason_code] ?? i.review.reason_code}. ` : ""}{i.review.message ?? ""}
                        </div>
                      )}
                      {i.files.map((f) => (
                        <div key={f.id} className="file-row">
                          <span>{f.filename} <span className="t-muted t-small">— نسخه‌ی {f.version}، {jdatetime(f.uploaded_at)}</span>{f.link_url && <span className="t-small ltr"> {f.link_url}</span>}</span>
                          {editable && <Button size="sm" variant="ghost" onClick={() => removeFile.run(i, f.id)}>حذف</Button>}
                        </div>
                      ))}
                      {editable && (
                        <div className="row">
                          {i.with_link && <div style={{ minWidth: 240 }}><TextInput label="پیوند پیامکی گزارش" ltr value={links[i.id] ?? ""} onValue={(v) => setLinks({ ...links, [i.id]: v })} placeholder="https://" /></div>}
                          {(i.multi || !i.files.length || ["needs_fix", "rejected"].includes(i.state)) && (
                            <FilePick size="sm" label={i.files.length ? "افزودن فایل" : "بارگذاری"} onUploaded={(doc) => addFile.run(i, doc)}
                              disabled={i.with_link && !(links[i.id] ?? "").startsWith("http")} />
                          )}
                          {i.required === "if_available" && i.state !== "not_available" && <Button size="sm" variant="ghost" onClick={() => notAvailable.run(i)}>ندارم</Button>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
        {c && !items.length && <Banner tone="success">موردی باز نیست.</Banner>}
      </div>
      <Toast message={toast} onDone={() => setToast(null)} />
    </Shell>
  );
}
