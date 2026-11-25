"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useAction, useApi, useQuery, ErrorBanner } from "@tp/client/react";
import { Banner, Button, Status, Tabs } from "@tp/ui";
import { Shell } from "@/components/Shell";
import { useStaff } from "@/lib/me";
import type { StaffCase } from "@/lib/case";
import { Summary } from "@/components/case/Summary";
import { Documents } from "@/components/case/Documents";
import { Sections } from "@/components/case/Sections";
import { Financials } from "@/components/case/Financials";
import { VisitPanel } from "@/components/case/Visit";
import { Scoring } from "@/components/case/Scoring";

type Tab = "summary" | "documents" | "form" | "financials" | "visit" | "scoring";

/** The credit-case workspace (S-16 … S-19). */
export default function CaseWorkspace() {
  const api = useApi();
  const { me, has } = useStaff();
  const { id } = useParams<{ id: string }>();
  const q = useQuery(`case:${id}`, () => api.get<StaffCase>(`/admin/cases/${id}`));
  const [tab, setTab] = useState<Tab>("summary");
  const act = useAction(async (_k, path: string) => { await api.post(`/admin/cases/${id}/${path}`); q.reload(); });
  const c = q.data;
  const analyst = has("analyst");
  const open = c ? c.items.filter((i) => i.state === "in_review").length + c.sections.filter((s) => s.state === "in_review").length : 0;
  const toFix = c ? c.items.filter((i) => ["needs_fix", "rejected", "requested"].includes(i.state)).length + c.sections.filter((s) => ["needs_fix", "rejected"].includes(s.state)).length : 0;

  return (
    <Shell title={c ? <h1 className="t-h1">پرونده‌ی <span className="ltr">{c.case_no}</span></h1> : "پرونده"} action={c ? <Status kind="case" value={c.state} /> : null}>
      <div className="stack">
        <Link href="/cases">← بازگشت به صف</Link>
        <ErrorBanner error={q.error ?? act.error} />
        {c && (<>
          {analyst && ["submitted", "resubmitted"].includes(c.state) && (
            <Banner tone="info"><div className="row-between"><span>پرونده آماده‌ی بررسی است.</span><Button size="sm" busy={act.busy} onClick={() => act.run("start-review")}>شروع بررسی (به نام من)</Button></div></Banner>
          )}
          {analyst && c.state === "document_review" && (
            <div className="row">
              {open > 0 && <span className="t-muted">{open.toLocaleString("fa-IR")} مورد در انتظار بررسی</span>}
              <Button variant="outline" busy={act.busy} disabled={open > 0 || toFix === 0} onClick={() => act.run("return")}>بازگرداندن به متقاضی ({toFix.toLocaleString("fa-IR")})</Button>
              <Button busy={act.busy} disabled={open > 0 || toFix > 0} onClick={() => act.run("documents-complete")}>مدارک کامل است</Button>
            </div>
          )}
          <Tabs<Tab> tabs={[["summary", "خلاصه"], ["documents", "مدارک"], ["form", "فرم اطلاعات"], ["financials", "ارقام مالی"], ["visit", "بازدید"], ["scoring", "محاسبه و تأیید حد"]]} value={tab} onChange={setTab} />
          {tab === "summary" && <Summary c={c} />}
          {tab === "documents" && <Documents c={c} reload={q.reload} canReview={analyst && c.state === "document_review"} canOriginal={has("technical_expert", "analyst")} />}
          {tab === "form" && <Sections c={c} reload={q.reload} canReview={analyst && c.state === "document_review"} />}
          {tab === "financials" && <Financials c={c} reload={q.reload} canEdit={analyst} />}
          {tab === "visit" && <VisitPanel c={c} reload={q.reload} canPropose={analyst && ["documents_complete", "document_review", "scoring"].includes(c.state)} canReport={has("technical_expert", "analyst")} />}
          {tab === "scoring" && me && <Scoring c={c} reload={q.reload} meId={me.id} isAnalyst={analyst} isFundManager={has("fund_manager")} />}
        </>)}
      </div>
    </Shell>
  );
}
