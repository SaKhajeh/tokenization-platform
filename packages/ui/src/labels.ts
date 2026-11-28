/**
 * Status vocabulary (UX spec §5.5): one Farsi label and one tone per status key, used everywhere.
 * Tone never carries meaning alone — chips always show the label.
 */
export type Tone = "neutral" | "info" | "success" | "warning" | "danger";
type Vocab = Record<string, [label: string, tone: Tone]>;

const COMMON: Vocab = {
  draft: ["پیش‌نویس", "neutral"],
  pending_approval: ["در انتظار تأیید", "warning"],
  in_review: ["در حال بررسی", "info"],
  approved: ["تأیید شده", "success"],
  verified: ["تأیید شده", "success"],
  rejected: ["رد شده", "danger"],
  cancelled: ["لغو شده", "neutral"],
  expired: ["منقضی", "neutral"],
  withdrawn: ["انصراف", "neutral"],
};

export const VOCAB: Record<string, Vocab> = {
  kyb: {
    ...COMMON,
    not_started: ["شروع نشده", "neutral"],
    submitted: ["ارسال شده", "info"],
    info_requested: ["نیاز به اطلاعات بیشتر", "warning"],
  },
  case: {
    ...COMMON,
    opened: ["باز شده", "neutral"],
    in_preparation: ["در حال تکمیل", "neutral"],
    submitted: ["ارسال شده", "info"],
    document_review: ["بررسی مدارک", "info"],
    returned: ["بازگشت برای اصلاح", "warning"],
    resubmitted: ["ارسال مجدد", "info"],
    documents_complete: ["مدارک کامل", "info"],
    scoring: ["محاسبه‌ی حد اعتباری", "info"],
    pending_approval: ["در انتظار تصمیم صندوق", "warning"],
    sent_back_to_analyst: ["بازگشت به کارشناس", "warning"],
    limit_issued: ["حد اعتباری صادر شد", "success"],
    declined: ["رد شده", "danger"],
    under_review: ["بازبینی", "info"],
    closed_inactive: ["بسته شده (عدم فعالیت)", "neutral"],
  },
  item: {
    empty: ["بارگذاری نشده", "neutral"],
    requested: ["درخواست صندوق", "warning"],
    uploaded: ["بارگذاری شده", "info"],
    not_available: ["ندارم", "neutral"],
    in_review: ["در حال بررسی", "info"],
    accepted: ["پذیرفته شد", "success"],
    needs_fix: ["نیاز به اصلاح", "warning"],
    rejected: ["رد شده", "danger"],
    not_required: ["لازم نیست", "neutral"],
  },
  application: {
    ...COMMON,
    submitted: ["ارسال شده", "info"],
    screening: ["غربالگری", "info"],
    awaiting_payment: ["در انتظار پرداخت کارمزد", "warning"],
    returned: ["بازگشت برای اصلاح", "warning"],
    resubmitted: ["ارسال مجدد", "info"],
    credit_assessment: ["بررسی حد اعتباری", "info"],
    due_diligence: ["بررسی دقیق", "info"],
    committee: ["کمیته", "info"],
    approved_with_conditions: ["تأیید مشروط", "success"],
    terms_negotiation: ["تعیین شرایط", "info"],
    terms_signed: ["قرارداد امضا شد", "success"],
    handed_to_tokenisation: ["توکن‌سازی", "success"],
  },
  withdrawal: {
    requested: ["ثبت شد", "info"],
    org_approved: ["تأیید سازمان", "info"],
    finance_queued: ["بررسی مالی", "info"],
    internal_approved: ["تأیید مدیر صندوق", "info"],
    sent: ["ارسال به بانک", "warning"],
    completed: ["واریز شد", "success"],
    failed: ["ناموفق", "danger"],
    cancelled: ["لغو شده", "neutral"],
    reverted: ["برگشت خورد", "danger"],
  },
  invoice: {
    issued: ["پرداخت نشده", "warning"],
    paid: ["پرداخت شد", "success"],
    waived: ["بخشوده شد", "success"],
    cancelled: ["لغو شده", "neutral"],
  },
  visit: {
    proposed: ["پیشنهاد صندوق", "warning"],
    confirmed: ["تأیید شد", "success"],
    change_requested: ["درخواست زمان دیگر", "warning"],
    done: ["انجام شد", "success"],
    cancelled: ["لغو شده", "neutral"],
  },
  round: {
    preparing: ["در حال آماده‌سازی", "neutral"],
    pending_approval: ["در انتظار تأیید اعتباری", "warning"],
    sent_back: ["بازگشت برای بازبینی", "warning"],
    credit_approved: ["تأیید اعتباری؛ نزد کارشناس انطباق", "info"],
    ceo_review: ["نزد مدیرعامل", "warning"],
    ceo_accepted: ["پذیرش مدیرعامل؛ آماده‌ی اعلام", "info"],
    ceo_declined: ["رد مدیرعامل؛ آماده‌ی اعلام", "danger"],
    approved: ["تأیید شد", "success"],
    declined: ["رد شد", "danger"],
  },
  bank: {
    pending_review: ["در حال بررسی", "info"],
    verified: ["تأیید شده", "success"],
    rejected: ["رد شده", "danger"],
    removed: ["حذف شده", "neutral"],
  },
  wallet: {
    pending: ["در حال ثبت", "warning"],
    registered: ["ثبت شده", "success"],
    revoked: ["غیرفعال", "danger"],
  },
  deposit: {
    received: ["دریافت شد", "info"],
    credited: ["به موجودی اضافه شد", "success"],
    suspense: ["در حال بررسی", "warning"],
    refunded: ["برگشت داده شد", "neutral"],
    failed: ["ناموفق", "danger"],
  },
  ticket: {
    waiting_fund: ["در انتظار صندوق", "info"],
    waiting_applicant: ["در انتظار شما", "warning"],
    closed: ["بسته", "neutral"],
  },
  task: {
    open: ["باز", "info"],
    in_progress: ["در حال انجام", "info"],
    done: ["انجام شد", "success"],
    cancelled: ["لغو شده", "neutral"],
  },
};

export function statusOf(kind: keyof typeof VOCAB | string, key: string | null | undefined): [string, Tone] {
  if (!key) return ["—", "neutral"];
  return VOCAB[kind]?.[key] ?? COMMON[key] ?? [key, "neutral"];
}

export const ORG_ROLE_FA: Record<string, string> = { org_admin: "مدیر سازمان", preparer: "تهیه‌کننده", approver: "تأییدکننده", viewer: "مشاهده‌گر" };
export const STAFF_ROLE_FA: Record<string, string> = {
  super_admin: "مدیر سامانه", compliance_officer: "کارشناس انطباق", finance_officer: "کارشناس مالی", tokenisation_officer: "کارشناس توکن‌سازی",
  analyst: "کارشناس اعتباری", external_expert: "کارشناس بیرونی", technical_expert: "کارشناس فنی", committee_member: "عضو کمیته",
  fund_manager: "مدیر صندوق", credit_manager: "مدیر اعتبارات", ceo: "مدیرعامل صندوق", auditor: "حسابرس",
};
export const ACTIVITY_FA: Record<string, string> = {
  production_contracting: "تولیدی - پیمانکاری", production_line: "تولیدی - خط تولید", production_trading: "تولیدی - بازرگانی",
  services_contracting: "خدماتی - پیمانکاری", trading_contracting: "بازرگانی - پیمانکاری",
};
export const COLLATERAL_FA: Record<string, string> = { cheque: "چک و سفته", mortgage_2: "وثیقه‌ی ملکی درجه ۲", mortgage_1: "وثیقه‌ی ملکی درجه ۱" };
export const REVIEW_REASON_FA: Record<string, string> = {
  incomplete: "ناقص است", illegible: "خوانا نیست", no_stamp_or_signature: "مهر یا امضا ندارد", outdated_or_invalid: "قدیمی یا نامعتبر است",
  wrong_person: "مربوط به شخص دیگری است", other: "سایر",
};
export const STATEMENT_TYPE_FA: Record<string, string> = { audited: "حسابرسی‌شده", tax_return: "اظهارنامه‌ی مالیاتی", internal: "داخلی", balance_sheet: "فقط ترازنامه (آخرین سال)", trial_balance: "تراز آزمایشی سال جاری" };

/** Financial summary rows (doc 07 §5), grouped as in the fund's form. Values in million rials. */
export const FIN_GROUPS: [string, [string, string][]][] = [
  ["دارایی‌های جاری", [["cash", "موجودی نقد"], ["shortInvestments", "سرمایه‌گذاری کوتاه‌مدت"], ["receivables", "حساب‌ها و اسناد دریافتنی تجاری"], ["otherReceivables", "سایر دریافتنی‌ها"], ["inventory", "موجودی کالا"], ["prepayments", "پیش‌پرداخت‌ها"], ["otherCurrentAssets", "سایر دارایی‌های جاری"]]],
  ["دارایی‌های غیرجاری", [["tangibleFixed", "دارایی‌های ثابت مشهود"], ["intangible", "دارایی‌های نامشهود"], ["longInvestments", "سرمایه‌گذاری بلندمدت"], ["otherNonCurrent", "سایر دارایی‌های غیرجاری"], ["partnersCurrentAsset", "جاری شرکا (بدهکار)"]]],
  ["بدهی‌های جاری", [["payables", "حساب‌ها و اسناد پرداختنی تجاری"], ["otherPayables", "سایر پرداختنی‌ها"], ["shortLoans", "تسهیلات کوتاه‌مدت"], ["advancesReceived", "پیش‌دریافت‌ها"], ["otherCurrentLiabilities", "سایر بدهی‌های جاری"]]],
  ["بدهی‌های غیرجاری", [["longLoans", "تسهیلات بلندمدت"], ["longLiabilities", "سایر بدهی‌های بلندمدت"]]],
  ["حقوق مالکانه", [["capital", "سرمایه"], ["reserves", "اندوخته‌ها"], ["retainedEarnings", "سود (زیان) انباشته"], ["partnersCurrentEquity", "جاری شرکا (بستانکار)"]]],
  ["سود و زیان", [["sales", "فروش خالص"], ["cogs", "بهای تمام‌شده‌ی فروش"], ["sga", "هزینه‌های اداری، عمومی و فروش"], ["otherOperatingNet", "سایر درآمدها و هزینه‌های عملیاتی (خالص)"], ["financialCosts", "هزینه‌های مالی"], ["nonOperatingIncome", "درآمدهای غیرعملیاتی"], ["nonOperatingExpenses", "هزینه‌های غیرعملیاتی"]]],
];
export const FIN_TOTALS: [string, string][] = [
  ["currentAssets", "جمع دارایی‌های جاری"], ["totalAssets", "جمع دارایی‌ها"], ["currentLiabilities", "جمع بدهی‌های جاری"], ["totalLiabilities", "جمع بدهی‌ها"],
  ["equity", "جمع حقوق مالکانه"], ["balanceDifference", "اختلاف تراز (باید صفر باشد)"], ["grossProfit", "سود ناخالص"], ["operatingProfit", "سود عملیاتی"], ["profitBeforeTax", "سود قبل از مالیات"],
];
