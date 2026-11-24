# UX Spec v1 — Tokenization Platform (Phase 1)

_Date: 2026-11-04 · Companion to 02-prd-v1.md (FR IDs) and 04-integrations-jibit.md · Product language: Farsi (RTL), Jalali dates, Persian digits · Figma: https://www.figma.com/design/9pHyREdF55vvZKEEUHN1wE_

---

## 1. Design principles

1. Trust before beauty. Every number shows its source and status: "تأیید شده", "در انتظار", a verifiable on-chain link. No hidden fees, and no state is ever ambiguous.
2. Money actions are never one tap. Each one goes through Review → Confirm (OTP) → Receipt. Destructive or irreversible actions get a summary sheet that spells out what will happen.
3. The next step is always obvious. Home shows one primary "next action" (finish KYB, verify the bank account, deposit, approve a subscription…). The task inbox collects everything else.
4. Org-aware, role-aware. The same app adapts to the active organisation type (investor / issuer / both) and the member's role (admin / preparer / approver / viewer). Users never see actions they can't take; disabled states explain why.
5. Mobile-first, desktop-complete. The investor/issuer app is designed at 390 px and scales to tablet and desktop with a 2-column layout. The service app is desktop-first (1440 px) and usable on a tablet.
6. Farsi-native. Full RTL mirroring (navigation, progress, chevrons, charts). Persian digits in the UI. Amounts are shown in toman with rial available in tooltips and exports (configurable). Jalali dates everywhere.
7. Plain language. No crypto jargon in the investor UI. A token is a "واحد" (unit); the digital ID is "شناسه دیجیتال"; "blockchain record" becomes "سابقه ثبت‌شده عمومی" with a "مشاهده در بلاک‌چین" link.

---

## 2. Surfaces & information architecture

### 2.1 Public site (fund website): web, responsive

خانه | فرصت‌های سرمایه‌گذاری | تأمین مالی برای کسب‌وکارها | درباره صندوق | راهنما و پرسش‌ها | ورود / ثبت‌نام

- Home: hero ("تأمین مالی شفاف و قابل‌ردیابی برای طرح‌های فناورانه"), live stats, open and upcoming offerings, how it works (3 steps), trust strip (fund licence, guarantees, public ledger).
- Offering detail (public view): summary, terms, credit grade, guarantee summary, public documents, progress. Gated documents show a lock with "برای مشاهده، احراز هویت سازمان را تکمیل کنید".

### 2.2 App (investor + issuer), PWA

Header: org switcher (org name + avatar, ▾), notifications bell, tasks badge.

Bottom navigation (the first item sits on the right, RTL):

| Investor org | Issuer org | Both |
|---|---|---|
| خانه | خانه | خانه |
| فرصت‌ها | تأمین مالی (applications & series) | فرصت‌ها |
| سبد من (portfolio) | تعهدات (obligations) | سبد من |
| کیف پول (balance, deposit, withdraw) | کیف پول | تأمین مالی |
| بیشتر | بیشتر | بیشتر (includes کیف پول) |

بیشتر (More): کارها (tasks) · سازمان و اعضا · حساب‌های بانکی · شناسه دیجیتال · احراز هویت سازمان (KYB) · اسناد و قراردادها · اعلان‌ها · تنظیمات و امنیت (devices) · پشتیبانی · خروج.

Desktop (≥ 1024 px): the bottom nav becomes a right-side rail; content sits in 2 columns (main + context panel).

### 2.3 Service app (staff), desktop

Right sidebar, with sections shown according to the staff member's roles:

داشبورد

صف‌ها      ← احراز هویت (KYB) · حساب‌های بانکی · واریزهای معلق · برداشت‌ها

طرح‌ها و درخواست‌ها  ← pipeline (kanban) · ارزیابی اعتبار · بررسی دقیق (DD) · کمیته

سری‌ها     ← در حال پذیره‌نویسی · فعال · سررسید · نکول

خزانه      ← پرداخت به ناشر · اجرای پرداخت سود · انتقال‌ها · موجودی و مغایرت‌گیری

توکن‌سازی و بلاک‌چین ← صف توکن‌سازی · تراکنش‌ها · مغایرت دفتر/زنجیره · کیف کارمزد

سازمان‌ها و کاربران

گزارش‌ها

پیکربندی   ← قواعد غربال · کارت امتیاز اعتباری · ماتریس تضمین · کارمزدها · قالب پیامک

گزارش ممیزی (audit)

Top bar: global search (org, شناسه ملی, series code, Sheba, tx hash), "My tasks", environment badge (STAGING in amber).

---

## 3. Key flows (screens per step)

### F1 — Sign up & organisation onboarding

A-01 Welcome → A-02 Phone/email → A-03 OTP → A-04 Personal identity (national code → Shahkar) → A-05 Create or join org (شناسه ملی) → A-06 Onboarding checklist

The checklist (A-06) is the backbone. It shows 4 steps with statuses:

1. اطلاعات سازمان (auto-filled from the Jibit legal identity, user confirms) → A-07
2. اعضا و صاحبان امضا (signatories pulled from Jibit; user marks "this is me"; invite others) → A-08
3. حساب بانکی (Sheba → instant match result) → A-09
4. ارسال برای بررسی → submitted state, ETA "معمولاً تا ۲ روز کاری"

After approval: a celebration screen, "شناسه دیجیتال سازمان شما ساخته شد", with the address shown short (copy and explorer link) and a "واریز وجه" CTA.

### F2 — Deposit (payment ID)

#### A-20 Wallet → A-21 Deposit instructions

- Shows the collection Sheba, the bank and the شناسه پرداخت in large type with copy buttons, plus a warning: "فقط از حساب‌های تأییدشده سازمان واریز کنید؛ واریز از سایر حساب‌ها برگشت داده می‌شود".
- Lists the verified source accounts.
- Deposit timeline: "دریافت شد → در حال بررسی → به موجودی اضافه شد", or "برگشت داده شد" with the reason.

### F3 — Discover & subscribe

A-10 Offerings → A-11 Offering detail → A-12 Choose units → A-13 Review & consents → A-14 Send for approval / Confirm (OTP) → A-15 Receipt

- A-11 sections: key figures (rate, duration, maturity in Jalali, face value, minimum), progress bar + countdown, issuer card, guarantee & credit grade, payout example ("برای ۱۰ واحد در سررسید دریافت می‌کنید: …"), documents (lock icons where gated), under-subscription rule explained in one line.
- A-12: units stepper + amount + "موجودی کافی/ناکافی" + projected payout. If the balance is short: "واریز کنید" shortcut.
- A-13: three consent checkboxes, each with a "مشاهده" link (terms, risk disclosure, issuer visibility). The submit button is disabled until all are ticked.
- Preparer/approver: a preparer sees "ارسال برای تأیید" → the approver gets a task + push; in single-user mode → direct OTP confirm.

### F4 — Portfolio & payout

#### A-30 Portfolio → A-31 Holding detail

- A-30: total invested, expected return, next maturity; cards per series with a status chip (پذیره‌نویسی / فعال / سررسید شده / پرداخت شده / نکول).
- A-31: units, principal, frozen payout schedule (Jalali date, amount), maturity countdown, risk status, reports and material events, "مشاهده در بلاک‌چین", signed terms PDF.

### F5 — Withdraw

A-22 Withdraw amount → A-23 Choose verified account → A-24 Review → OTP → A-25 Status tracker The tracker steps are ثبت شد → تأیید سازمان → بررسی مالی → ارسال به بانک (پایا/ساتنا/داخلی, estimated time) → واریز شد, plus a receipt link.

### F6 — Issuer: apply for funding

A-40 Funding home → A-41 Issuer profile (once) → A-42 New application wizard (5 steps: طرح · مبلغ و شرایط · منبع بازپرداخت · تضامین پیشنهادی · مدارک) → A-43 Review & submit → A-44 Application tracker

- A-44: a stage tracker (ارسال → غربال → ارزیابی اعتباری → بررسی دقیق → کمیته → شرایط نهایی → امضا → توکن‌سازی → پذیره‌نویسی), current stage highlighted, open questions/tasks from the fund, decision + conditions, and "امضای دیجیتال شرایط" (Jibit signing link).
- A-45 Series dashboard (issuer): raised/target, investors list (D16), obligations calendar, the repayment payment ID, report-submission tasks.

### F7 — Tasks & approvals (everyone)

A-50 Tasks inbox (tabs: برای من · برای نقش من · انجام‌شده) → A-51 Task detail (linked object, comments, attachments, action buttons)

### F8 — Staff: application review → committee → listing

S-10 Pipeline (kanban by stage) → S-11 Application workspace (tabs: خلاصه · غربال · اعتبارسنجی · DD · تضامین · شرایط · تاریخچه) → S-12 Committee session (agenda + vote panel) → S-13 Terms & schedule preview → S-14 Tokenisation queue (two-party approval) → S-15 Series control (open/close/issue/disburse/payout)

### F9 — Staff: treasury & reconciliation

S-20 Deposits needing review (to-be-decided) → S-21 Withdrawals queue → S-22 Payout run (preview lines → approve) → S-23 Reconciliation dashboard (bank ↔ ledger ↔ chain, Jibit limits & fee balance)

---

## 4. Screen inventory

(✅ = drawn in Figma v1)

#### App (A-), mobile 390 × 844 base

| ID | Screen | Roles | PRD |
|---|---|---|---|
| A-01 | Welcome / value prop | public | — |
| A-02 | Enter phone or email | public | FR-AUTH-1 |
| A-03 ✅ | OTP verify | public | FR-AUTH-1 |
| A-04 | Personal identity (national code, Shahkar) | user | FR-AUTH-6 |
| A-05 | Create / join organisation | user | FR-ORG-1 |
| A-06 ✅ | Onboarding checklist | org_admin | FR-KYB-* |
| A-07 | Organisation details (auto-filled) | org_admin | FR-KYB-1,3 |
| A-08 | Signatories & members | org_admin | FR-KYB-2, FR-ORG-6 |
| A-09 | Bank accounts + add Sheba | org_admin | FR-BANK |
| A-0H ✅ | Home (dashboard) | all | — |
| A-10 ✅ | Offerings list (filters: باز · به‌زودی · تکمیل‌شده) | all | FR-OFF-1 |
| A-11 ✅ | Offering detail | all | FR-OFF-1,2 |
| A-12 | Choose units | preparer+ | FR-SUB-1 |
| A-13 ✅ | Review & consents | preparer+ | FR-SUB-2 |
| A-14 ✅ | Confirm (OTP sheet) | approver | FR-SUB-3 |
| A-15 | Receipt | all | — |
| A-20 | Wallet (balances + history) | all | FR-LED |
| A-21 ✅ | Deposit instructions (payment ID) | all | FR-DEP-1 |
| A-22..25 | Withdraw flow + tracker | preparer/approver | FR-WDR |
| A-26 | Transaction detail / statement | all | FR-LED-3 |
| A-30 | Portfolio | all | — |
| A-31 ✅ | Holding detail + schedule | all | FR-SER-3 |
| A-32 | Digital ID | all | FR-WAL-3 |
| A-40 | Funding home (issuer) | issuer | FR-ISS |
| A-41 | Issuer profile | issuer admin | FR-ISS-1 |
| A-42 | Application wizard (5 steps) | issuer preparer | FR-APP-1 |
| A-43 | Review & submit | issuer approver | FR-APP-2 |
| A-44 ✅ | Application tracker | issuer | FR-APP-4 |
| A-45 | Issuer series dashboard + investors | issuer | FR-CLS-5 |
| A-46 | Obligations & repayment | issuer | FR-PAY-1,2 |
| A-47 | Submit report / material event | issuer | FR-MON |
| A-50 ✅ | Tasks inbox | all | FR-TASK |
| A-51 | Task detail | all | FR-TASK |
| A-60 | Members & roles + invite | org_admin | FR-ORG-3 |
| A-61 | Documents & contracts | all | FR-DOC |
| A-62 | Notifications | all | FR-NOT |
| A-63 | Security & devices | all | FR-AUTH-3 |
| A-64 | Org settings (single-user mode) | org_admin | FR-ORG-5 |

#### Service app (S-), desktop 1440 × 900 base

| ID | Screen | Roles |
|---|---|---|
| S-01 | Dashboard (queues, KPIs, alerts) | all staff |
| S-02 ✅ | KYB queue + case review (Jibit checks side-by-side) | compliance |
| S-03 | Bank account exceptions | compliance |
| S-10 ✅ | Applications pipeline (kanban) | analyst, fund manager |
| S-11 | Application workspace (tabs) | analyst, expert (scoped) |
| S-12 | Committee session & voting | committee, fund manager |
| S-13 | Terms & schedule editor/preview | analyst, fund manager |
| S-14 | Tokenisation queue (two-party approval) | tokenisation, fund manager |
| S-15 | Series control centre | fund manager, finance |
| S-20 | Deposits review (to-be-decided) | finance, compliance |
| S-21 | Withdrawals & disbursements queue | finance, fund manager |
| S-22 | Payout run | finance, fund manager |
| S-23 | Reconciliation & treasury (Jibit balance, limits, fee balance, gas) | finance, tokenisation |
| S-24 | Chain transactions | tokenisation |
| S-30 | Organisations & users | compliance, super admin |
| S-40 | Reports | all (by role) |
| S-50 | Config (rules, scorecard, guarantee matrix, fees, templates) | fund manager, super admin |
| S-60 | Audit log | auditor, super admin |

#### Public site (W-)

W-01 Home · W-02 Offerings · W-03 Offering detail · W-04 Raise funds (for issuers) · W-05 How it works / FAQ · W-06 About the fund · W-07 Legal pages.

---

## 5. Visual design foundations

(Implemented in Figma as the Tokens variable collection + text styles.)

### 5.1 Colour (deep blue + grey, consistent with the fund prototype)

| Token | Hex | Use |
|---|---|---|
| primary-900 | #0A2A66 | headers, balance cards, sidebar |
| primary-700 | #0F3F99 | primary buttons, active nav |
| primary-500 | #2563EB | links, focus ring |
| primary-100 | #E6EEFC | selected backgrounds, highlight cards |
| neutral-900 | #0F172A | body text |
| neutral-600 | #475569 | secondary text |
| neutral-400 | #94A3B8 | placeholders, inactive icons |
| neutral-300 | #CBD5E1 | borders |
| neutral-100 | #F1F5F9 | app background |
| surface | #FFFFFF | cards |
| success-600 / -100 | #16A34A / #DCFCE7 | verified, paid, active |
| warning-600 / -100 | #B45309 / #FEF3C7 | pending, watch, expiring |
| danger-600 / -100 | #DC2626 / #FEE2E2 | rejected, default, failed |
| info-600 / -100 | #0369A1 / #E0F2FE | subscription open, informational |

Contrast: all text pairs meet WCAG AA (body text ≥ 4.5:1).

### 5.2 Typography

- Font: Vazirmatn (open source, OFL), with Persian (fa) digits.
- Text styles: Display 28/Bold · H1 22/Bold · H2 18/Bold · H3 16/SemiBold · Body 14/Regular (line height 170%) · Body Medium 14/Medium · Small 12/Regular · Small Medium 12/Medium · Number L 24/Bold · Button 14/SemiBold.
- Amounts: thousands separator ٬, unit "تومان" after the number.

### 5.3 Layout & shape

- 4-pt spacing grid (4, 8, 12, 16, 24, 32). Mobile margins 16. Card padding 16.
- Radius: 12 for cards, 10 for buttons and inputs, 999 for chips, 20 for the top corners of bottom sheets.
- Elevation: cards use a 1 px neutral-300 border; bottom sheets sit over a 45% scrim.
- Touch targets ≥ 44 px.

### 5.4 Core components

Built in Figma: Button (Primary / Secondary / Outline / Danger, Label property) · Status Chip (Neutral / Info / Success / Warning / Danger, Label property) · Bottom Nav (Active = Home / Offerings / Portfolio / Wallet / More) · App Header (Org name property) · Offering Card (Title, Issuer properties) · Service Sidebar · 22 icons (Icon/*). Still to build as components: Input (text, amount, Sheba, OTP, Jalali date) · Stepper (horizontal + vertical) · Bottom sheet · List row · Tabs · Empty state · Banner · Toast · Copy field · Document row · Data table · Kanban card · Vote panel · Diff/compare panel.

### 5.5 Status vocabulary (Farsi labels, used everywhere)

| Key | Label | Colour |
|---|---|---|
| draft | پیش‌نویس | neutral |
| pending_approval | در انتظار تأیید | warning |
| in_review | در حال بررسی | info |
| approved / verified | تأیید شده | success |
| rejected | رد شده | danger |
| subscription_open | در حال پذیره‌نویسی | info |
| active | فعال | success |
| matured | سررسید شده | warning |
| paid_out | پرداخت شده | success |
| cancelled | لغو شده | neutral |
| defaulted | نکول | danger |

### 5.6 Microcopy glossary

| Concept | Farsi |
|---|---|
| Token / unit | واحد |
| Series | سری (اوراق) / فرصت سرمایه‌گذاری |
| Subscription | پذیره‌نویسی |
| Issuer | ناشر / متقاضی تأمین مالی |
| Fund (sponsor) | صندوق (نهاد ارزیاب و ارائه‌دهنده) |
| Digital ID | شناسه دیجیتال |
| Payment ID | شناسه پرداخت |
| Maturity | سررسید |
| Guarantee | تضمین / ضمانت‌نامه |
| Credit grade | رتبه اعتباری |
| Under-subscription rule | قاعده عدم تکمیل پذیره‌نویسی: «همه یا هیچ» / «تأمین به میزان جذب‌شده» |
| Approve / prepare | تأیید / تهیه و ارسال برای تأیید |

## 6. Interaction rules

- Confirmation pattern: primary CTA → bottom sheet with a summary (what, amount, from/to, fees, what happens next) → OTP (6 boxes, auto-submit, resend timer 2:00) → result screen with a receipt.
- Disabled actions explain themselves: e.g. "برای پذیره‌نویسی ابتدا احراز هویت سازمان را تکمیل کنید" + link.
- Long processes show a tracker, never a spinner: KYB, deposit, withdrawal, application, series.
- Empty states carry a single CTA.
- Errors: inline for fields; a banner for server errors, with a support code (the request ID).
- Numbers: always formatted; amounts above 1 billion toman can be abbreviated ("۱٫۲ میلیارد تومان") with the full value in a tooltip/expand.
- Accessibility: labels on every input, focus states, screen-reader names for icons, no meaning carried by colour alone (chips have text).

---

## 7. Figma

- File: Tokenization Platform — UX v1 → https://www.figma.com/design/9pHyREdF55vvZKEEUHN1wE
- Pages:
  - 01 Foundations: colour variables, text styles, icons, Button / Status Chip / Bottom Nav / App Header components.
  - 02 App — Mobile (390 px): A-03 OTP · A-06 Onboarding checklist · A-0H Home · A-10 Offerings · A-11 Offering detail · A-13 Review & consents · A-14 OTP confirm sheet · A-21 Deposit (payment ID) · A-31 Holding detail · A-44 Issuer application tracker · A-50 Tasks. The Offering Card component sits to the left of the screens.
  - 03 Service app — Desktop (1440 px): S-10 Applications pipeline · S-02 KYB case review. The Service Sidebar component sits to the left of the screens.
- Next round: A-02/A-04/A-05/A-07–A-09 (onboarding details), A-12 units picker, A-22–25 withdraw, A-42 application wizard, A-45 issuer series dashboard, S-11 application workspace, S-12 committee, S-14 tokenisation queue, S-22 payout run, S-23 reconciliation, plus the public-site home.
