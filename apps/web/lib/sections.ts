/**
 * The 9 sections of the credit-case information form (doc 07 §4), as field schemas for the generic editor.
 * Keys match what the API validates (packages/domain caseFile.ts sectionProblems). Amounts are million rials.
 */
export type FieldType = "text" | "textarea" | "number" | "date" | "bool" | "select" | "roles" | "mobile" | "digits";
export interface FieldDef { key: string; label: string; type: FieldType; options?: [string, string][]; required?: boolean; hint?: string; readonly?: boolean; wide?: boolean }
export interface RepeatDef { key: string; label: string; addLabel: string; fields: FieldDef[]; autoId?: string; minRows?: number }
export interface SectionDef { title: string; intro?: string; fields?: FieldDef[]; repeats?: RepeatDef[] }

const PROVINCES = ["تهران", "البرز", "اصفهان", "خراسان رضوی", "فارس", "آذربایجان شرقی", "خوزستان", "مازندران", "قم", "مرکزی", "گیلان", "یزد", "کرمان", "قزوین", "سمنان", "همدان", "زنجان", "کرمانشاه", "آذربایجان غربی", "اردبیل", "گلستان", "هرمزگان", "بوشهر", "سیستان و بلوچستان", "لرستان", "کردستان", "چهارمحال و بختیاری", "کهگیلویه و بویراحمد", "ایلام", "خراسان شمالی", "خراسان جنوبی"].map((p) => [p, p] as [string, string]);

export const SECTIONS: Record<string, SectionDef> = {
  general: {
    title: "۱. اطلاعات عمومی",
    intro: "بخشی از اطلاعات از ثبت‌نام و سامانه‌ی ثبت شرکت‌ها آمده است؛ اگر تغییری لازم است اصلاح کنید.",
    fields: [
      { key: "legal_name", label: "نام شرکت", type: "text", required: true },
      { key: "legal_form", label: "نوع شخصیت حقوقی", type: "select", required: true, options: [["سهامی خاص", "سهامی خاص"], ["سهامی عام", "سهامی عام"], ["با مسئولیت محدود", "با مسئولیت محدود"], ["تعاونی", "تعاونی"], ["سایر", "سایر"]] },
      { key: "national_id", label: "شناسه‌ی ملی", type: "digits", required: true, readonly: true },
      { key: "registration_no", label: "شماره‌ی ثبت", type: "digits", required: true },
      { key: "registration_place", label: "محل ثبت", type: "text", required: true },
      { key: "establishment_date", label: "تاریخ تأسیس", type: "date", required: true },
      { key: "economic_code", label: "کد اقتصادی", type: "digits", required: true },
      { key: "activity_subject", label: "موضوع فعالیت", type: "textarea", required: true, wide: true },
      { key: "capital_initial", label: "سرمایه‌ی اولیه (میلیون ریال)", type: "number", required: true },
      { key: "capital_current", label: "سرمایه‌ی فعلی (میلیون ریال)", type: "number", required: true },
      { key: "landline", label: "تلفن ثابت", type: "digits", required: true },
      { key: "company_email", label: "ایمیل شرکت", type: "text" },
      { key: "website", label: "وب‌سایت", type: "text" },
      { key: "ceo.name", label: "نام مدیرعامل", type: "text", required: true },
      { key: "ceo.mobile", label: "همراه مدیرعامل", type: "mobile", required: true },
      { key: "representative.name", label: "نام نماینده در پرونده", type: "text", required: true },
      { key: "representative.role", label: "سمت نماینده", type: "text", required: true },
      { key: "representative.mobile", label: "همراه نماینده", type: "mobile", required: true },
      { key: "heard_from.channel", label: "آشنایی با صندوق از طریق", type: "select", required: true, options: [["website", "وب‌سایت"], ["fund_staff", "کارکنان صندوق"], ["event", "رویداد یا نمایشگاه"], ["referral", "معرفی شرکت دیگر"], ["other", "سایر"]] },
    ],
  },
  knowledge_based: {
    title: "۲. وضعیت دانش‌بنیانی",
    fields: [
      { key: "is_knowledge_based", label: "شرکت دانش‌بنیان است", type: "bool", required: true },
      { key: "type", label: "نوع", type: "select", options: [["نوپا", "نوپا"], ["تولیدی", "تولیدی"], ["فناور", "فناور"], ["سایر", "سایر"]], hint: "فقط برای شرکت‌های دانش‌بنیان" },
      { key: "approval_date", label: "تاریخ تأیید", type: "date" },
      { key: "validity_date", label: "اعتبار تا", type: "date" },
      { key: "field", label: "حوزه", type: "text" },
      { key: "products", label: "محصولات دانش‌بنیان", type: "textarea", wide: true },
    ],
  },
  locations: {
    title: "۳. محل‌های فعالیت",
    intro: "دفتر مرکزی الزامی است. برای هر محل، سند مالکیت یا اجاره‌نامه در بخش مدارک خواسته می‌شود.",
    repeats: [{
      key: "rows", label: "محل", addLabel: "افزودن محل", autoId: "id", minRows: 1,
      fields: [
        { key: "usage", label: "کاربری", type: "select", required: true, options: [["head_office", "دفتر مرکزی"], ["workshop", "کارگاه"], ["factory", "کارخانه"], ["warehouse", "انبار"]] },
        { key: "ownership", label: "وضعیت مالکیت", type: "select", required: true, options: [["owned", "ملکی"], ["leased", "استیجاری"]] },
        { key: "area_m2", label: "متراژ (متر مربع)", type: "number", required: true },
        { key: "staff_count", label: "تعداد نیرو", type: "number" },
        { key: "province", label: "استان", type: "select", required: true, options: PROVINCES },
        { key: "postcode", label: "کد پستی", type: "digits", required: true },
        { key: "address", label: "نشانی", type: "text", required: true, wide: true },
      ],
    }],
  },
  board: {
    title: "۴. هیئت‌مدیره، مدیرعامل و سهامداران",
    intro: "همه‌ی سهامداران، اعضای هیئت‌مدیره و مدیرعامل را وارد کنید. جمع سهام باید ۱۰۰٪ باشد و دست‌کم یک نفر حق امضا داشته باشد.",
    fields: [
      { key: "gazette_no", label: "شماره‌ی آخرین روزنامه‌ی رسمی", type: "digits", required: true },
      { key: "gazette_date", label: "تاریخ روزنامه", type: "date", required: true },
    ],
    repeats: [{
      key: "people", label: "شخص", addLabel: "افزودن شخص", minRows: 1,
      fields: [
        { key: "name", label: "نام", type: "text", required: true },
        { key: "national_id", label: "کد ملی / شناسه‌ی ملی", type: "digits", required: true },
        { key: "kind", label: "نوع", type: "select", options: [["person", "حقیقی"], ["company", "حقوقی"]] },
        { key: "roles", label: "نقش", type: "roles", required: true },
        { key: "share_pct", label: "درصد سهام", type: "number" },
        { key: "signing_right", label: "حق امضا دارد", type: "bool" },
      ],
    }],
  },
  cvs: {
    title: "۴ب. سوابق مدیران",
    intro: "برای مدیرعامل و هر عضو هیئت‌مدیره (از بخش ۴) یک سابقه لازم است.",
  },
  workforce: {
    title: "۵. نیروی انسانی",
    fields: [
      { key: "full_time", label: "تمام‌وقت", type: "number", required: true },
      { key: "part_time", label: "پاره‌وقت", type: "number", required: true },
      { key: "insured", label: "بیمه‌شده", type: "number", required: true },
    ],
    repeats: [{
      key: "key_staff", label: "نیروی کلیدی", addLabel: "افزودن نیروی کلیدی",
      fields: [
        { key: "name", label: "نام", type: "text" },
        { key: "position", label: "سمت", type: "text" },
        { key: "field_degree", label: "رشته و مدرک", type: "text" },
      ],
    }],
  },
  company_products: {
    title: "۶. شرکت و محصولات",
    fields: [
      { key: "history", label: "تاریخچه‌ی شرکت", type: "textarea", required: true, wide: true },
      { key: "process", label: "فرایند تولید یا ارائه‌ی خدمت", type: "textarea", required: true, wide: true },
    ],
    repeats: [{
      key: "products", label: "محصول", addLabel: "افزودن محصول", minRows: 1,
      fields: [
        { key: "name", label: "نام محصول یا خدمت", type: "text", required: true },
        { key: "main_customers", label: "مشتریان اصلی", type: "text", required: true },
        { key: "share_of_sales", label: "سهم از فروش (٪)", type: "number" },
      ],
    }],
  },
  banks_facilities: {
    title: "۷. بانک‌ها، تسهیلات و ضمانت‌نامه‌ها",
    intro: "برای هر حساب، گزارش گردش حساب در بخش مدارک خواسته می‌شود. مبالغ به میلیون ریال.",
    repeats: [
      { key: "banks", label: "حساب بانکی", addLabel: "افزودن حساب", autoId: "id", minRows: 1, fields: [
        { key: "name", label: "بانک", type: "text", required: true }, { key: "branch", label: "شعبه", type: "text", required: true },
        { key: "account_no", label: "شماره‌ی حساب یا شبا", type: "text", required: true },
      ] },
      { key: "facilities", label: "تسهیلات", addLabel: "افزودن تسهیلات", fields: [
        { key: "bank", label: "بانک", type: "text" }, { key: "type", label: "نوع", type: "text" },
        { key: "amount", label: "مبلغ (میلیون ریال)", type: "number" }, { key: "outstanding", label: "مانده (میلیون ریال)", type: "number" },
      ] },
      { key: "guarantees", label: "ضمانت‌نامه", addLabel: "افزودن ضمانت‌نامه", fields: [
        { key: "bank", label: "بانک", type: "text" }, { key: "type", label: "نوع", type: "text" },
        { key: "amount", label: "مبلغ (میلیون ریال)", type: "number" },
        { key: "status", label: "وضعیت", type: "select", options: [["active", "جاری"], ["expired", "منقضی یا آزاد شده"]] },
      ] },
    ],
    fields: [
      { key: "declaration.returned_cheques", label: "چک برگشتی رفع‌نشده دارد", type: "bool", required: true },
      { key: "declaration.overdue_debts", label: "بدهی سررسیدگذشته‌ی بانکی دارد", type: "bool", required: true },
    ],
  },
  licences_contracts_assets: {
    title: "۸. مجوزها، قراردادها و دارایی‌ها",
    intro: "این بخش اختیاری است؛ دارایی‌های ثبت‌شده می‌تواند در تعیین حد اثر داشته باشد. یک بار ذخیره کافی است.",
    repeats: [
      { key: "licences", label: "مجوز", addLabel: "افزودن مجوز", fields: [
        { key: "title", label: "عنوان", type: "text" }, { key: "issuer", label: "مرجع صدور", type: "text" }, { key: "expiry", label: "اعتبار تا", type: "date" },
      ] },
      { key: "contracts", label: "قرارداد", addLabel: "افزودن قرارداد", fields: [
        { key: "employer", label: "کارفرما", type: "text" }, { key: "subject", label: "موضوع", type: "text" },
        { key: "amount", label: "مبلغ (میلیون ریال)", type: "number" }, { key: "year", label: "سال", type: "digits" },
      ] },
      { key: "assets", label: "دارایی", addLabel: "افزودن دارایی", fields: [
        { key: "type", label: "نوع", type: "text" }, { key: "description", label: "شرح", type: "text" }, { key: "value", label: "ارزش (میلیون ریال)", type: "number" },
      ] },
    ],
  },
};

export const SECTION_ORDER = ["general", "knowledge_based", "locations", "board", "cvs", "workforce", "company_products", "banks_facilities", "licences_contracts_assets"];

/** Field labels for the problem paths sectionProblems returns (`rows.0.address`, `rule:one_ceo`, …). */
export function problemText(section: string, p: string): string {
  const RULES: Record<string, string> = {
    "rule:head_office_required": "دفتر مرکزی باید ثبت شود.", "rule:duplicate_national_id": "یک کد ملی دو بار وارد شده است.",
    "rule:shares_total_100": "جمع درصد سهام باید ۱۰۰ باشد.", "rule:shareholders_required": "دست‌کم یک سهامدار لازم است.",
    "rule:one_ceo": "دقیقاً یک مدیرعامل باید مشخص شود.", "rule:signatory_required": "دست‌کم یک نفر باید حق امضا داشته باشد.",
  };
  if (RULES[p]) return RULES[p];
  const def = SECTIONS[section];
  const parts = p.split(".");
  const rep = def?.repeats?.find((r) => r.key === parts[0]);
  if (rep && parts.length >= 3) {
    const f = rep.fields.find((x) => x.key === parts.slice(2).join("."));
    return `${rep.label} ${Number(parts[1]) + 1}: ${f?.label ?? parts.slice(2).join(".")} وارد نشده است.`;
  }
  if (section === "cvs" && parts[0] === "entries") return "سابقه‌ی یکی از مدیران تکمیل نشده است.";
  const f = def?.fields?.find((x) => x.key === p) ?? def?.repeats?.find((r) => r.key === p);
  return `${f?.label ?? p} وارد نشده است.`;
}
