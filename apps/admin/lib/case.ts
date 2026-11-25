/** Staff view of a credit case (GET admin/cases/:id). */
export interface CaseFile { id: string; document_id: string; version: number; filename: string; mime: string; size: string; link_url: string | null; uploaded_at: string; removed_at: string | null }
export interface Review { decision: string; reason_code: string | null; message: string | null; at: string }
export interface Item { id: string; code: string; title: string; slot_key: string; label: string; kind: string; required: string; multi: boolean; state: string; from_kyb: boolean; guidance: string | null; original_required: boolean; original_received_at?: string | null; with_link: boolean; files: CaseFile[]; review: Review | null; comments: any[] }
export interface Section { section: string; title: string; state: string; data: Record<string, any>; problems: string[]; review: Review | null; comments: any[]; changed_from_registration: string[] }
export interface Fin { fiscal_year: number; statement_type: string | null; declared: Record<string, string> | null; verified: Record<string, string> | null; totals: Record<string, number> | null; verified_totals: Record<string, number> | null; adjustments: { field: string; declared: string; verified: string; reason: string; by_user?: string; at: string }[]; problems: string[] }
export interface StaffCase {
  id: string; case_no: string; org_id: string; state: string; latest_fiscal_year: number; submissions: number; submitted_at: string | null; documents_complete_at: string | null; financials_locked_at: string | null;
  assigned_analyst: string | null; letter: { text: string | null; rendered: string | null; signed_at: string | null }; commitment: { signed_at: string | null };
  sections: Section[]; items: Item[]; financials: Fin[]; blockers: any[];
  events: { from_state: string | null; to_state: string; actor_id: string; note: string | null; at: string }[];
  reviews: any[]; access_history: { user_id?: string; action: string; file_id?: string; at: string; [k: string]: any }[];
}
export interface CaseRow { id: string; case_no: string; state: string; org_id: string; org_name: string; national_id: string; assigned_analyst: string | null; items: number; accepted: number; submitted_at: string | null; last_activity_at: string; kyb_update_needed: boolean }
