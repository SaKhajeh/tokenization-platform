import { isoToJalali } from "./jalali.js";
/**
 * Credit case (پرونده اعتباری) — rules shared by the API and the apps. Spec: plan/07-case-file-and-credit-scoring.md §2–§5.
 *
 * - CASE / CASE_ITEM state machines.
 * - The document checklist (§3.1) and the dynamic upload slots it produces from the information form (§3.2):
 *   one slot per person (CEO, board members, signatories), per fiscal year, per location and per bank account.
 * - Completeness rules for the 9 sections of the information form (§4).
 * - Financial summary input checks (§5): whole million rials, three years, balanced.
 */
import type { Machine } from "./stateMachines.js";
import { FINANCIAL_FIELDS, statement, type FinancialYear } from "./creditScoring.js";

// ------------------------------------------------------------------ state machines (§2, §3.3)

export type CaseState =
  | "opened" | "in_preparation" | "submitted" | "document_review" | "returned" | "resubmitted" | "documents_complete"
  | "scoring" | "pending_approval" | "sent_back_to_analyst" | "limit_issued" | "declined" | "expired" | "under_review"
  | "withdrawn" | "closed_inactive";

export const CASE: Machine<CaseState> = {
  opened: ["in_preparation", "withdrawn", "closed_inactive"],
  in_preparation: ["submitted", "withdrawn", "closed_inactive"],
  submitted: ["document_review", "withdrawn"],
  document_review: ["returned", "documents_complete", "withdrawn"],
  returned: ["resubmitted", "withdrawn", "closed_inactive"],
  resubmitted: ["document_review", "withdrawn"],
  // extra documents can still be requested after completion (§3.4) → returned
  documents_complete: ["scoring", "returned", "withdrawn"],
  scoring: ["pending_approval", "withdrawn"],
  pending_approval: ["limit_issued", "sent_back_to_analyst", "declined"],
  sent_back_to_analyst: ["scoring", "pending_approval"],
  limit_issued: ["expired", "under_review"],
  declined: ["under_review"],
  expired: ["under_review"],
  under_review: ["in_preparation", "scoring"],
  withdrawn: [],
  closed_inactive: [],
};

/** States in which the applicant may edit the case. In `returned`, only items and sections sent back. */
export const CASE_EDITABLE: readonly CaseState[] = ["opened", "in_preparation", "returned", "under_review"];

export type ItemState = "empty" | "requested" | "uploaded" | "not_available" | "in_review" | "accepted" | "needs_fix" | "rejected" | "not_required";

export const CASE_ITEM: Machine<ItemState> = {
  empty: ["uploaded", "not_available", "not_required"],
  requested: ["uploaded", "not_required"],
  uploaded: ["empty", "not_available", "in_review", "not_required"],
  not_available: ["empty", "uploaded", "in_review", "not_required"],
  in_review: ["accepted", "needs_fix", "rejected"],
  accepted: ["needs_fix", "not_required"], // staff re-open; slot removed
  needs_fix: ["uploaded", "not_available", "in_review", "not_required"],
  rejected: ["uploaded", "in_review", "not_required"],
  not_required: ["empty", "uploaded", "accepted"], // slot back (e.g. a person re-added)
};

/** Item states the applicant may change (upload, remove, "not available"). */
export const ITEM_APPLICANT_EDITABLE: readonly ItemState[] = ["empty", "requested", "uploaded", "not_available", "needs_fix", "rejected"];
/** Item states that count as "returned to the applicant". */
export const ITEM_RETURNED: readonly ItemState[] = ["needs_fix", "rejected", "requested"];

export const REVIEW_REASONS = ["incomplete", "illegible", "no_stamp_or_signature", "outdated_or_invalid", "wrong_person", "other"] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

// ------------------------------------------------------------------ checklist (§3.1)

export type SlotRule =
  | "single"             // one slot for the company
  | "company_and_people" // company + CEO + each board member
  | "people"             // CEO + each board member
  | "signatories"        // each person with a signing right
  | "per_year"           // last 4 fiscal years (Y0..Y-3); Y-3 optional
  | "per_location"       // each location in form §3
  | "per_bank";          // each bank account in form §7

export interface ChecklistItem {
  code: string;
  title: string;
  required: "yes" | "if_available";
  slots: SlotRule;
  /** Several files may be uploaded to one slot (e.g. several gazette notices). */
  multi: boolean;
  guidance?: string;
  /** The original paper must be delivered at the site visit. */
  originalRequired?: boolean;
  /** Link field (e.g. the SMS link of a credit report). */
  withLink?: boolean;
  /** Carried from registration (KYB). */
  fromKyb?: boolean;
  /** A step-by-step guide shown with the item (e.g. how to get the Etebarito report). */
  howTo?: readonly string[];
  /** The fund provides a template to download (uploaded by staff; see checklist_templates). */
  template?: boolean;
  /** Instead of the document, an explanation letter with one of these reasons may be uploaded (e.g. no tax return). */
  altLetterReasons?: readonly string[];
}

/** Reasons a company may give, with a letter, instead of a tax return (fund feedback 2026-11-25). */
export const NO_TAX_RETURN_REASONS = ["newly_established", "inactive", "exempt", "other"] as const;
export const NO_TAX_RETURN_REASON_FA: Record<(typeof NO_TAX_RETURN_REASONS)[number], string> = {
  newly_established: "شرکت در آن سال تازه‌تأسیس بوده است", inactive: "شرکت در آن سال فعالیت نداشته (منفعل بوده) است",
  exempt: "شرکت معاف از ارائه‌ی اظهارنامه بوده است", other: "دلیل دیگر (در نامه توضیح داده شده است)",
};

/** What the company is told about the site visit (fund feedback 2026-11-25): sent with the proposal and shown in the app. */
export const VISIT_INSTRUCTIONS_FA =
  "در بازدید، دو نفر ارزیاب از صندوق و یک نفر متخصص حضور خواهند داشت. حضور مدیرعامل در بازدید الزامی است و در کنار ایشان یکی از نیروهای فنی یا مالی شرکت نیز باید حاضر باشد.";

/** The applicant is told this before the credit assessment starts (fund feedback 2026-11-25). */
export const ASSESSMENT_DISCLAIMER_FA =
  "انجام فرایند اعتبارسنجی و تعیین حد اعتباری به معنای اعطای تسهیلات یا ارائه‌ی خدمات صندوق نیست. پس از تعیین حد، هر درخواست تأمین مالی جداگانه بررسی و درباره‌ی آن تصمیم‌گیری می‌شود.";

/** How to get the Etebarito credit report (item 1-5). The fund should confirm these steps against the live site. */
export const ETEBARITO_HOW_TO = [
  "به سامانه‌ی اعتباریتو (etebarito.nics.ir) یا وب‌سایت شرکت اعتبارسنجی ایران (ics24.ir) بروید.",
  "برای گزارش هر شخص: کد ملی همان شخص را وارد کنید. شماره‌ی همراه باید به نام خود او باشد تا کد تأیید برایش ارسال شود.",
  "برای گزارش شرکت: گزینه‌ی گزارش اشخاص حقوقی را انتخاب کنید و شناسه‌ی ملی شرکت، کد ملی مدیرعامل و شماره‌ی همراه به نام مدیرعامل را وارد کنید.",
  "کد تأیید پیامک‌شده را وارد کنید و هزینه‌ی گزارش را با درگاه بانکی پرداخت کنید.",
  "پس از آماده شدن، فایل PDF گزارش را دانلود کنید. پیوندی که با پیامک می‌رسد را هم نگه دارید.",
  "برای شرکت، مدیرعامل و هر عضو هیئت‌مدیره جداگانه گزارش بگیرید؛ در اینجا فایل هر نفر را در جای خودش بارگذاری کنید و پیوند پیامکی را وارد کنید.",
] as const;

export const CASE_CHECKLIST: readonly ChecklistItem[] = [
  { code: "1-2", title: "اجازه‌نامه‌ی استعلام اعتباری", required: "yes", slots: "company_and_people", multi: false, originalRequired: true, template: true,
    guidance: "قالب فرم را دانلود کنید؛ آن را تکمیل، چاپ، امضا و مهر کنید و تصویر آن را بارگذاری کنید. اصل فرم باید تحویل شود." },
  { code: "1-5", title: "گزارش اعتباری (اعتباریتو)", required: "yes", slots: "company_and_people", multi: false, withLink: true, howTo: ETEBARITO_HOW_TO,
    guidance: "برای شرکت، مدیرعامل و هر عضو هیئت‌مدیره گزارش بگیرید؛ فایل هر نفر را جدا بارگذاری کنید و پیوند پیامکی آن را وارد کنید." },
  // 1-6 «گواهی امضا» removed (fund feedback 2026-11-25): the digital signature is taken in the system instead.
  { code: "1-7", title: "گواهی ثنا", required: "yes", slots: "company_and_people", multi: false },
  { code: "2-1", title: "اساسنامه و آگهی تأسیس", required: "yes", slots: "single", multi: false, fromKyb: true, guidance: "همه‌ی صفحات مهر و امضا شده باشد." },
  { code: "2-2", title: "آخرین تغییرات ثبتی (روزنامه‌ی رسمی)", required: "yes", slots: "single", multi: true, fromKyb: true,
    guidance: "آخرین آگهی‌های تغییر نشانی و صاحبان امضای مجاز." },
  { code: "2-3", title: "شناسنامه و کارت ملی", required: "yes", slots: "people", multi: true,
    guidance: "شناسنامه: تصویر همه‌ی صفحات (حتی صفحه‌های خالی). کارت ملی: تصویر هر دو روی کارت (پشت و رو). می‌توانید چند فایل بارگذاری کنید." },
  { code: "2-4", title: "اجاره‌نامه یا سند مالکیت محل", required: "yes", slots: "per_location", multi: false,
    guidance: "برای محل استیجاری، اجاره‌نامه‌ی معتبر و برای محل ملکی، سند مالکیت را بارگذاری کنید تا محل فعالیت شرکت مشخص باشد. قالب خاصی لازم نیست." },
  { code: "3-1", title: "صورت‌های مالی", required: "yes", slots: "per_year", multi: true,
    guidance: "صورت‌های مالی چهار سال اخیر، ترجیحاً حسابرسی‌شده. برای آخرین سال، اگر صورت مالی هنوز آماده نیست، ترازنامه کافی است." },
  { code: "3-5", title: "اظهارنامه‌ی مالیاتی", required: "yes", slots: "per_year", multi: true, altLetterReasons: NO_TAX_RETURN_REASONS,
    guidance: "اظهارنامه‌ی مالیاتی هر یک از چهار سال اخیر. اگر برای سالی اظهارنامه ندارید (تازه‌تأسیس، منفعل و مانند آن)، به جای آن نامه‌ای با ذکر دلیل بارگذاری کنید." },
  { code: "3-2", title: "تراز آزمایشی شش‌ستونی سال جاری", required: "yes", slots: "single", multi: true,
    guidance: "تراز آزمایشی شش‌ستونی سال جاری تا پایان آخرین فصل کامل‌شده، در هر سه سطح کل، معین و تفصیل، مهر و امضا شده. برای هر سطح یک فایل بارگذاری کنید." },
  { code: "3-3", title: "گزارش گردش حساب بانکی", required: "yes", slots: "per_bank", multi: false,
    guidance: "جمع واریز، جمع برداشت و میانگین موجودی با مهر بانک." },
  { code: "3-4", title: "آخرین لیست بیمه", required: "yes", slots: "single", multi: false, guidance: "آخرین لیست بیمه‌ی کارکنان. رسید پرداخت لازم نیست." },
  { code: "4-1", title: "طرح توجیهی", required: "if_available", slots: "single", multi: false },
  { code: "4-2", title: "پروانه‌ی تأسیس یا بهره‌برداری", required: "if_available", slots: "single", multi: true },
  { code: "4-3", title: "سایر مجوزها، تأییدیه‌ها و استانداردها", required: "if_available", slots: "single", multi: true },
  { code: "4-4", title: "صفحات اول قراردادهای مهم ۳ سال اخیر یا فاکتورهای فروش", required: "if_available", slots: "single", multi: true,
    guidance: "صفحاتی که کارفرما، مبلغ و مدت را نشان می‌دهد (نام کارفرما می‌تواند پوشانده شود)، یا فاکتورهای فروش. هر تعداد فایل لازم است اضافه کنید." },
  { code: "4-5", title: "کاتالوگ یا معرفی محصولات", required: "yes", slots: "single", multi: true, guidance: "الزامی است. کاتالوگ، بروشور یا معرفی محصولات و خدمات شرکت." },
];

export const checklistItem = (code: string) => CASE_CHECKLIST.find((c) => c.code === code);

export interface CasePerson {
  /** National ID (person) or national ID of a legal-entity shareholder; the slot key. */
  national_id: string;
  name: string;
  kind?: "person" | "company";
  roles: ("shareholder" | "board" | "ceo")[];
  signing_right?: boolean;
  [k: string]: unknown;
}

export interface SlotDef {
  code: string;
  slotKey: string;
  label: string;
  required: "yes" | "if_available";
  multi: boolean;
}

export interface SlotContext {
  people: readonly CasePerson[];
  latestFiscalYear: number;
  locations: readonly { id: string; usage?: string; address?: string }[];
  banks: readonly { id: string; name?: string; account_no?: string }[];
}

const isDirector = (p: CasePerson) => p.roles.includes("ceo") || p.roles.includes("board");
const personLabel = (p: CasePerson) => `${p.name}${p.roles.includes("ceo") ? " (مدیرعامل)" : p.roles.includes("board") ? " (عضو هیئت‌مدیره)" : ""}`;
const USAGE_FA: Record<string, string> = { head_office: "دفتر مرکزی", workshop: "کارگاه", factory: "کارخانه", warehouse: "انبار" };

/** The upload slots the checklist requires for this form content (§3.2). Shareholders who are not directors get none. */
export function expectedSlots(ctx: SlotContext): SlotDef[] {
  const out: SlotDef[] = [];
  const directors = ctx.people.filter(isDirector);
  for (const c of CASE_CHECKLIST) {
    const add = (slotKey: string, label: string, required = c.required) => out.push({ code: c.code, slotKey, label, required, multi: c.multi });
    switch (c.slots) {
      case "single":
        add("company", "شرکت");
        break;
      case "company_and_people":
        add("company", "شرکت");
        for (const p of directors) add(`person:${p.national_id}`, personLabel(p));
        break;
      case "people":
        for (const p of directors) add(`person:${p.national_id}`, personLabel(p));
        break;
      case "signatories":
        for (const p of ctx.people.filter((x) => x.signing_right)) add(`person:${p.national_id}`, personLabel(p));
        break;
      case "per_year":
        for (let i = 0; i < FINANCIAL_YEARS; i++) add(`year:${ctx.latestFiscalYear - i}`, `سال مالی ${ctx.latestFiscalYear - i}`, "yes");
        break;
      case "per_location":
        for (const l of ctx.locations) add(`location:${l.id}`, `${USAGE_FA[l.usage ?? ""] ?? "محل"}${l.address ? ` — ${l.address}` : ""}`);
        break;
      case "per_bank":
        for (const b of ctx.banks) add(`bank:${b.id}`, `${b.name ?? "بانک"}${b.account_no ? ` — ${b.account_no}` : ""}`);
        break;
    }
  }
  return out;
}

export interface ExistingSlot {
  id: string;
  code: string;
  slotKey: string;
  kind: "checklist" | "adhoc";
  state: ItemState;
  label: string;
}

/**
 * Reconciles existing items with the expected slots: new slots to add, slots no longer needed
 * (→ not_required, history kept), slots that come back (not_required → empty), labels that changed.
 * Ad-hoc items are never touched.
 */
export function reconcileSlots(existing: readonly ExistingSlot[], expected: readonly SlotDef[]) {
  const key = (code: string, slot: string) => `${code}|${slot}`;
  const want = new Map(expected.map((s) => [key(s.code, s.slotKey), s]));
  const have = new Map(existing.filter((e) => e.kind === "checklist").map((e) => [key(e.code, e.slotKey), e]));
  const add = expected.filter((s) => !have.has(key(s.code, s.slotKey)));
  const drop = [...have.values()].filter((e) => !want.has(key(e.code, e.slotKey)) && e.state !== "not_required");
  const revive = [...have.values()].filter((e) => want.has(key(e.code, e.slotKey)) && e.state === "not_required");
  const relabel = [...have.values()].filter((e) => want.has(key(e.code, e.slotKey)) && want.get(key(e.code, e.slotKey))!.label !== e.label);
  return { add, drop, revive, relabel: relabel.map((e) => ({ id: e.id, label: want.get(key(e.code, e.slotKey))!.label })) };
}

// ------------------------------------------------------------------ information form (§4)

export const FORM_SECTIONS = [
  "general", "knowledge_based", "locations", "board", "cvs", "workforce", "company_products", "banks_facilities", "licences_contracts_assets",
] as const;
export type FormSection = (typeof FORM_SECTIONS)[number];

export const FORM_SECTION_TITLES: Record<FormSection, string> = {
  general: "۱. اطلاعات عمومی", knowledge_based: "۲. وضعیت دانش‌بنیانی", locations: "۳. محل‌های فعالیت", board: "۴. هیئت‌مدیره، مدیرعامل و سهامداران",
  cvs: "۴ب. سوابق مدیران", workforce: "۵. نیروی انسانی", company_products: "۶. شرکت و محصولات", banks_facilities: "۷. بانک‌ها، تسهیلات و ضمانت‌نامه‌ها",
  licences_contracts_assets: "۸. مجوزها، قراردادها و دارایی‌ها",
};

type Data = Record<string, any>;
const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
const need = (d: Data | undefined, paths: string[], prefix = "") =>
  paths.filter((p) => blank(p.split(".").reduce((o: any, k) => (o == null ? undefined : o[k]), d))).map((p) => `${prefix}${p}`);
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);

/**
 * What is still missing or wrong in a section (field paths and rule names). Empty = complete.
 * Drafts may be saved in any state; submission needs every section complete.
 */
export function sectionProblems(section: FormSection, d: Data | undefined, all: Partial<Record<FormSection, Data>> = {}): string[] {
  d = d ?? {};
  switch (section) {
    case "general":
      return need(d, ["legal_name", "legal_form", "activity_subject", "registration_place", "national_id", "economic_code", "registration_no",
        "establishment_date", "capital_initial", "capital_current", "representative.name", "representative.role", "representative.mobile",
        "ceo.name", "ceo.mobile", "landline", "heard_from.channel"]);
    case "knowledge_based": {
      if (typeof d.is_knowledge_based !== "boolean") return ["is_knowledge_based"];
      return d.is_knowledge_based ? need(d, ["type", "approval_date", "validity_date", "products", "field"]) : [];
    }
    case "locations": {
      const rows: Data[] = d.rows ?? [];
      if (!rows.length) return ["rows"];
      const p = rows.flatMap((r, i) => need(r, ["id", "usage", "area_m2", "ownership", "province", "address", "postcode"], `rows.${i}.`));
      if (!rows.some((r) => r.usage === "head_office")) p.push("rule:head_office_required");
      return p;
    }
    case "board": {
      const people: Data[] = d.people ?? [];
      const p = need(d, ["gazette_no", "gazette_date", "people"]);
      people.forEach((x, i) => p.push(...need(x, ["national_id", "name", "roles"], `people.${i}.`)));
      const ids = people.map((x) => x.national_id).filter(Boolean);
      if (new Set(ids).size !== ids.length) p.push("rule:duplicate_national_id");
      const holders = people.filter((x) => (x.roles ?? []).includes("shareholder"));
      if (holders.length) {
        const total = holders.reduce((s, x) => s + (Number.isFinite(num(x.share_pct)) ? num(x.share_pct) : 0), 0);
        if (Math.abs(total - 100) > 0.001) p.push("rule:shares_total_100");
      } else if (people.length) p.push("rule:shareholders_required");
      if (people.filter((x) => (x.roles ?? []).includes("ceo")).length !== 1) p.push("rule:one_ceo");
      if (people.length && !people.some((x) => x.signing_right)) p.push("rule:signatory_required");
      return p;
    }
    case "cvs": {
      const directors: Data[] = ((all.board?.people ?? []) as Data[]).filter((x) => (x.roles ?? []).some((r: string) => r === "ceo" || r === "board"));
      const entries: Data[] = d.entries ?? [];
      const p: string[] = [];
      for (const dir of directors) {
        const i = entries.findIndex((e) => e.national_id === dir.national_id);
        if (i < 0) p.push(`entries.${dir.national_id}`);
        else p.push(...need(entries[i], ["position", "field_degree", "experience_years"], `entries.${i}.`));
      }
      return p;
    }
    case "workforce":
      return need(d, ["full_time", "part_time", "insured"]);
    case "company_products": {
      const p = need(d, ["history", "process", "products"]);
      (d.products ?? []).forEach((x: Data, i: number) => p.push(...need(x, ["name", "main_customers"], `products.${i}.`)));
      return p;
    }
    case "banks_facilities": {
      const p = need(d, ["banks"]);
      (d.banks ?? []).forEach((x: Data, i: number) => p.push(...need(x, ["id", "name", "branch", "account_no"], `banks.${i}.`)));
      if (typeof d.declaration?.returned_cheques !== "boolean") p.push("declaration.returned_cheques");
      if (typeof d.declaration?.overdue_debts !== "boolean") p.push("declaration.overdue_debts");
      return p;
    }
    case "licences_contracts_assets":
      return []; // optional content (assets raise the limit); saving it once is enough
  }
}

/** Form §7 auto totals (tables 12–13). Amounts in million rials. */
export function bankTotals(d: Data | undefined) {
  const n = (v: unknown) => (Number.isFinite(num(v)) ? num(v) : 0);
  const fac: Data[] = d?.facilities ?? [];
  const gua: Data[] = d?.guarantees ?? [];
  return {
    facilitiesTotal: fac.reduce((s, f) => s + n(f.amount), 0),
    facilitiesCurrent: fac.filter((f) => n(f.outstanding) > 0).reduce((s, f) => s + n(f.amount), 0),
    facilitiesOutstanding: fac.reduce((s, f) => s + n(f.outstanding), 0),
    guaranteesTotal: gua.reduce((s, g) => s + n(g.amount), 0),
    guaranteesCurrent: gua.filter((g) => g.status === "active").reduce((s, g) => s + n(g.amount), 0),
  };
}

/** The people list of form §4, as used for slots. */
export function casePeople(board: Data | undefined): CasePerson[] {
  return ((board?.people ?? []) as Data[])
    .filter((p) => !blank(p.national_id))
    .map((p) => ({ ...p, national_id: String(p.national_id), name: String(p.name ?? ""), roles: (p.roles ?? []) as CasePerson["roles"], signing_right: !!p.signing_right }));
}

// ------------------------------------------------------------------ financial summary (§5)

/**
 * Figures are entered in whole MILLION RIALS (as in the statements and the workbook) and stored as integer strings.
 * They are reported figures, not money held by the platform; the scoring model converts them to numbers.
 */
export type FinancialFigures = Record<(typeof FINANCIAL_FIELDS)[number], string>;
export const STATEMENT_TYPES = ["audited", "tax_return", "internal", "balance_sheet", "trial_balance"] as const;

/** Years of figures and statements asked for (fund feedback 2026-11-25: four; was three). */
export const FINANCIAL_YEARS = 4;
/** Fiscal years asked for, latest first. */
export const financialYears = (latest: number) => Array.from({ length: FINANCIAL_YEARS }, (_, i) => latest - i);
/** Periods entered: the current-year trial balance (fiscal year latest + 1), then the four years of statements. */
export const financialPeriods = (latest: number) => [latest + 1, ...financialYears(latest)];

/**
 * The two calculations (fund rules 2026-11-26): A on the statements of the latest `n` years; B on the current-year
 * trial balance plus the statements of the latest `n - 1` years. `n` is the method's number of periods (4 since v2).
 */
export const calculationPeriods = (latest: number, n: number) => ({ a: financialYears(latest).slice(0, n), b: [latest + 1, ...financialYears(latest).slice(0, n - 1)] });

/**
 * The three years the scoring method uses (the fund's workbook needs three full years): the latest three, unless the
 * latest year is only a balance sheet (allowed for the latest year), then the three before it.
 */
export function scoringYears(latest: number, latestStatementType: string | null | undefined): [number, number, number] {
  const y0 = latestStatementType === "balance_sheet" ? latest - 1 : latest;
  return [y0, y0 - 1, y0 - 2];
}
export type StatementType = (typeof STATEMENT_TYPES)[number];

const INT_RE = /^-?(0|[1-9]\d{0,14})$/;

/** Field problems for one year: missing or not a whole number (million rials). Negative values are allowed (e.g. losses). */
export function figureProblems(f: Partial<Record<string, string>> | undefined): string[] {
  return FINANCIAL_FIELDS.filter((k) => !(typeof f?.[k] === "string" && INT_RE.test(f[k]!)));
}

export function toFinancialYear(f: Partial<Record<string, string>>): FinancialYear {
  return Object.fromEntries(FINANCIAL_FIELDS.map((k) => [k, Number(f[k] ?? "0")])) as unknown as FinancialYear;
}

/** Submission rule: every year complete, and assets = liabilities + equity. */
export function yearProblems(f: Partial<Record<string, string>> | undefined): string[] {
  const p = figureProblems(f);
  if (p.length) return p.map((k) => `field:${k}`);
  const s = statement(toFinancialYear(f!));
  return s.balanceDifference !== 0 ? [`rule:not_balanced:${s.balanceDifference}`] : [];
}

// ------------------------------------------------------------------ site visit (D-C16) and assessment rounds (§6.6)

/**
 * The fund proposes a date; the applicant confirms in the app or asks for another date (which opens a ticket).
 * A new proposal cancels the previous one. The visit report closes it (findings, photos, originals received).
 */
export type VisitState = "proposed" | "confirmed" | "change_requested" | "done" | "cancelled";
export const VISIT: Machine<VisitState> = {
  proposed: ["confirmed", "change_requested", "cancelled"],
  change_requested: ["cancelled"],
  confirmed: ["done", "cancelled"],
  done: [],
  cancelled: [],
};

/** One scoring round: the analyst prepares, the fund manager (never the preparer) approves, sends back or declines. */
/**
 * A scoring round (fund rules 2026-11-26): the analyst prepares it; the credit manager (or fund manager) approves it,
 * sends it back or declines it; after the credit approval the compliance officer sends the result to the CEO with a
 * comment; the CEO confirms the committee meeting was held and accepts (possibly editing the numbers) or declines;
 * the compliance officer then releases the result to the company with an explanation — only then is a limit issued.
 */
export type RoundState = "preparing" | "pending_approval" | "sent_back" | "credit_approved" | "ceo_review" | "ceo_accepted" | "ceo_declined" | "approved" | "declined";
export const ROUND: Machine<RoundState> = {
  preparing: ["pending_approval"],
  pending_approval: ["credit_approved", "sent_back", "declined"],
  sent_back: ["pending_approval"],
  credit_approved: ["ceo_review"],
  ceo_review: ["ceo_accepted", "ceo_declined"],
  ceo_accepted: ["approved"],
  ceo_declined: ["declined"],
  approved: [],
  declined: [],
};

/** Credit limits are valid for 12 months (Q9). */
export const LIMIT_VALIDITY_MONTHS = 12;

/** D-C13: Tehran or outside Tehran, by where the company works — factory or workshop first, else the head office. */
export function feeRegion(locations: readonly { usage?: string; province?: string }[] | undefined): "tehran" | "outside" {
  const rows = locations ?? [];
  const works = rows.filter((r) => r.usage === "factory" || r.usage === "workshop");
  const basis = works.length ? works : rows.filter((r) => r.usage === "head_office");
  return basis.some((r) => (r.province ?? "").trim() === "تهران") ? "tehran" : "outside";
}

// ------------------------------------------------------------------ trial balance period (fund feedback, 2026-11-26)

const JALALI_MONTH_FA = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];

/**
 * The period the current-year trial balance must cover: from the start of the Jalali year to the end of the last
 * completed season (Iran's year starts in spring). In summer → to the end of spring (Khordad); in the middle of fall
 * → to the end of summer (Shahrivar). In spring no season of the new year is complete yet, so it covers the whole
 * previous year (to the end of Esfand). `today` is a Tehran calendar date (YYYY-MM-DD).
 */
export function trialBalancePeriod(today: string): { fiscalYear: number; throughMonth: 3 | 6 | 9 | 12; months: number; label: string } {
  const [jy, jm] = isoToJalali(today).split("/").map(Number);
  const done = Math.floor((jm - 1) / 3) * 3; // months of this year in completed seasons: 0, 3, 6 or 9
  const fiscalYear = done === 0 ? jy - 1 : jy;
  const throughMonth = (done === 0 ? 12 : done) as 3 | 6 | 9 | 12;
  return { fiscalYear, throughMonth, months: throughMonth, label: `از ابتدای سال ${fiscalYear} تا پایان ${JALALI_MONTH_FA[throughMonth - 1]} ${fiscalYear}` };
}
