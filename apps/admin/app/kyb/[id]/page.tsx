"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useAction, useApi, useQuery, ErrorBanner } from "@tp/client/react";
import { Banner, Button, Card, Chip, KV, Status, TextArea, jdate, jdatetime } from "@tp/ui";
import { Shell } from "@/components/Shell";
import { useStaff } from "@/lib/me";

interface Kyb {
  id: string; org_id: string; legal_name: string; national_id: string; version: number; status: string; fields: Record<string, string>; risk_flags: string[]; bounced_cheques: number;
  authority_basis: string; authority_doc_id: string | null; submitted_by: { full_name: string | null; mobile: string }; submitted_at: string; decision_reason: string | null; expires_at: string | null;
  registry: { fetched_at: string; name: string; national_id: string; register_number: string; register_date: string; company_type: string; state: string; activity: string; address: string; postal_code: string; signature_authority: string; bankrupt: boolean; suspended: boolean; people: { name: string; position: string | null; roles: string[] }[] };
}
const FLAG_FA: Record<string, string> = {
  registry_state_not_active: "شرکت در سامانه‌ی ثبت فعال نیست", bankrupt: "ورشکسته", suspended: "تعلیق", name_differs_from_registry: "نام با سوابق ثبت فرق دارد",
  postal_code_differs_from_registry: "کد پستی با سوابق ثبت فرق دارد", bounced_cheques: "چک برگشتی", bounced_cheque_check_unavailable: "استعلام چک برگشتی انجام نشد",
  authority_by_document: "نماینده با معرفی‌نامه",
};

/** S-02 review: registry record next to the declared details; Jibit risk flags; decision with reason (FR-KYB-4). */
export default function KybReview() {
  const api = useApi();
  const { has } = useStaff();
  const { id } = useParams<{ id: string }>();
  const q = useQuery(`kyb:${id}`, () => api.get<Kyb>(`/admin/kyb/${id}`));
  const [reason, setReason] = useState("");
  const decide = useAction(async (_k, decision: "approve" | "reject" | "request_info") => {
    await api.post(`/admin/kyb/${id}/decision`, { decision, ...(reason.trim() ? { reason: reason.trim() } : {}) });
    q.reload();
  });
  const k = q.data;
  const same = (a?: string, b?: string) => (a ?? "").replace(/\s/g, "") === (b ?? "").replace(/\s/g, "");
  return (
    <Shell title={k ? `احراز هویت: ${k.legal_name}` : "احراز هویت"} action={k ? <Status kind="kyb" value={k.status} /> : null}>
      <div className="stack">
        <Link href="/kyb">← بازگشت به صف</Link>
        <ErrorBanner error={q.error} />
        {k && (<>
          {(k.risk_flags.length > 0 || k.bounced_cheques > 0) && (
            <Banner tone="danger">هشدارهای استعلام: {[...k.risk_flags.map((f) => FLAG_FA[f] ?? f), ...(k.bounced_cheques ? [`${k.bounced_cheques.toLocaleString("fa-IR")} چک برگشتی`] : [])].join("، ")}. رد خودکار انجام نمی‌شود؛ تصمیم با شماست.</Banner>
          )}
          <div className="cmp">
            <Card title={`سامانه‌ی ثبت (استعلام ${jdatetime(k.registry.fetched_at)})`}>
              <KV rows={[
                ["نام", k.registry.name], ["شناسه‌ی ملی", <span key="n" className="ltr">{k.registry.national_id}</span>], ["شماره و تاریخ ثبت", `${k.registry.register_number} — ${k.registry.register_date}`],
                ["نوع", k.registry.company_type], ["وضعیت", k.registry.state], ["فعالیت", k.registry.activity], ["نشانی", k.registry.address],
                ["کد پستی", <span key="p" className="ltr">{k.registry.postal_code}</span>], ["صاحبان امضا", k.registry.signature_authority],
                ["مدیران", k.registry.people.map((p) => `${p.name}${p.position ? ` (${p.position})` : ""}`).join("، ") || "—"],
              ]} />
            </Card>
            <Card title={`اظهار متقاضی — نسخه‌ی ${k.version.toLocaleString("fa-IR")}`}>
              <KV rows={[
                ["نام", k.legal_name], ["فعالیت", k.fields.activity],
                ["نشانی", <span key="a" className={same(k.fields.address, k.registry.address) ? "" : "diff"}>{k.fields.address}</span>],
                ["کد پستی", <span key="p" className={`ltr ${same(k.fields.postal_code, k.registry.postal_code) ? "" : "diff"}`}>{k.fields.postal_code}</span>],
                ["تلفن", <span key="t" className="ltr">{k.fields.phone}</span>], ["وب‌سایت", k.fields.website ?? "—"], ["ایمیل", k.fields.contact_email ?? "—"],
                ["ارسال‌کننده", <span key="s">{k.submitted_by.full_name ?? ""} <span className="ltr">{k.submitted_by.mobile}</span></span>],
                ["اختیار نماینده", k.authority_basis === "registry" ? "نام در سامانه‌ی ثبت" : <Chip key="c" tone="warning">با معرفی‌نامه — پیوست را بررسی کنید</Chip>],
                ["تاریخ ارسال", jdatetime(k.submitted_at)],
              ]} />
            </Card>
          </div>
          {k.status === "in_review" && has("compliance_officer") ? (
            <Card title="تصمیم">
              <div className="stack">
                <TextArea label="توضیح (برای رد یا درخواست اطلاعات الزامی است؛ برای متقاضی نمایش داده می‌شود)" value={reason} onValue={setReason} rows={3} />
                <ErrorBanner error={decide.error} />
                <div className="row">
                  <Button busy={decide.busy} onClick={() => decide.run("approve")}>تأیید و صدور شناسه‌ی دیجیتال</Button>
                  <Button variant="outline" busy={decide.busy} disabled={reason.trim().length < 3} onClick={() => decide.run("request_info")}>درخواست اطلاعات</Button>
                  <Button variant="danger" busy={decide.busy} disabled={reason.trim().length < 3} onClick={() => decide.run("reject")}>رد</Button>
                </div>
              </div>
            </Card>
          ) : k.status !== "in_review" ? (
            <Card><KV rows={[["تصمیم", <Status key="s" kind="kyb" value={k.status} />], ["توضیح", k.decision_reason ?? "—"], ["اعتبار تا", jdate(k.expires_at)]]} /></Card>
          ) : null}
        </>)}
      </div>
    </Shell>
  );
}
