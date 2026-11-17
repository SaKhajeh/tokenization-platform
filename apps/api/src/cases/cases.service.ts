/**
 * Credit case (پرونده اعتباری) — plan/07-case-file-and-credit-scoring.md §2–§6.
 *
 * One case per organisation, opened automatically when an org that wants financing submits KYB (or asks for
 * financing later). Pre-filled from registration (§2a); the applicant completes the 9-section form, the free-text
 * request letter (signed with step-up), the 3-year financial summary and the document slots, then submits with the
 * CEO's commitment. The analyst reviews every item and section (accept / needs fix / reject), may request extra
 * documents, returns the case, and finally marks the documents complete and verifies the figures cell by cell.
 *
 * Not here yet (later parts): comment threads and tickets (part 3); site visit, assessment fee at submission,
 * scoring rounds, fund-manager approval and the credit limit (part 4).
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  CASE, CASE_EDITABLE, CASE_ITEM, CaseState, checklistItem, casePeople, expectedSlots, FINANCIAL_FIELDS, FORM_SECTIONS, FORM_SECTION_TITLES,
  FormSection, ITEM_RETURNED, ItemState, jalaliYearOf, reconcileSlots, sectionProblems, statement, toFinancialYear, transition, yearProblems,
  figureProblems, bankTotals, StatementType,
} from "@tp/domain";
import { DB, Db, Queryable } from "../db/db.js";
import { AuditService } from "../audit/audit.service.js";
import { ApiError, Errors } from "../common/errors.js";
import { actor, AppRequest } from "../common/context.js";
import { uuidv7 } from "../common/ids.js";
import { closeWorkflowTasks, staffTask } from "../common/workflow.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { tehranToday } from "../applications/applications.service.js";

const err = {
  noCase: () => new ApiError(404, "NO_CASE", "This organisation has no credit case; choose financing first", "این سازمان پرونده‌ی اعتباری ندارد؛ ابتدا درخواست تأمین مالی را انتخاب کنید."),
  locked: (state: string) => new ApiError(409, "CASE_LOCKED", `The case cannot be changed in state ${state}`, "در این مرحله امکان تغییر پرونده نیست.", { state }),
  itemLocked: (state: string) => new ApiError(409, "ITEM_LOCKED", `This item cannot be changed (${state})`, "این مدرک در این مرحله قابل تغییر نیست.", { state }),
  sectionLocked: () => new ApiError(409, "SECTION_LOCKED", "Only sections sent back to you can be changed now", "اکنون فقط بخش‌هایی که برگشت داده شده قابل ویرایش است."),
  fixed: (field: string) => new ApiError(422, "FIELD_FIXED", `${field} cannot be changed in the case`, "شناسه‌ی ملی در پرونده قابل تغییر نیست؛ برای تغییر آن باید سازمان جدید ثبت شود.", { field }),
  notReady: (blockers: unknown[]) => new ApiError(409, "CASE_NOT_READY", "The case is not ready to submit", "پرونده هنوز آماده‌ی ارسال نیست.", { blockers }),
  doc: () => new ApiError(422, "BAD_DOCUMENT", "Document not found or not uploaded by this organisation", "سند یافت نشد یا بارگذاری آن کامل نشده است."),
  notOptional: () => new ApiError(422, "ITEM_REQUIRED", "This document is required; «not available» is only for optional items", "این مدرک الزامی است؛ گزینه‌ی «ندارم» فقط برای مدارک اختیاری است."),
  linkRequired: () => new ApiError(422, "LINK_REQUIRED", "Paste the report's SMS link too", "پیوند پیامکی گزارش را هم وارد کنید."),
  year: () => new ApiError(422, "FISCAL_YEAR_OUT_OF_RANGE", "Only the three latest fiscal years are entered", "فقط سه سال مالی آخر وارد می‌شود."),
  figures: (fields: string[]) => new ApiError(422, "INVALID_FIGURES", "Figures must be whole million rials", "ارقام باید عدد صحیح به میلیون ریال باشد.", { fields }),
  review: (why: string) => new ApiError(409, "REVIEW_NOT_ALLOWED", why, "این بررسی در وضعیت فعلی ممکن نیست."),
  incomplete: (open: unknown[]) => new ApiError(409, "CASE_REVIEW_INCOMPLETE", "Some items are not reviewed or not accepted", "هنوز بعضی مدارک بررسی یا تأیید نشده‌اند.", { open }),
  nothingToReturn: () => new ApiError(409, "NOTHING_TO_RETURN", "No item is marked for fixing", "هیچ موردی برای اصلاح علامت نخورده است."),
  finLocked: () => new ApiError(409, "FINANCIALS_LOCKED", "The verified figures are locked", "ارقام تأییدشده قفل شده است."),
  notBalanced: (years: unknown) => new ApiError(409, "FINANCIALS_NOT_BALANCED", "Verified figures do not balance", "ارقام تأییدشده تراز نیست.", { years }),
  letter: () => new ApiError(409, "LETTER_EMPTY", "Write the request letter first", "ابتدا متن درخواست را بنویسید."),
};

const KEY_IDENTITY = ["legal_name", "legal_form"] as const;
const editable = (s: CaseState) => (CASE_EDITABLE as readonly string[]).includes(s);
const yearsOf = (y0: number) => [y0, y0 - 1, y0 - 2];

@Injectable()
export class CasesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ================================================================== opening and pre-fill (§2a)

  /** Opens the org's case if it wants financing and has submitted KYB. Idempotent. Runs inside the caller's transaction. */
  async openIfEligible(q: Queryable, orgId: string, actorId: string | null) {
    const org = (await q.query(`select * from orgs where id = $1`, [orgId])).rows[0];
    if (!org?.wants_financing || org.kyb_status === "not_started") return null;
    const existing = (await q.query(`select id from cases where org_id = $1`, [orgId])).rows[0];
    if (existing) return existing.id as string;

    const kyb = (await q.query(`select * from kyb_cases where org_id = $1 order by version desc limit 1`, [orgId])).rows[0];
    const snap = kyb ? (await q.query(`select data from legal_identity_snapshots where id = $1`, [kyb.snapshot_id])).rows[0]?.data : null;
    const rep = actorId ? (await q.query(`select full_name, mobile from users where id = $1`, [actorId])).rows[0] : null;
    const banks = (await q.query(`select id, bank_name, iban from bank_accounts where org_id = $1 and status = 'verified' order by created_at`, [orgId])).rows;
    const f = kyb?.fields ?? {};
    const people = (snap?.people ?? []) as { nationalCode: string | null; name: string; position: string | null; roles: string[] }[];
    const ceo = people.find((p) => p.roles.includes("ceo"));

    const prefill: Partial<Record<FormSection, Record<string, unknown>>> = {
      general: strip({
        legal_name: org.legal_name, legal_form: org.legal_form ?? snap?.companyType, national_id: org.national_id,
        registration_no: org.registration_no ?? snap?.registerNumber, establishment_date: snap?.establishmentDate, activity_subject: f.activity ?? snap?.activity,
        landline: f.phone, website: f.website, company_email: f.contact_email,
        representative: rep ? strip({ name: rep.full_name, mobile: rep.mobile }) : undefined, ceo: ceo ? { name: ceo.name } : undefined,
      }),
      locations: f.address ? { rows: [strip({ id: "L1", usage: "head_office", address: f.address, postcode: f.postal_code })] } : {},
      board: strip({
        gazette_date: snap?.lastChangeDate,
        people: people.filter((p) => p.nationalCode).map((p) => ({
          national_id: p.nationalCode, name: p.name, kind: "person", roles: p.roles.filter((r) => r === "ceo" || r === "board"), signing_right: p.roles.includes("ceo"),
        })),
      }),
      banks_facilities: banks.length ? { banks: banks.map((b: any) => strip({ id: b.id, name: b.bank_name, account_no: b.iban })) } : {},
    };

    const id = uuidv7();
    const n = Number((await q.query(`select nextval('case_no_seq') as n`)).rows[0].n);
    const y = jalaliYearOf(tehranToday());
    await q.query(`insert into cases (id, org_id, case_no, state, latest_fiscal_year) values ($1,$2,$3,'opened',$4)`, [id, orgId, `CR-${y}-${String(n).padStart(5, "0")}`, y - 1]);
    await q.query(`insert into case_events (id, case_id, from_state, to_state, actor_id, note) values ($1,$2,null,'opened',$3,'opened automatically')`, [uuidv7(), id, actorId]);
    for (const s of FORM_SECTIONS) {
      const p = prefill[s] ?? {};
      await q.query(`insert into case_sections (case_id, section, data, prefill) values ($1,$2,$3,$3)`, [id, s, JSON.stringify(p)]);
    }
    await this.syncSlots(q, id, actorId);
    // D-C9: articles and the latest gazette come from registration
    for (const [code, docId] of [["2-1", kyb?.articles_doc_id], ["2-2", kyb?.gazette_doc_id]] as const) {
      if (!docId) continue;
      const item = (await q.query(`select * from case_items where case_id = $1 and code = $2 and slot_key = 'company'`, [id, code])).rows[0];
      await q.query(`insert into case_item_files (id, item_id, document_id, version, uploaded_by) values ($1,$2,$3,1,$4)`, [uuidv7(), item.id, docId, kyb.submitted_by]);
      await q.query(`update case_items set from_kyb = true where id = $1`, [item.id]);
      await this.moveItem(q, "case_items", item, "uploaded");
      if (org.kyb_status === "approved") await this.acceptFromKyb(q, item);
    }
    await this.notifications.notify(q, { to: { orgId }, event: "case.opened", params: { no: `CR-${y}-${String(n).padStart(5, "0")}` } });
    await this.audit.append(q, { actorType: actorId ? "user" : "system", actorUserId: actorId, orgId, action: "case.opened", entityType: "case", entityId: id });
    return id;
  }

  /** Registration documents become accepted case items when KYB is approved (D-C9). */
  async onKybApproved(q: Queryable, orgId: string) {
    const rows = (await q.query(
      `select i.* from case_items i join cases c on c.id = i.case_id where c.org_id = $1 and i.from_kyb and i.state = 'uploaded' for update of i`,
      [orgId],
    )).rows;
    for (const i of rows) await this.acceptFromKyb(q, i);
  }

  /** Compliance already reviewed these at KYB, so they enter the case accepted. */
  private async acceptFromKyb(q: Queryable, item: any) {
    await this.moveItem(q, "case_items", item, "in_review");
    await this.moveItem(q, "case_items", item, "accepted");
  }

  /** A-05b: what the organisation will do here. Choosing financing opens the case once KYB is submitted. */
  async setPurposes(req: AppRequest, input: { invest: boolean; financing: boolean }) {
    return this.db.tx(async (q) => {
      const before = (await q.query(`select is_investor, wants_financing from orgs where id = $1 for update`, [req.org!.id])).rows[0];
      await q.query(`update orgs set is_investor = $2, wants_financing = $3, updated_at = now() where id = $1`, [req.org!.id, input.invest, input.financing]);
      await this.audit.append(q, { ...actor(req), orgId: req.org!.id, action: "org.purposes_set", entityType: "org", entityId: req.org!.id, before, after: input });
      const caseId = input.financing ? await this.openIfEligible(q, req.org!.id, req.user!.id) : null;
      return { invest: input.invest, financing: input.financing, case_id: caseId };
    });
  }

  // ================================================================== loading and views

  private async caseOf(q: Queryable, orgId: string, lock = false) {
    const c = (await q.query(`select * from cases where org_id = $1 ${lock ? "for update" : ""}`, [orgId])).rows[0];
    if (!c) throw err.noCase();
    return c;
  }

  private async caseById(q: Queryable, id: string, lock = false) {
    const c = (await q.query(`select * from cases where id = $1 ${lock ? "for update" : ""}`, [id])).rows[0];
    if (!c) throw Errors.notFound("Case");
    return c;
  }

  private async move(q: Queryable, c: any, to: CaseState, actorId: string | null, note?: string) {
    transition("case", CASE, c.state as CaseState, to);
    await q.query(`update cases set state = $2, updated_at = now(), last_activity_at = now() where id = $1`, [c.id, to]);
    await q.query(`insert into case_events (id, case_id, from_state, to_state, actor_id, note) values ($1,$2,$3,$4,$5,$6)`, [uuidv7(), c.id, c.state, to, actorId, note ?? null]);
    c.state = to;
  }

  private async moveItem(q: Queryable, table: "case_items" | "case_sections", row: any, to: ItemState) {
    if (row.state === to) return;
    transition("case_item", CASE_ITEM, row.state as ItemState, to);
    if (table === "case_items") await q.query(`update case_items set state = $2, updated_at = now() where id = $1`, [row.id, to]);
    else await q.query(`update case_sections set state = $3, updated_at = now() where case_id = $1 and section = $2`, [row.case_id, row.section, to]);
    row.state = to;
  }

  /** First applicant edit moves opened → in_preparation. */
  private async touch(q: Queryable, c: any, actorId: string) {
    if (c.state === "opened") await this.move(q, c, "in_preparation", actorId);
    else await q.query(`update cases set last_activity_at = now(), updated_at = now() where id = $1`, [c.id]);
  }

  private assertEditable(c: any) {
    if (!editable(c.state)) throw err.locked(c.state);
  }

  /** Recomputes the document slots from the form (people, locations, banks) and the fiscal year (§3.2). */
  private async syncSlots(q: Queryable, caseId: string, actorId: string | null) {
    const c = (await q.query(`select latest_fiscal_year from cases where id = $1`, [caseId])).rows[0];
    const secs = await this.sections(q, caseId);
    const expected = expectedSlots({
      people: casePeople(secs.board?.data),
      latestFiscalYear: c.latest_fiscal_year,
      locations: ((secs.locations?.data?.rows ?? []) as any[]).filter((r) => r.id),
      banks: ((secs.banks_facilities?.data?.banks ?? []) as any[]).filter((b) => b.id),
    });
    const items = (await q.query(`select * from case_items where case_id = $1`, [caseId])).rows;
    const r = reconcileSlots(items.map((i: any) => ({ id: i.id, code: i.code, slotKey: i.slot_key, kind: i.kind, state: i.state, label: i.label })), expected);
    for (const s of r.add) {
      await q.query(
        `insert into case_items (id, case_id, code, slot_key, label, kind, required, multi, state) values ($1,$2,$3,$4,$5,'checklist',$6,$7,'empty')`,
        [uuidv7(), caseId, s.code, s.slotKey, s.label, s.required, s.multi],
      );
    }
    for (const d of r.drop) {
      const row = items.find((i: any) => i.id === d.id);
      if (row.state === "in_review") continue; // only reachable while staff review; slots change only in editable states
      await this.moveItem(q, "case_items", row, "not_required");
    }
    for (const v of r.revive) {
      const row = items.find((i: any) => i.id === v.id);
      const files = (await q.query(`select count(*)::int as n from case_item_files where item_id = $1 and removed_at is null`, [row.id])).rows[0].n;
      await this.moveItem(q, "case_items", row, files ? "uploaded" : "empty");
    }
    for (const l of r.relabel) await q.query(`update case_items set label = $2 where id = $1`, [l.id, l.label]);
    if (r.add.length || r.drop.length || r.revive.length) {
      await this.audit.append(q, {
        actorType: actorId ? "user" : "system", actorUserId: actorId, action: "case.slots_changed", entityType: "case", entityId: caseId,
        after: { added: r.add.map((a) => `${a.code}/${a.slotKey}`), dropped: r.drop.map((d) => `${d.code}/${d.slotKey}`), revived: r.revive.map((v) => `${v.code}/${v.slotKey}`) },
      });
    }
  }

  private async sections(q: Queryable, caseId: string) {
    const rows = (await q.query(`select * from case_sections where case_id = $1`, [caseId])).rows;
    return Object.fromEntries(rows.map((r: any) => [r.section, r])) as Record<FormSection, any>;
  }

  /** What still blocks submission (first submission or resubmission). */
  private async blockers(q: Queryable, c: any) {
    const out: { code: string; [k: string]: unknown }[] = [];
    const org = (await q.query(`select kyb_status from orgs where id = $1`, [c.org_id])).rows[0];
    if (org.kyb_status !== "approved") out.push({ code: "kyb_not_approved", kyb_status: org.kyb_status });
    const secs = await this.sections(q, c.id);
    const all = Object.fromEntries(Object.entries(secs).map(([k, v]) => [k, v.data]));
    const items = (await q.query(`select * from case_items where case_id = $1 and state <> 'not_required' order by code, slot_key`, [c.id])).rows;
    if (c.state === "returned") {
      for (const s of FORM_SECTIONS) if (ITEM_RETURNED.includes(secs[s].state)) out.push({ code: "section_not_fixed", section: s });
      for (const i of items) if (ITEM_RETURNED.includes(i.state) || i.state === "empty") out.push({ code: "item_not_fixed", item_id: i.id, item: i.code, slot: i.label });
      return out;
    }
    if (!c.letter_signed_at) out.push({ code: c.request_letter ? "letter_not_signed" : "letter_missing" });
    for (const s of FORM_SECTIONS) {
      const p = sectionProblems(s, secs[s].data, all);
      if (secs[s].state === "empty") out.push({ code: "section_not_saved", section: s });
      else if (p.length) out.push({ code: "section_incomplete", section: s, fields: p });
    }
    const fin = (await q.query(`select * from case_financials where case_id = $1`, [c.id])).rows;
    for (const y of yearsOf(c.latest_fiscal_year)) {
      const row = fin.find((r: any) => r.fiscal_year === y);
      const p = row ? yearProblems(row.declared) : ["missing"];
      if (!row?.statement_type) p.push("statement_type");
      if (p.length) out.push({ code: "financials_incomplete", fiscal_year: y, problems: p });
    }
    for (const i of items) {
      if (i.state === "empty" || i.state === "requested") out.push({ code: i.required === "yes" ? "document_missing" : "document_or_not_available", item_id: i.id, item: i.code, slot: i.label });
    }
    return out;
  }

  private async view(q: Queryable, c: any, staff: boolean) {
    const secs = await this.sections(q, c.id);
    const all = Object.fromEntries(Object.entries(secs).map(([k, v]) => [k, v.data]));
    const items = (await q.query(`select * from case_items where case_id = $1 order by code, created_at`, [c.id])).rows;
    const files = (await q.query(
      `select f.*, d.filename, d.mime, d.size_bytes, d.sha256 from case_item_files f join documents d on d.id = f.document_id
       where f.item_id = any($1) ${staff ? "" : "and f.removed_at is null"} order by f.version`,
      [items.map((i: any) => i.id)],
    )).rows;
    const reviews = (await q.query(`select * from case_reviews where case_id = $1 order by at`, [c.id])).rows;
    const lastReview = (type: string, id: string) => {
      const r = reviews.filter((x: any) => x.target_type === type && x.target_id === id).pop();
      return r ? { decision: r.decision, reason_code: r.reason_code, message: r.message, at: r.at, ...(staff ? { reviewer_id: r.reviewer_id, file_versions: r.file_versions } : {}) } : null;
    };
    const fin = (await q.query(`select * from case_financials where case_id = $1 order by fiscal_year desc`, [c.id])).rows;
    const adjustments = staff ? (await q.query(`select * from financial_adjustments where case_id = $1 order by at`, [c.id])).rows : [];
    return {
      id: c.id, case_no: c.case_no, org_id: c.org_id, state: c.state, latest_fiscal_year: c.latest_fiscal_year,
      kyb_update_needed: c.kyb_update_needed, submissions: c.submissions, submitted_at: c.submitted_at,
      documents_complete_at: c.documents_complete_at, financials_locked_at: c.financials_locked_at,
      ...(staff ? { assigned_analyst: c.assigned_analyst } : {}),
      letter: { text: c.request_letter, rendered: c.letter_rendered, signed_at: c.letter_signed_at, signed_by: c.letter_signed_by },
      commitment: { signed_at: c.commitment_signed_at, signed_by: c.commitment_signed_by },
      sections: FORM_SECTIONS.map((s) => {
        const r = secs[s];
        return {
          section: s, title: FORM_SECTION_TITLES[s], state: r.state, data: r.data, prefill: r.prefill,
          changed_from_registration: changedKeys(r.prefill, r.data), problems: sectionProblems(s, r.data, all),
          review: lastReview("section", s), ...(s === "banks_facilities" ? { totals: bankTotals(r.data) } : {}),
        };
      }),
      items: items.filter((i: any) => staff || i.state !== "not_required").map((i: any) => {
        const meta = checklistItem(i.code);
        return {
          id: i.id, code: i.code, title: meta?.title ?? i.request_title, slot_key: i.slot_key, label: i.label, kind: i.kind, required: i.required,
          multi: i.multi, state: i.state, from_kyb: i.from_kyb, guidance: meta?.guidance ?? i.request_message, original_required: !!meta?.originalRequired,
          with_link: !!meta?.withLink,
          files: files.filter((f: any) => f.item_id === i.id).map((f: any) => ({
            id: f.id, document_id: f.document_id, version: f.version, filename: f.filename, mime: f.mime, size: String(f.size_bytes), sha256: f.sha256,
            link_url: f.link_url, uploaded_at: f.uploaded_at, ...(staff ? { uploaded_by: f.uploaded_by, removed_at: f.removed_at } : {}),
          })),
          review: lastReview("item", i.id),
        };
      }),
      financials: yearsOf(c.latest_fiscal_year).map((y) => {
        const r = fin.find((x: any) => x.fiscal_year === y);
        const declared = r?.declared ?? {};
        const totals = figureProblems(declared).length ? null : statementTotals(declared);
        return {
          fiscal_year: y, statement_type: r?.statement_type ?? null, declared, totals, problems: r ? yearProblems(declared) : ["missing"],
          ...(staff ? { verified: r?.verified ?? null, verified_totals: r?.verified && !figureProblems(r.verified).length ? statementTotals(r.verified) : null, adjustments: adjustments.filter((a: any) => a.fiscal_year === y) } : {}),
        };
      }),
      blockers: editable(c.state) ? await this.blockers(q, c) : [],
    };
  }

  // ================================================================== applicant

  async mine(req: AppRequest) {
    return this.view(this.db, await this.caseOf(this.db, req.org!.id), false);
  }

  async saveSection(req: AppRequest, section: FormSection, data: Record<string, any>) {
    return this.db.tx(async (q) => {
      const c = await this.caseOf(q, req.org!.id, true);
      this.assertEditable(c);
      const s = (await q.query(`select * from case_sections where case_id = $1 and section = $2 for update`, [c.id, section])).rows[0];
      if (c.state === "returned" && !ITEM_RETURNED.includes(s.state)) throw err.sectionLocked();
      if (s.state === "accepted" || s.state === "in_review") throw err.sectionLocked();
      if (section === "general" && s.prefill.national_id && data.national_id !== s.prefill.national_id) throw err.fixed("national_id");
      // stable ids for repeatable rows that drive slots
      if (section === "locations") data.rows = (data.rows ?? []).map((r: any) => ({ ...r, id: r.id || `L${uuidv7().slice(-6)}` }));
      if (section === "banks_facilities") data.banks = (data.banks ?? []).map((b: any) => ({ ...b, id: b.id || `B${uuidv7().slice(-6)}` }));
      await q.query(`update case_sections set data = $3, updated_by = $4, updated_at = now() where case_id = $1 and section = $2`, [c.id, section, JSON.stringify(data), req.user!.id]);
      await this.moveItem(q, "case_sections", s, "uploaded");
      // §2a: changing key identity data asks for re-KYB
      const keyChanged = (section === "general" && KEY_IDENTITY.some((k) => s.prefill[k] !== undefined && data[k] !== s.prefill[k])) ||
        (section === "board" && signatories(s.prefill) !== signatories(data) && signatories(s.prefill) !== "");
      if (keyChanged && !c.kyb_update_needed) {
        await q.query(`update cases set kyb_update_needed = true where id = $1`, [c.id]);
        c.kyb_update_needed = true;
        await this.notifications.notify(q, { to: { orgId: c.org_id, orgRoles: ["org_admin"] }, event: "case.kyb_update_needed", params: { no: c.case_no } });
      }
      await this.touch(q, c, req.user!.id);
      if (["board", "locations", "banks_facilities"].includes(section)) await this.syncSlots(q, c.id, req.user!.id);
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: "case.section_saved", entityType: "case", entityId: c.id, after: { section, key_identity_changed: keyChanged } });
      return this.view(q, c, false);
    });
  }

  async setFiscalYear(req: AppRequest, year: number) {
    return this.db.tx(async (q) => {
      const c = await this.caseOf(q, req.org!.id, true);
      if (!["opened", "in_preparation"].includes(c.state)) throw err.locked(c.state);
      const current = jalaliYearOf(tehranToday());
      if (year > current || year < current - 3) throw err.year();
      await q.query(`update cases set latest_fiscal_year = $2 where id = $1`, [c.id, year]);
      await q.query(`delete from case_financials where case_id = $1 and fiscal_year not in ($2, $3, $4)`, [c.id, year, year - 1, year - 2]);
      await this.touch(q, c, req.user!.id);
      await this.syncSlots(q, c.id, req.user!.id);
      return this.view(q, (await this.caseById(q, c.id)), false);
    });
  }

  async saveFinancials(req: AppRequest, year: number, input: { statement_type: StatementType; figures: Record<string, string> }) {
    return this.db.tx(async (q) => {
      const c = await this.caseOf(q, req.org!.id, true);
      if (!["opened", "in_preparation", "under_review"].includes(c.state)) throw err.locked(c.state);
      if (!yearsOf(c.latest_fiscal_year).includes(year)) throw err.year();
      const bad = Object.entries(input.figures).filter(([k, v]) => !(FINANCIAL_FIELDS as readonly string[]).includes(k) || !/^-?(0|[1-9]\d{0,14})$/.test(v)).map(([k]) => k);
      if (bad.length) throw err.figures(bad);
      await q.query(
        `insert into case_financials (case_id, fiscal_year, statement_type, declared, updated_by) values ($1,$2,$3,$4,$5)
         on conflict (case_id, fiscal_year) do update set statement_type = excluded.statement_type, declared = excluded.declared, updated_by = excluded.updated_by, updated_at = now()`,
        [c.id, year, input.statement_type, JSON.stringify(input.figures), req.user!.id],
      );
      await this.touch(q, c, req.user!.id);
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: "case.financials_saved", entityType: "case", entityId: c.id, after: { fiscal_year: year } });
      return { fiscal_year: year, problems: yearProblems(input.figures), totals: figureProblems(input.figures).length ? null : statementTotals(input.figures) };
    });
  }

  async saveLetter(req: AppRequest, text: string) {
    return this.db.tx(async (q) => {
      const c = await this.caseOf(q, req.org!.id, true);
      if (!["opened", "in_preparation", "under_review"].includes(c.state)) throw err.locked(c.state);
      // editing a signed letter withdraws the signature
      await q.query(`update cases set request_letter = $2, letter_rendered = null, letter_signed_by = null, letter_signed_at = null where id = $1`, [c.id, text]);
      await this.touch(q, c, req.user!.id);
      return { text, signed_at: null };
    });
  }

  async signLetter(req: AppRequest) {
    return this.db.tx(async (q) => {
      const c = await this.caseOf(q, req.org!.id, true);
      if (!["opened", "in_preparation", "under_review"].includes(c.state)) throw err.locked(c.state);
      if (!c.request_letter?.trim()) throw err.letter();
      const org = (await q.query(`select legal_name, national_id from orgs where id = $1`, [c.org_id])).rows[0];
      const signer = (await q.query(`select full_name from users where id = $1`, [req.user!.id])).rows[0];
      const rendered = [
        "به: صندوق پژوهش و فناوری",
        `از: ${org.legal_name} — شناسه‌ی ملی ${org.national_id}`,
        `موضوع: درخواست خدمات صندوق (پرونده‌ی ${c.case_no})`,
        "",
        c.request_letter.trim(),
        "",
        `امضا: ${signer?.full_name ?? "—"} — ${tehranToday()} (تأیید با رمز یک‌بارمصرف)`,
      ].join("\n");
      await q.query(`update cases set letter_rendered = $2, letter_signed_by = $3, letter_signed_at = now() where id = $1`, [c.id, rendered, req.user!.id]);
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: "case.letter_signed", entityType: "case", entityId: c.id });
      return { rendered, signed_at: new Date().toISOString() };
    });
  }

  private async itemFor(q: Queryable, caseId: string, itemId: string) {
    const i = (await q.query(`select * from case_items where id = $1 and case_id = $2 for update`, [itemId, caseId])).rows[0];
    if (!i) throw Errors.notFound("Case item");
    return i;
  }

  private assertItemEditable(c: any, i: any) {
    this.assertEditable(c);
    if (i.state === "not_required" || i.state === "in_review" || i.state === "accepted") throw err.itemLocked(i.state);
  }

  async addFile(req: AppRequest, itemId: string, input: { document_id: string; link_url?: string | null }) {
    return this.db.tx(async (q) => {
      const c = await this.caseOf(q, req.org!.id, true);
      const i = await this.itemFor(q, c.id, itemId);
      this.assertItemEditable(c, i);
      const doc = (await q.query(`select id from documents where id = $1 and org_id = $2 and status = 'uploaded'`, [input.document_id, c.org_id])).rows[0];
      if (!doc) throw err.doc();
      if (checklistItem(i.code)?.withLink && !input.link_url) throw err.linkRequired();
      if (!i.multi) await q.query(`update case_item_files set removed_at = now(), removed_by = $2 where item_id = $1 and removed_at is null`, [i.id, req.user!.id]);
      const v = Number((await q.query(`select coalesce(max(version), 0) + 1 as v from case_item_files where item_id = $1`, [i.id])).rows[0].v);
      const fid = uuidv7();
      await q.query(`insert into case_item_files (id, item_id, document_id, version, link_url, uploaded_by) values ($1,$2,$3,$4,$5,$6)`, [fid, i.id, doc.id, v, input.link_url ?? null, req.user!.id]);
      await this.moveItem(q, "case_items", i, "uploaded");
      await this.touch(q, c, req.user!.id);
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: "case.file_added", entityType: "case_item", entityId: i.id, after: { code: i.code, slot: i.slot_key, version: v, document_id: doc.id } });
      return { item_id: i.id, file_id: fid, version: v, state: i.state };
    });
  }

  async removeFile(req: AppRequest, itemId: string, fileId: string) {
    return this.db.tx(async (q) => {
      const c = await this.caseOf(q, req.org!.id, true);
      const i = await this.itemFor(q, c.id, itemId);
      this.assertItemEditable(c, i);
      const r = await q.query(`update case_item_files set removed_at = now(), removed_by = $3 where id = $1 and item_id = $2 and removed_at is null returning id`, [fileId, i.id, req.user!.id]);
      if (!r.rows[0]) throw Errors.notFound("File");
      const left = (await q.query(`select count(*)::int as n from case_item_files where item_id = $1 and removed_at is null`, [i.id])).rows[0].n;
      if (!left && i.state === "uploaded") await this.moveItem(q, "case_items", i, "empty");
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: "case.file_removed", entityType: "case_item", entityId: i.id, after: { file_id: fileId } });
      return { item_id: i.id, state: i.state };
    });
  }

  async notAvailable(req: AppRequest, itemId: string) {
    return this.db.tx(async (q) => {
      const c = await this.caseOf(q, req.org!.id, true);
      const i = await this.itemFor(q, c.id, itemId);
      this.assertItemEditable(c, i);
      if (i.required !== "if_available") throw err.notOptional();
      await q.query(`update case_item_files set removed_at = now(), removed_by = $2 where item_id = $1 and removed_at is null`, [i.id, req.user!.id]);
      await this.moveItem(q, "case_items", i, "not_available");
      await this.touch(q, c, req.user!.id);
      return { item_id: i.id, state: i.state };
    });
  }

  /** First submission and resubmission (approver / org admin, step-up). The step-up also signs the commitment. */
  async submit(req: AppRequest) {
    return this.db.tx(async (q) => {
      const c = await this.caseOf(q, req.org!.id, true);
      if (!["opened", "in_preparation", "returned"].includes(c.state)) throw err.locked(c.state);
      const blockers = await this.blockers(q, c);
      if (blockers.length) throw err.notReady(blockers);
      const resubmit = c.state === "returned";
      // everything the applicant prepared goes to review; accepted items stay accepted
      const items = (await q.query(`select * from case_items where case_id = $1 and state in ('uploaded','not_available')`, [c.id])).rows;
      for (const i of items) await this.moveItem(q, "case_items", i, "in_review");
      const secs = (await q.query(`select * from case_sections where case_id = $1 and state = 'uploaded'`, [c.id])).rows;
      for (const s of secs) await this.moveItem(q, "case_sections", s, "in_review");
      if (resubmit) {
        for (const i of items) await closeWorkflowTasks(q, "case_item", i.id, req.user!.id);
      }
      await q.query(
        `update cases set submissions = submissions + 1, submitted_at = now(), commitment_signed_by = $2, commitment_signed_at = now() where id = $1`,
        [c.id, req.user!.id],
      );
      await this.move(q, c, resubmit ? "resubmitted" : "submitted", req.user!.id);
      const org = (await q.query(`select legal_name from orgs where id = $1`, [c.org_id])).rows[0];
      await staffTask(q, {
        title: `${resubmit ? "بررسی اصلاحات" : "بررسی"} پرونده‌ی اعتباری ${c.case_no} — ${org.legal_name}`,
        linkedType: "case", linkedId: c.id, role: "analyst", key: "case.review", dueInHours: 72,
      });
      // TODO(part 4, D-C13): issue the assessment-fee invoice here from the fund's tariff.
      await this.notifications.notify(q, { to: { orgId: c.org_id }, event: "case.submitted", params: { no: c.case_no } });
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: resubmit ? "case.resubmitted" : "case.submitted", entityType: "case", entityId: c.id, after: { items: items.length, sections: secs.length } });
      return { id: c.id, state: c.state };
    });
  }

  async withdraw(req: AppRequest, reason: string) {
    return this.db.tx(async (q) => {
      const c = await this.caseOf(q, req.org!.id, true);
      await this.move(q, c, "withdrawn", req.user!.id, reason);
      await closeWorkflowTasks(q, "case", c.id, req.user!.id);
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: "case.withdrawn", entityType: "case", entityId: c.id, after: { reason } });
      return { id: c.id, state: c.state };
    });
  }

  // ================================================================== fund side (§6)

  async list(state?: string) {
    const r = await this.db.query(
      `select c.*, o.legal_name, o.national_id,
              (select count(*)::int from case_items i where i.case_id = c.id and i.state <> 'not_required') as items,
              (select count(*)::int from case_items i where i.case_id = c.id and i.state = 'accepted') as accepted
       from cases c join orgs o on o.id = c.org_id ${state ? "where c.state = $1" : ""} order by c.updated_at desc limit 500`,
      state ? [state] : [],
    );
    return r.rows.map((c: any) => ({
      id: c.id, case_no: c.case_no, state: c.state, org_id: c.org_id, org_name: c.legal_name, national_id: c.national_id, assigned_analyst: c.assigned_analyst,
      items: c.items, accepted: c.accepted, submitted_at: c.submitted_at, last_activity_at: c.last_activity_at, kyb_update_needed: c.kyb_update_needed,
    }));
  }

  async get(id: string) {
    const c = await this.caseById(this.db, id);
    const v = await this.view(this.db, c, true);
    const events = (await this.db.query(`select from_state, to_state, actor_id, note, at from case_events where case_id = $1 order by at`, [id])).rows;
    const reviews = (await this.db.query(`select * from case_reviews where case_id = $1 order by at`, [id])).rows;
    return { ...v, events, reviews };
  }

  async startReview(req: AppRequest, id: string) {
    return this.db.tx(async (q) => {
      const c = await this.caseById(q, id, true);
      await this.move(q, c, "document_review", req.user!.id);
      if (!c.assigned_analyst) await q.query(`update cases set assigned_analyst = $2 where id = $1`, [id, req.user!.id]);
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: "case.review_started", entityType: "case", entityId: id });
      return { id, state: c.state, assigned_analyst: c.assigned_analyst ?? req.user!.id };
    });
  }

  async review(req: AppRequest, id: string, target: { type: "item" | "section"; id: string }, input: { decision: "accept" | "needs_fix" | "reject"; reason_code?: string; message?: string }) {
    return this.db.tx(async (q) => {
      const c = await this.caseById(q, id, true);
      if (c.state !== "document_review") throw err.review(`case is ${c.state}`);
      if (input.decision !== "accept" && !input.message?.trim()) throw err.review("a message to the applicant is required for needs_fix and reject");
      if (input.decision !== "accept" && !input.reason_code) throw err.review("a reason is required for needs_fix and reject");
      const table = target.type === "item" ? "case_items" : "case_sections";
      const row = target.type === "item"
        ? await this.itemFor(q, id, target.id)
        : (await q.query(`select * from case_sections where case_id = $1 and section = $2 for update`, [id, target.id])).rows[0];
      if (!row) throw Errors.notFound("Section");
      const to: ItemState = input.decision === "accept" ? "accepted" : input.decision === "needs_fix" ? "needs_fix" : "rejected";
      // a decision can be changed until the case is returned: step back to in_review first
      if (row.state === to) {
        /* same decision again: record it, nothing to move */
      } else if (row.state === "in_review") {
        await this.moveItem(q, table, row, to);
      } else if (row.state === "needs_fix" || row.state === "rejected") {
        await this.moveItem(q, table, row, "in_review");
        await this.moveItem(q, table, row, to);
      } else if (row.state === "accepted" && to !== "accepted") {
        await this.moveItem(q, table, row, "needs_fix");
        if (to === "rejected") {
          await this.moveItem(q, table, row, "in_review");
          await this.moveItem(q, table, row, "rejected");
        }
      } else {
        throw err.review(`item is ${row.state}`);
      }
      const versions = target.type === "item"
        ? (await q.query(`select version from case_item_files where item_id = $1 and removed_at is null order by version`, [row.id])).rows.map((r: any) => r.version)
        : [];
      await q.query(
        `insert into case_reviews (id, case_id, target_type, target_id, decision, reason_code, message, file_versions, reviewer_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [uuidv7(), id, target.type, target.id, input.decision, input.reason_code ?? null, input.message?.trim() || null, versions, req.user!.id],
      );
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: "case.reviewed", entityType: target.type === "item" ? "case_item" : "case", entityId: target.type === "item" ? target.id : id, after: { ...input, target } });
      return { target, state: row.state };
    });
  }

  /** §3.4: any additional document, with a title and a message; the applicant uploads to it like any other item. */
  async requestDocument(req: AppRequest, id: string, input: { title: string; message: string }) {
    return this.db.tx(async (q) => {
      const c = await this.caseById(q, id, true);
      if (!["document_review", "documents_complete"].includes(c.state)) throw err.review(`case is ${c.state}`);
      const n = Number((await q.query(`select count(*)::int + 1 as n from case_items where case_id = $1 and kind = 'adhoc'`, [id])).rows[0].n);
      const itemId = uuidv7();
      await q.query(
        `insert into case_items (id, case_id, code, slot_key, label, kind, required, multi, state, request_title, request_message, requested_by)
         values ($1,$2,$3,'company',$4,'adhoc','yes',true,'requested',$4,$5,$6)`,
        [itemId, id, `X-${n}`, input.title, input.message, req.user!.id],
      );
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: "case.document_requested", entityType: "case_item", entityId: itemId, after: input });
      return { item_id: itemId, code: `X-${n}`, state: "requested" };
    });
  }

  /** §6.3: sends every needs-fix / rejected / requested item back together. */
  async returnCase(req: AppRequest, id: string) {
    return this.db.tx(async (q) => {
      const c = await this.caseById(q, id, true);
      if (!["document_review", "documents_complete"].includes(c.state)) throw err.review(`case is ${c.state}`);
      const items = (await q.query(`select * from case_items where case_id = $1 and state <> 'not_required'`, [id])).rows;
      const secs = (await q.query(`select * from case_sections where case_id = $1`, [id])).rows;
      const unreviewed = [...items.filter((i: any) => i.state === "in_review").map((i: any) => ({ item: i.code, slot: i.label })), ...secs.filter((s: any) => s.state === "in_review").map((s: any) => ({ section: s.section }))];
      if (unreviewed.length) throw err.incomplete(unreviewed);
      const back = items.filter((i: any) => ITEM_RETURNED.includes(i.state));
      const backSecs = secs.filter((s: any) => ITEM_RETURNED.includes(s.state));
      if (!back.length && !backSecs.length) throw err.nothingToReturn();
      if (c.state === "documents_complete") await q.query(`update cases set documents_complete_at = null where id = $1`, [id]);
      await this.move(q, c, "returned", req.user!.id);
      for (const i of back) {
        const title = `${checklistItem(i.code)?.title ?? i.request_title} — ${i.label}`;
        await q.query(
          `insert into tasks (id, org_id, title, description, linked_type, linked_id, assignee_role, priority, source, workflow_key)
           values ($1,$2,$3,$4,'case_item',$5,'preparer','p0','workflow','case.fix_item')`,
          [uuidv7(), c.org_id, `اصلاح مدرک: ${title}`, i.request_message ?? null, i.id],
        );
      }
      await closeWorkflowTasks(q, "case", id, req.user!.id);
      await this.notifications.notify(q, { to: { orgId: c.org_id }, event: "case.returned", params: { no: c.case_no, items: back.length + backSecs.length } });
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: "case.returned", entityType: "case", entityId: id, after: { items: back.map((i: any) => `${i.code}/${i.slot_key}`), sections: backSecs.map((s: any) => s.section) } });
      return { id, state: c.state, items: back.length, sections: backSecs.length };
    });
  }

  /** §6.5: every required item and every section accepted → documents complete; financial verification opens. */
  async documentsComplete(req: AppRequest, id: string) {
    return this.db.tx(async (q) => {
      const c = await this.caseById(q, id, true);
      if (c.state !== "document_review") throw err.review(`case is ${c.state}`);
      const items = (await q.query(`select * from case_items where case_id = $1 and state <> 'not_required'`, [id])).rows;
      const secs = (await q.query(`select * from case_sections where case_id = $1`, [id])).rows;
      const open = [
        ...items.filter((i: any) => i.state !== "accepted").map((i: any) => ({ item: i.code, slot: i.label, state: i.state })),
        ...secs.filter((s: any) => s.state !== "accepted").map((s: any) => ({ section: s.section, state: s.state })),
      ];
      if (open.length) throw err.incomplete(open);
      await this.move(q, c, "documents_complete", req.user!.id);
      await q.query(`update cases set documents_complete_at = now() where id = $1`, [id]);
      // the analyst verifies a copy of the declared figures
      await q.query(`update case_financials set verified = declared where case_id = $1 and verified is null`, [id]);
      await closeWorkflowTasks(q, "case", id, req.user!.id);
      await staffTask(q, { title: `تطبیق ارقام مالی پرونده ${c.case_no} با صورت‌های مالی`, linkedType: "case", linkedId: id, role: "analyst", key: "case.verify_financials", dueInHours: 72 });
      await this.notifications.notify(q, { to: { orgId: c.org_id }, event: "case.documents_complete", params: { no: c.case_no } });
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: "case.documents_complete", entityType: "case", entityId: id });
      return { id, state: c.state };
    });
  }

  /** §5: the analyst checks each cell against item 3-1 and may change it, always with a reason. */
  async verifyCell(req: AppRequest, id: string, year: number, field: string, input: { value: string; reason: string }) {
    return this.db.tx(async (q) => {
      const c = await this.caseById(q, id, true);
      if (c.state !== "documents_complete") throw err.review(`case is ${c.state}`);
      if (c.financials_locked_at) throw err.finLocked();
      if (!(FINANCIAL_FIELDS as readonly string[]).includes(field)) throw err.figures([field]);
      const row = (await q.query(`select * from case_financials where case_id = $1 and fiscal_year = $2 for update`, [id, year])).rows[0];
      if (!row) throw err.year();
      const verified = { ...(row.verified ?? row.declared), [field]: input.value };
      await q.query(`update case_financials set verified = $3, updated_at = now() where case_id = $1 and fiscal_year = $2`, [id, year, JSON.stringify(verified)]);
      await q.query(
        `insert into financial_adjustments (id, case_id, fiscal_year, field, declared, verified, reason, by_user) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [uuidv7(), id, year, field, row.declared?.[field] ?? null, input.value, input.reason, req.user!.id],
      );
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: "case.figure_verified", entityType: "case", entityId: id, before: { [field]: row.declared?.[field] }, after: { fiscal_year: year, [field]: input.value, reason: input.reason } });
      return { fiscal_year: year, field, declared: row.declared?.[field] ?? null, verified: input.value, problems: yearProblems(verified) };
    });
  }

  async lockFinancials(req: AppRequest, id: string) {
    return this.db.tx(async (q) => {
      const c = await this.caseById(q, id, true);
      if (c.state !== "documents_complete") throw err.review(`case is ${c.state}`);
      if (c.financials_locked_at) throw err.finLocked();
      const rows = (await q.query(`select * from case_financials where case_id = $1`, [id])).rows;
      const bad = yearsOf(c.latest_fiscal_year).map((y) => {
        const r = rows.find((x: any) => x.fiscal_year === y);
        return { fiscal_year: y, problems: r?.verified ? yearProblems(r.verified) : ["missing"] };
      }).filter((x) => x.problems.length);
      if (bad.length) throw err.notBalanced(bad);
      await q.query(`update cases set financials_locked_at = now(), financials_locked_by = $2 where id = $1`, [id, req.user!.id]);
      await closeWorkflowTasks(q, "case", id, req.user!.id);
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: "case.financials_locked", entityType: "case", entityId: id });
      return { id, financials_locked_at: new Date().toISOString() };
    });
  }
}

// ------------------------------------------------------------------ helpers

function strip<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "")) as Partial<T>;
}

/** Top-level keys whose value differs from what registration supplied (for the «تغییر دادید» tag). */
function changedKeys(prefill: Record<string, unknown>, data: Record<string, unknown>) {
  return Object.keys(prefill ?? {}).filter((k) => JSON.stringify(prefill[k]) !== JSON.stringify(data?.[k]));
}

const signatories = (board: any) =>
  ((board?.people ?? []) as any[]).filter((p) => p.signing_right).map((p) => p.national_id).sort().join(",");

function statementTotals(f: Record<string, string>) {
  const s = statement(toFinancialYear(f));
  return {
    current_assets: s.currentAssets, fixed_assets: s.fixedAssets, total_assets: s.totalAssets, current_liabilities: s.currentLiabilities,
    total_liabilities: s.totalLiabilities, equity: s.equity, total_liabilities_and_equity: s.totalLiabilitiesAndEquity, balance_difference: s.balanceDifference,
    gross_profit: s.grossProfit, operating_profit: s.operatingProfit, profit_before_tax: s.profitBeforeTax, net_profit: s.netProfit,
  };
}
