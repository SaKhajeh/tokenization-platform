"use client";
import Link from "next/link";
import { useState } from "react";
import { useAction, useApi, useQuery, useStepUp, ErrorBanner } from "@tp/client/react";
import { Banner, Button, Card, KV, Status, TextInput, Tracker, jdate, latin } from "@tp/ui";
import { Shell } from "@/components/Shell";
import { FilePick } from "@/components/FilePick";
import { useMe } from "@/lib/me";

interface Snapshot { id: string; name: string; national_id: string; register_number: string; register_date: string; company_type: string; state: string; activity: string; address: string; postal_code: string; signature_authority: string; people: { name: string; position: string | null; roles: string[] }[] }
interface Kyb { kyb_status: string; kyb_expires_at: string | null; case: null | { id: string; version: number; status: string; fields: Record<string, string>; submitted_at: string; reviewed_at: string | null; decision_reason: string | null } }

const STEPS = ["ارسال اطلاعات", "بررسی کارشناس انطباق", "تأیید و صدور شناسه‌ی دیجیتال"];

/** A-07 … A-09: registry record from Jibit, declared details, documents, submit with OTP (FR-KYB-1..8). */
export default function KybPage() {
  const api = useApi();
  const stepUp = useStepUp();
  const { org, reload } = useMe();
  const kyb = useQuery(org ? `kyb:${org.id}` : null, () => api.get<Kyb>("/kyb"));
  const [reg, setReg] = useState<{ snapshot: Snapshot; you_are_listed: boolean } | null>(null);
  const [f, setF] = useState({ activity: "", address: "", postal_code: "", phone: "", website: "", contact_email: "" });
  const [docs, setDocs] = useState<{ articles?: [string, string]; gazette?: [string, string]; authority?: [string, string] }>({});

  const fetchReg = useAction(async () => {
    const r = await api.post<{ snapshot: Snapshot; you_are_listed: boolean }>("/kyb/registry");
    setReg(r);
    setF((x) => ({ ...x, activity: x.activity || r.snapshot.activity, address: x.address || r.snapshot.address, postal_code: x.postal_code || r.snapshot.postal_code }));
  });
  const submit = useAction(async (idem) => {
    const fields: Record<string, string> = { activity: f.activity.trim(), address: f.address.trim(), postal_code: latin(f.postal_code.trim()), phone: latin(f.phone.trim()) };
    if (f.website.trim()) fields.website = f.website.trim();
    if (f.contact_email.trim()) fields.contact_email = f.contact_email.trim();
    const body: Record<string, unknown> = { snapshot_id: reg!.snapshot.id, fields };
    if (docs.articles) body.articles_doc_id = docs.articles[0];
    if (docs.gazette) body.gazette_doc_id = docs.gazette[0];
    if (docs.authority) body.authority_doc_id = docs.authority[0];
    await stepUp("POST", "/kyb/submit", body, { idem, title: "ارسال احراز هویت سازمان", summary: <span>اطلاعات و مدارک {reg!.snapshot.name} برای بررسی به صندوق ارسال می‌شود.</span> });
    setReg(null);
    kyb.reload();
    await reload();
  });

  const s = kyb.data;
  const canSubmit = s && ["not_started", "rejected", "info_requested", "expired", "approved"].includes(s.kyb_status);
  const current = !s ? 0 : s.kyb_status === "approved" ? 3 : s.kyb_status === "in_review" ? 1 : 0;
  const isAdmin = org?.my_role === "org_admin";

  return (
    <Shell title="احراز هویت سازمان" action={s ? <Status kind="kyb" value={s.kyb_status} /> : null}>
      <div className="stack">
        <ErrorBanner error={kyb.error} />
        {s && (
          <Card>
            <div className="grid-2">
              <Tracker steps={STEPS} current={current} />
              <KV rows={[
                ["وضعیت", <Status key="s" kind="kyb" value={s.kyb_status} />],
                ["تاریخ ارسال", jdate(s.case?.submitted_at)],
                ["اعتبار تا", jdate(s.kyb_expires_at)],
                ...(s.case?.decision_reason ? [["توضیح کارشناس", s.case.decision_reason] as [string, string]] : []),
              ]} />
            </div>
          </Card>
        )}
        {s?.kyb_status === "in_review" && <Banner tone="info">اطلاعات شما در حال بررسی است. نتیجه با پیامک و اعلان به شما اطلاع داده می‌شود.</Banner>}
        {s?.kyb_status === "approved" && !reg && (
          <Banner tone="success">
            احراز هویت سازمان تأیید شده است. گام بعد: <Link href="/bank">افزودن حساب بانکی</Link>.
          </Banner>
        )}

        {canSubmit && !reg && isAdmin && (
          <Card title={s!.kyb_status === "approved" ? "به‌روزرسانی اطلاعات سازمان" : "اطلاعات ثبتی سازمان"}>
            <div className="stack">
              <p className="t-muted">اطلاعات رسمی شرکت از سامانه‌ی ثبت شرکت‌ها دریافت می‌شود؛ سپس جزئیات تماس و مدارک را تکمیل می‌کنید.</p>
              <ErrorBanner error={fetchReg.error} />
              <Button busy={fetchReg.busy} onClick={() => fetchReg.run()}>دریافت اطلاعات ثبتی</Button>
            </div>
          </Card>
        )}
        {canSubmit && !isAdmin && <Banner tone="info">ارسال احراز هویت فقط با مدیر سازمان است.</Banner>}

        {reg && (
          <>
            <Card title="سوابق ثبتی (از سامانه‌ی ثبت)">
              <KV rows={[
                ["نام", reg.snapshot.name], ["شناسه‌ی ملی", <span key="n" className="ltr">{reg.snapshot.national_id}</span>],
                ["شماره‌ی ثبت", reg.snapshot.register_number], ["نوع شرکت", reg.snapshot.company_type], ["وضعیت", reg.snapshot.state],
                ["صاحبان امضا", reg.snapshot.signature_authority],
                ["مدیران", reg.snapshot.people.length ? reg.snapshot.people.map((p) => `${p.name}${p.position ? ` (${p.position})` : ""}`).join("، ") : "—"],
              ]} />
              {!reg.you_are_listed && (
                <div style={{ marginTop: 12 }}>
                  <Banner tone="warning">نام شما در فهرست مدیرعامل یا اعضای هیئت‌مدیره نیست. معرفی‌نامه‌ی رسمی با امضای صاحبان امضای مجاز را بارگذاری کنید.</Banner>
                </div>
              )}
            </Card>
            <Card title="اطلاعات تماس و فعالیت">
              <div className="fieldset-grid">
                <TextInput label="موضوع فعالیت" value={f.activity} onValue={(v) => setF({ ...f, activity: v })} />
                <TextInput label="نشانی" value={f.address} onValue={(v) => setF({ ...f, address: v })} />
                <TextInput label="کد پستی (۱۰ رقم)" digits ltr maxLength={10} value={f.postal_code} onValue={(v) => setF({ ...f, postal_code: v })} />
                <TextInput label="تلفن ثابت" digits ltr value={f.phone} onValue={(v) => setF({ ...f, phone: v })} />
                <TextInput label="وب‌سایت (اختیاری)" ltr value={f.website} onValue={(v) => setF({ ...f, website: v })} placeholder="https://" />
                <TextInput label="ایمیل سازمان (اختیاری)" ltr value={f.contact_email} onValue={(v) => setF({ ...f, contact_email: v })} />
              </div>
            </Card>
            <Card title="مدارک">
              <ul className="list">
                {([["articles", "اساسنامه و آگهی تأسیس", "kyb_articles"], ["gazette", "آخرین آگهی تغییرات (روزنامه‌ی رسمی)", "kyb_gazette"],
                  ...(!reg.you_are_listed ? [["authority", "معرفی‌نامه‌ی نماینده", "authority_letter"]] : [])] as [keyof typeof docs, string, string][]).map(([k, title, cat]) => (
                  <li key={k}>
                    <div>
                      <div>{title}</div>
                      <div className="t-small t-muted">{docs[k] ? `بارگذاری شد: ${docs[k]![1]}` : "PDF یا تصویر، حداکثر ۲۰ مگابایت"}</div>
                    </div>
                    <FilePick size="sm" label={docs[k] ? "تغییر فایل" : "بارگذاری"} category={cat} onUploaded={(id, file) => setDocs({ ...docs, [k]: [id, file.name] })} />
                  </li>
                ))}
              </ul>
              <p className="t-small t-muted" style={{ marginTop: 8 }}>اساسنامه و روزنامه‌ی رسمی یک بار اینجا بارگذاری می‌شوند و به پرونده‌ی اعتباری منتقل می‌شوند.</p>
            </Card>
            <ErrorBanner error={submit.error} />
            <div className="row">
              <Button busy={submit.busy} onClick={() => submit.run()}
                disabled={f.activity.trim().length < 3 || f.address.trim().length < 10 || latin(f.postal_code).length !== 10 || latin(f.phone).length < 8 || (!reg.you_are_listed && !docs.authority)}>
                ارسال برای بررسی
              </Button>
              <Button variant="outline" onClick={() => setReg(null)}>انصراف</Button>
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}
