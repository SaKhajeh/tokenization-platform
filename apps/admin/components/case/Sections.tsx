"use client";
import { useState } from "react";
import { useAction, useApi, ErrorBanner } from "@tp/client/react";
import { Button, Card, Chip, Status, TextInput } from "@tp/ui";
import type { StaffCase } from "@/lib/case";

const LABEL: Record<string, string> = {
  legal_name: "نام", legal_form: "نوع", national_id: "شناسه/کد ملی", registration_no: "شماره‌ی ثبت", registration_place: "محل ثبت", establishment_date: "تاریخ تأسیس",
  economic_code: "کد اقتصادی", activity_subject: "موضوع فعالیت", capital_initial: "سرمایه‌ی اولیه", capital_current: "سرمایه‌ی فعلی", landline: "تلفن", company_email: "ایمیل",
  ceo: "مدیرعامل", representative: "نماینده", heard_from: "آشنایی", is_knowledge_based: "دانش‌بنیان", rows: "محل‌ها", people: "اشخاص", entries: "سوابق", gazette_no: "شماره‌ی روزنامه",
  gazette_date: "تاریخ روزنامه", full_time: "تمام‌وقت", part_time: "پاره‌وقت", insured: "بیمه‌شده", history: "تاریخچه", process: "فرایند", products: "محصولات", banks: "حساب‌ها",
  facilities: "تسهیلات", guarantees: "ضمانت‌نامه‌ها", declaration: "اظهارنامه", licences: "مجوزها", contracts: "قراردادها", assets: "دارایی‌ها", key_staff: "نیروی کلیدی",
};
const show = (v: any): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "بله" : "خیر";
  if (Array.isArray(v)) return v.map((x) => (typeof x === "object" ? Object.values(x).filter((y) => y !== "" && y !== null).map(show).join(" / ") : show(x))).join("؛ ");
  if (typeof v === "object") return Object.entries(v).map(([k, x]) => `${LABEL[k] ?? k}: ${show(x)}`).join("، ");
  return String(v);
};

/** Form sections (doc 07 §4): read the applicant's data, accept or send back with a message. */
export function Sections({ c, reload, canReview }: { c: StaffCase; reload: () => void; canReview: boolean }) {
  const api = useApi();
  const [msg, setMsg] = useState<Record<string, string>>({});
  const review = useAction(async (_k, section: string, decision: "accept" | "needs_fix") => {
    await api.post(`/admin/cases/${c.id}/sections/${section}/review`, { decision, ...(decision === "needs_fix" ? { reason_code: "incomplete", message: msg[section]?.trim() } : {}) });
    reload();
  });
  return (
    <div className="stack">
      <ErrorBanner error={review.error} />
      {c.sections.map((s) => (
        <Card key={s.section} title={s.title} action={<div className="row">{s.changed_from_registration.length > 0 && <Chip tone="warning">تغییر نسبت به ثبت‌نام</Chip>}{s.problems.length > 0 && <Chip tone="danger">ناقص</Chip>}<Status kind="item" value={s.state} /></div>}>
          <dl className="kv">{Object.entries(s.data ?? {}).map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}><dt>{LABEL[k] ?? k}</dt><dd>{show(v)}</dd></div>
          ))}</dl>
          {canReview && s.state === "in_review" && (
            <div className="row" style={{ marginTop: 12, alignItems: "flex-end" }}>
              <Button size="sm" busy={review.busy} onClick={() => review.run(s.section, "accept")}>پذیرفتن</Button>
              <div style={{ flex: 1, minWidth: 220 }}><TextInput label="پیام برای اصلاح" value={msg[s.section] ?? ""} onValue={(v) => setMsg({ ...msg, [s.section]: v })} /></div>
              <Button size="sm" variant="outline" busy={review.busy} disabled={(msg[s.section] ?? "").trim().length < 3} onClick={() => review.run(s.section, "needs_fix")}>نیاز به اصلاح</Button>
            </div>
          )}
        </Card>
      ))}
      {c.letter.rendered && <Card title="درخواست‌نامه"><pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: 0 }}>{c.letter.rendered}</pre></Card>}
    </div>
  );
}
