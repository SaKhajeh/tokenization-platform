/** Shapes of the credit-case API responses used by the app (see apps/api/src/cases). */
export interface CaseFile { id: string; document_id: string; version: number; filename: string; mime: string; size: string; link_url: string | null; uploaded_at: string }
export interface Review { decision: "accept" | "needs_fix" | "reject"; reason_code: string | null; message: string | null; at: string }
export interface Comment { id: string; type: string; body: string; author_side?: string; created_at: string }
export interface CaseItem {
  id: string; code: string; title: string; slot_key: string; label: string; kind: "checklist" | "adhoc"; required: "yes" | "if_available"; multi: boolean;
  state: string; from_kyb: boolean; guidance: string | null; original_required: boolean; with_link: boolean; files: CaseFile[]; review: Review | null; comments: Comment[];
}
export interface CaseSection { section: string; title: string; state: string; data: Record<string, any>; prefill: Record<string, any>; changed_from_registration: string[]; problems: string[]; review: Review | null; comments: Comment[] }
export interface CaseFinancial { fiscal_year: number; statement_type: string | null; declared: Record<string, string> | null; totals: Record<string, number> | null; problems: string[] }
export interface Blocker { code: string; [k: string]: any }
export interface Case {
  id: string; case_no: string; org_id: string; state: string; latest_fiscal_year: number; kyb_update_needed: boolean; submissions: number;
  submitted_at: string | null; documents_complete_at: string | null; financials_locked_at: string | null;
  letter: { text: string | null; rendered: string | null; signed_at: string | null };
  commitment: { signed_at: string | null };
  sections: CaseSection[]; items: CaseItem[]; financials: CaseFinancial[]; blockers: Blocker[];
}
export interface Limit { case_state: string; limit: null | { id: string; limit: string; valid_from: string; valid_to: string; used: string; available: string; collateral?: string; adjusted?: boolean; ceilings: { guarantee: Record<string, string>; facility: Record<string, string> } }; note: string | null }

export const EDITABLE = ["opened", "in_preparation", "returned", "under_review"];
export const RETURNED_ITEM = ["needs_fix", "rejected", "requested"];

/** Farsi for the submission blockers the API reports (CasesService.blockers). */
export function blockerText(b: Blocker, sectionTitle: (s: string) => string = (s) => s): string {
  switch (b.code) {
    case "kyb_not_approved": return "احراز هویت سازمان هنوز تأیید نشده است.";
    case "letter_missing": return "درخواست‌نامه نوشته نشده است.";
    case "letter_not_signed": return "درخواست‌نامه هنوز امضا (تأیید با رمز یکبارمصرف) نشده است.";
    case "assessment_fee_unpaid": return "کارمزد ارزیابی پرداخت نشده است.";
    case "section_not_saved": return `بخش «${sectionTitle(b.section)}» هنوز ذخیره نشده است.`;
    case "section_incomplete": return `بخش «${sectionTitle(b.section)}» کامل نیست.`;
    case "section_not_fixed": return `بخش «${sectionTitle(b.section)}» باید اصلاح شود.`;
    case "financials_incomplete": return `ارقام سال ${b.fiscal_year} (صورت مالی، یا تراز آزمایشی برای سال جاری) کامل یا تراز نیست.`;
    case "document_missing": return `مدرک «${b.item} — ${b.slot}» بارگذاری نشده است.`;
    case "document_or_not_available": return `مدرک اختیاری «${b.item} — ${b.slot}»: فایل را بارگذاری کنید یا «ندارم» را بزنید.`;
    case "item_not_fixed": return `مدرک «${b.item} — ${b.slot}» باید اصلاح شود.`;
    default: return b.code;
  }
}
