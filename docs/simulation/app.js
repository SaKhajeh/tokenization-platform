"use strict";
/* Simulator of the platform as built (main, 1405/09). State and rules mirror the code; the credit-limit numbers come from
   the real engine (packages/domain), bundled above as window.TP. */
const T = window.TP;
const fa = (x) => T.toPersianDigits(String(x));
const toman = (rials) => (rials === null || rials === undefined ? "—" : T.formatMoney(BigInt(rials), { unit: "toman", withUnit: true }));
const short = (rials) => { const t = Number(BigInt(rials) / 10n); const u = [[1e9, "میلیارد"], [1e6, "میلیون"]]; for (const [v, w] of u) if (Math.abs(t) >= v) return `${fa((t / v).toFixed(1).replace(/\.0$/, "").replace(".", "٫"))} ${w} تومان`; return toman(rials); };
const pct = (x) => (x === null || x === undefined || !isFinite(x) ? "—" : `${fa((x * 100).toFixed(1).replace(".", "٫"))}٪`);
const jd = (iso) => fa(T.isoToJalali(iso));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const R = (m) => T.toRials(m).toString();

const ROLES = {
  company: { fa: "شرکت (مدیر سازمان)", app: "اپ متقاضی", icon: "🏢" },
  compliance: { fa: "کارشناس انطباق", app: "پنل صندوق", icon: "🛡️" },
  analyst: { fa: "کارشناس اعتباری", app: "پنل صندوق", icon: "📊" },
  tech: { fa: "کارشناس فنی", app: "پنل صندوق", icon: "🔧" },
  creditmgr: { fa: "مدیر اعتبارات", app: "پنل صندوق", icon: "🗂️" },
  fm: { fa: "مدیر صندوق (مدیرعامل)", app: "پنل صندوق", icon: "👔" },
  finance: { fa: "کارشناس مالی", app: "پنل صندوق", icon: "💳" },
};
const ACTIVITY = { production_contracting: "تولیدی - پیمانکاری", production_line: "تولیدی - خط تولید", production_trading: "تولیدی - بازرگانی", services_contracting: "خدماتی - پیمانکاری", trading_contracting: "بازرگانی - پیمانکاری" };
const COLL = { cheque: "چک و سفته", mortgage_2: "وثیقه‌ی ملکی درجه ۲", mortgage_1: "وثیقه‌ی ملکی درجه ۱" };

function fresh() {
  return {
    date: "2026-11-28", role: "company", follow: true, step: "signup", otpShown: null, log: [],
    org: { name: "شرکت فناوران حسگر", nid: "10320145678", purposes: { invest: true, financing: true }, kyb: "not_started", bank: null, balance: 0n, hold: 0n, paymentId: "4012300987" },
    tariff: { feeTehran: 200000000n, feeOutside: 150000000n, appFee: 50000000n },
    exempt: { case_submission: false, after_screening: false },
    figures: { tb: 160000, y: [310000, 205000, 138000, 90000] },
    kase: { state: "none", sections: 0, docs: 0, docsTotal: 0, letterSigned: false, feePaid: false, returned: false, analyst: null, locked: false, visit: null, originals: false },
    score: { activity: "production_line", rc: "0.9", ra: "0.8", re: "0.7", tbChecked: false, result: null },
    round: null, limit: null, app: null, withdrawal: null, wd: null,
  };
}
let S = fresh();
const latest = () => Number(T.isoToJalali(S.date).slice(0, 4)) - 1;
const tbPeriod = () => T.trialBalancePeriod(S.date);
const log = (who, text, sys) => S.log.unshift({ who, text, sys, at: jd(S.date) });

/* ---------------------------------------------------------------- the engine: calculation A and B */
function year(sales) { return T.toFinancialYear({ cash: "116000", tangibleFixed: "141500", payables: "60000", longLoans: "62500", capital: "135000", sales: String(sales), cogs: String(Math.round(sales * 0.85)) }); }
function calc() {
  const v2 = { ...T.DEFAULT_SCORING_METHOD, ...T.SCORING_METHOD_V2_CHANGES, version: 2 };
  const g = { rc: Number(S.score.rc), ra: Number(S.score.ra), re: Number(S.score.re) };
  const L = latest();
  const run = (sales, ys) => { try { return { r: T.scoreCase({ activityType: S.score.activity, years: sales.map(year), guarantee: g }, v2), ys }; } catch (e) { return { err: e.problems || [String(e)] }; } };
  const a = run(S.figures.y, [L, L - 1, L - 2, L - 3]);
  const b = tbPeriod() ? run([S.figures.tb, ...S.figures.y.slice(0, 3)], [L + 1, L, L - 1, L - 2]) : { err: ["در بهار تراز آزمایشی پذیرفته نمی‌شود"] };
  const bHigher = !!(a.r && b.r && b.r.creditLimit > a.r.creditLimit);
  const chosen = bHigher && S.score.tbChecked ? "b" : "a";
  return { a, b, bHigher, chosen, pick: chosen === "b" ? b.r : a.r };
}
function periodsTable(x) {
  if (!x.r) return `<p class="muted">محاسبه نشد: ${esc(x.err.join("، "))}</p>`;
  const st = x.r.statements;
  return `<table class="t"><thead><tr><th>دوره</th><th>فروش (میلیون ریال)</th><th>حاشیه‌ی سود</th><th>رشد</th></tr></thead><tbody>${x.ys.map((y, i) => `
    <tr class="${y === latest() + 1 ? "tb" : ""}"><td>${y === latest() + 1 ? `تراز آزمایشی ${fa(y)}<div class="muted sm">${fa(tbPeriod().months)} ماه، سالانه نشده</div>` : `صورت مالی ${fa(y)}`}</td>
    <td class="n">${fa(Math.round(st[i].sales).toLocaleString("en").replace(/,/g, "٬"))}</td><td>${pct(x.r.ratios[i].profitability)}</td>
    <td>${i < st.length - 1 ? pct((st[i].sales - st[i + 1].sales) / st[i + 1].sales) : "—"}</td></tr>`).join("")}</tbody></table>`;
}
function twoCalcs(c) {
  const box = (t, sub, x, used) => `<div class="calc ${used ? "used" : ""}"><div class="row-b"><b>${t}</b>${used ? `<span class="chip ok">مبنای حد</span>` : ""}</div><div class="muted sm">${sub}</div>
    ${x.r ? `<div class="big">${short(R(x.r.creditLimit))}</div><div class="muted sm">رشد متوسط ${pct(x.r.avgGrowth)} — حاشیه‌ی وزنی ${pct(x.r.avgMargin)}</div>` : ""}${periodsTable(x)}</div>`;
  return `<div class="calcs">${box("محاسبه‌ی الف", "چهار سال صورت مالی", c.a, c.chosen === "a")}${box("محاسبه‌ی ب", "تراز آزمایشی + سه سال", c.b, c.chosen === "b")}</div>`;
}
function ceilings(r, edits) {
  return `<table class="t"><thead><tr><th>وثیقه</th><th>سقف ضمانت‌نامه</th><th>سقف تسهیلات</th></tr></thead><tbody>${Object.keys(COLL).map((k) => `
    <tr><td>${COLL[k]}</td><td>${edits ? `<input class="in" data-edit="g:${k}" value="${(BigInt(R(r.guarantee.ceiling[k])) / 10n).toString()}">` : short(R(r.guarantee.ceiling[k]))}</td>
    <td>${edits ? `<input class="in" data-edit="f:${k}" value="${(BigInt(R(r.facility.ceiling[k])) / 10n).toString()}">` : short(R(r.facility.ceiling[k]))}</td></tr>`).join("")}</tbody></table>`;
}

/* ---------------------------------------------------------------- steps: who acts, what they see, what they can do */
const STEPS = [
  { id: "signup", phase: "ثبت‌نام", title: "ورود یا ثبت‌نام با رمز یکبارمصرف", who: "company" },
  { id: "org", phase: "ثبت‌نام", title: "کد ملی (شاهکار)، ثبت سازمان و هدف", who: "company" },
  { id: "kyb", phase: "احراز هویت", title: "ارسال احراز هویت سازمان", who: "company" },
  { id: "kybReview", phase: "احراز هویت", title: "بررسی احراز هویت", who: "compliance" },
  { id: "bank", phase: "حساب و کیف پول", title: "حساب بانکی و واریز", who: "company" },
  { id: "caseFill", phase: "پرونده‌ی اعتباری", title: "تکمیل و ارسال پرونده", who: "company" },
  { id: "review", phase: "پرونده‌ی اعتباری", title: "بررسی مدارک و فرم", who: "analyst" },
  { id: "fix", phase: "پرونده‌ی اعتباری", title: "اصلاح موارد برگشتی", who: "company" },
  { id: "figures", phase: "بررسی صندوق", title: "تأیید و قفل ارقام مالی", who: "analyst" },
  { id: "visitPropose", phase: "بررسی صندوق", title: "پیشنهاد بازدید", who: "analyst" },
  { id: "visitConfirm", phase: "بررسی صندوق", title: "تأیید زمان بازدید", who: "company" },
  { id: "visitReport", phase: "بررسی صندوق", title: "گزارش بازدید و تحویل اصل مدارک", who: "tech" },
  { id: "scoring", phase: "تعیین حد", title: "محاسبه‌ی حد (الف و ب)", who: "analyst" },
  { id: "toFm", phase: "تعیین حد", title: "ارسال برای مدیر صندوق", who: "compliance" },
  { id: "fmDecide", phase: "تعیین حد", title: "تصمیم مدیر صندوق", who: "fm" },
  { id: "release", phase: "تعیین حد", title: "اعلام نتیجه به شرکت", who: "compliance" },
  { id: "limitSeen", phase: "تأمین مالی", title: "حد اعتباری و درخواست تأمین مالی", who: "company" },
  { id: "screening", phase: "تأمین مالی", title: "غربالگری درخواست", who: "analyst" },
  { id: "appFee", phase: "تأمین مالی", title: "پرداخت کارمزد درخواست", who: "company" },
  { id: "limitCheck", phase: "تأمین مالی", title: "بررسی حد برای طرح", who: "analyst" },
  { id: "next", phase: "بعد از این", title: "خدمات صندوق (هنوز ساخته نشده)", who: null },
];
const step = () => STEPS.find((s) => s.id === S.step);
function go(id, msg) { S.step = id; const s = step(); if (S.follow && s.who) S.role = s.who; if (msg) toast(msg); render(); }

/* OTP: the simulator shows the code that the real system would send by SMS */
function otpBox(purpose) {
  if (!S.otpShown || S.otpShown.p !== purpose) S.otpShown = { p: purpose, code: String(100000 + Math.floor(Math.random() * 899999)) };
  return `<div class="otp"><span class="muted sm">پیامک شبیه‌سازی‌شده: کد ${fa(S.otpShown.code)}</span><div class="row"><input class="in ltr" id="otp" maxlength="6" placeholder="کد ۶ رقمی" value="${S.otpShown.code}"><span class="muted sm">(برای سرعت، کد از پیش وارد شده است)</span></div></div>`;
}
const otpOk = () => document.getElementById("otp")?.value === S.otpShown?.code;

function screen() {
  const s = step(), k = S.kase;
  switch (S.step) {
    case "signup": return { body: `<p>ورود بدون رمز عبور: شماره‌ی همراه، سپس کد ۶ رقمی. این مرورگر به عنوان دستگاه کاربر ثبت می‌شود.</p>
      <label class="lb">شماره‌ی همراه<input class="in ltr" value="09121234567" id="mob"></label>${otpBox("login")}`,
      actions: [["ورود", () => { if (!otpOk()) return toast("کد نادرست است"); log("company", "ورود با رمز یکبارمصرف", "نشست ۱۵ دقیقه‌ای و توکن تمدید صادر شد"); go("org"); }]] };
    case "org": return { body: `<label class="lb">کد ملی<input class="in ltr" value="0012345678"></label>
      <p class="muted sm">تطبیق کد ملی با شماره‌ی همراه در شاهکار (جیبیت).</p>
      <label class="lb">نام ثبتی شرکت<input class="in" id="oname" value="${esc(S.org.name)}"></label><label class="lb">شناسه‌ی ملی<input class="in ltr" value="${S.org.nid}"></label>
      <div class="box"><b>این سازمان در سامانه چه می‌کند؟</b>
      <label class="ck"><input type="checkbox" id="pi" ${S.org.purposes.invest ? "checked" : ""}> سرمایه‌گذاری</label>
      <label class="ck"><input type="checkbox" id="pf" ${S.org.purposes.financing ? "checked" : ""}> دریافت تأمین مالی</label>
      <p class="note">${esc(T.ASSESSMENT_DISCLAIMER_FA)}</p></div>`,
      actions: [["ثبت و ادامه", () => { S.org.name = document.getElementById("oname").value; S.org.purposes = { invest: document.getElementById("pi").checked, financing: document.getElementById("pf").checked };
        log("company", `شاهکار تأیید شد؛ «${S.org.name}» ثبت شد`, "کاربر، مدیر سازمان شد"); go("kyb"); }]] };
    case "kyb": return { body: `<div class="box"><b>سوابق ثبتی (استعلام جیبیت)</b><p class="muted sm">نام، شماره‌ی ثبت، وضعیت، صاحبان امضا و مدیران از سامانه‌ی ثبت؛ چک برگشتی هم استعلام می‌شود.</p></div>
      <p>اطلاعات تماس، اساسنامه، روزنامه‌ی رسمی و — اگر نام شما در فهرست مدیران نیست — معرفی‌نامه.</p>${otpBox("kyb")}`,
      actions: [["ارسال با رمز یکبارمصرف", () => { if (!otpOk()) return toast("کد نادرست است"); S.org.kyb = "in_review";
        if (S.org.purposes.financing) { S.kase.state = "in_preparation"; log("company", "احراز هویت ارسال شد", "پرونده‌ی اعتباری خودکار باز شد و از اطلاعات ثبت‌نام پر شد؛ کار برای کارشناس انطباق"); }
        else log("company", "احراز هویت ارسال شد", "کار برای کارشناس انطباق");
        go("kybReview"); }]] };
    case "kybReview": return { body: `<div class="two"><div class="box"><b>سامانه‌ی ثبت</b><p class="sm">نام، شناسه، وضعیت «فعال»، صاحبان امضا</p></div><div class="box"><b>اظهار شرکت</b><p class="sm">نشانی، کد پستی، تلفن؛ تفاوت‌ها برجسته می‌شوند</p></div></div>
      <p class="note">هشدارهای استعلام (مثلاً نماینده با معرفی‌نامه) رد خودکار ندارند؛ تصمیم با کارشناس است.</p>`,
      actions: [["تأیید و صدور شناسه‌ی دیجیتال", () => { S.org.kyb = "approved"; log("compliance", "احراز هویت تأیید شد", "شناسه‌ی دیجیتال در صف زنجیره (پالیگان) قرار گرفت و ثبت شد؛ اعتبار ۱۲ ماه"); go("bank"); }],
        ["درخواست اطلاعات بیشتر", () => { log("compliance", "اطلاعات بیشتر خواسته شد", "پیامک به شرکت"); S.org.kyb = "info_requested"; go("kyb", "شرکت باید دوباره ارسال کند"); }, "ghost"]] };
    case "bank": return { body: `<label class="lb">شبای حساب شرکت<input class="in ltr" value="IR820540102680020817909002"></label>
      <p class="muted sm">جیبیت مالکیت شبا را با شناسه‌ی ملی شرکت تطبیق می‌دهد؛ برداشت به حساب جدید پس از ۲۴ ساعت ممکن است.</p>
      <div class="box"><b>واریز با شناسه‌ی پرداخت</b><p>شناسه‌ی پرداخت: <b class="ltr">${fa(S.org.paymentId)}</b> — حساب جمع‌آوری صندوق</p>
      <p class="muted sm">واریز از حساب تأییدشده با شناسه‌ی درست ← موجودی؛ مغایرت ← بررسی انطباق؛ شناسه‌ی ناشناخته ← برگشت.</p>
      <label class="lb">مبلغ واریز آزمایشی (تومان)<input class="in ltr" id="dep" value="50000000"></label></div>`,
      actions: [["ثبت حساب و شبیه‌سازی واریز", () => { S.org.bank = "verified"; const d = BigInt(document.getElementById("dep").value.replace(/\D/g, "") || "0") * 10n; S.org.balance += d;
        log("company", "حساب بانکی با رمز یکبارمصرف اضافه و خودکار تأیید شد", `واریز ${toman(d)} با شناسه‌ی پرداخت تأیید و به موجودی اضافه شد (دفتر کل دوطرفه)`);
        go(S.org.purposes.financing ? "caseFill" : "next"); }]] };
    case "caseFill": case "fix": {
      const L = latest(), tb = tbPeriod();
      const slots = T.expectedSlots({ people: [{ national_id: "0012345678", name: "سارا احمدی", roles: ["ceo", "board", "shareholder"] }, { national_id: "0712345671", name: "رضا کریمی", roles: ["board", "shareholder"] }], latestFiscalYear: L, locations: [{ id: "L1", usage: "head_office", address: "تهران" }], banks: [{ id: "B1", name: "ملت" }], trialBalanceDue: !!tb });
      k.docsTotal = slots.filter((x) => x.required === "yes").length;
      const fee = S.exempt.case_submission ? 0n : S.tariff.feeTehran;
      const blockers = [];
      if (k.sections < 9) blockers.push(`فرم اطلاعات: ${fa(9 - k.sections)} بخش ناقص`);
      if (k.docs < k.docsTotal) blockers.push(`مدارک: ${fa(k.docsTotal - k.docs)} مورد بارگذاری نشده`);
      if (!S.figuresIn) blockers.push(tb ? "ارقام تراز آزمایشی و چهار سال صورت مالی" : "ارقام چهار سال صورت مالی");
      if (!k.letterSigned) blockers.push("درخواست‌نامه امضا نشده است");
      if (fee > 0n && !k.feePaid) blockers.push(`کارمزد ارزیابی (${toman(fee)}) پرداخت نشده است`);
      if (S.step === "fix" && !k.fixed) blockers.push("مدرک برگشتی (گواهی ثنا) اصلاح نشده است");
      return { body: `<p class="note">${esc(T.ASSESSMENT_DISCLAIMER_FA)}</p>
        ${S.step === "fix" ? `<div class="warn">صندوق «گواهی ثنا — رضا کریمی» را برای اصلاح برگرداند: «تصویر خوانا نیست».</div><button class="btn sec" data-a="fixDoc">بارگذاری دوباره‌ی مدرک</button>` : ""}
        <div class="grid3"><div class="box"><b>فرم اطلاعات</b><p>${fa(k.sections)} از ۹ بخش</p><button class="btn sec" data-a="sections">تکمیل همه‌ی بخش‌ها (نمونه)</button></div>
        <div class="box"><b>مدارک</b><p>${fa(k.docs)} از ${fa(k.docsTotal)} مورد الزامی</p><button class="btn sec" data-a="docs">بارگذاری همه (نمونه)</button>
          <p class="muted sm">شامل اظهارنامه‌ی مالیاتی ۴ سال (یا نامه با دلیل)، شناسنامه همه‌ی صفحات و کارت ملی پشت و رو، ${tb ? "تراز آزمایشی شش‌ستونی در سه سطح، " : ""}کاتالوگ الزامی، راهنمای اعتباریتو.</p></div>
        <div class="box"><b>ارقام مالی (میلیون ریال)</b>
          ${tb ? `<label class="lb sm">فروش در تراز آزمایشی (${fa(tb.label)})<input class="in ltr" data-fig="tb" value="${S.figures.tb}"></label>` : `<p class="muted sm">بهار: تراز آزمایشی پذیرفته نمی‌شود؛ فقط چهار سال.</p>`}
          ${S.figures.y.map((v, i) => `<label class="lb sm">فروش صورت مالی ${fa(L - i)}<input class="in ltr" data-fig="y${i}" value="${v}"></label>`).join("")}
          <button class="btn sec" data-a="figs">ثبت ارقام</button></div></div>
        <div class="row">${k.letterSigned ? `<span class="chip ok">درخواست‌نامه امضا شد</span>` : `<button class="btn sec" data-a="letter">امضای درخواست‌نامه (رمز یکبارمصرف)</button>`}
        ${fee === 0n ? `<span class="chip ok">${S.exempt.case_submission ? "معاف از کارمزد ارزیابی" : "بدون کارمزد"}</span>` : k.feePaid ? `<span class="chip ok">کارمزد پرداخت شد</span>` : `<button class="btn sec" data-a="fee">پرداخت کارمزد از موجودی (${toman(fee)})</button>`}</div>
        ${blockers.length ? `<div class="warn"><b>پیش از ارسال:</b><ul>${blockers.map((b) => `<li>${b}</li>`).join("")}</ul></div>` : `<div class="okbox">پرونده آماده‌ی ارسال است.</div>`}`,
        actions: [[S.step === "fix" ? "ارسال دوباره (رمز یکبارمصرف)" : "ارسال پرونده با تعهدنامه (رمز یکبارمصرف)", () => { if (blockers.length) return toast("موارد مانع ارسال برطرف نشده است");
          const again = S.step === "fix"; S.kase.state = again ? "resubmitted" : "submitted"; log("company", again ? "پرونده دوباره ارسال شد" : "پرونده با تعهدنامه ارسال شد", "در صف کارشناسان اعتباری؛ مدیر اعتبارات می‌تواند واگذار کند"); go("review"); }]] };
    }
    case "review": return { body: `<p>کارشناس هر مدرک را در نمایشگر کنار فهرست می‌بیند (هر بار نمایش در سابقه‌ی دسترسی ثبت می‌شود) و هر بخش فرم را می‌پذیرد یا برمی‌گرداند.</p>
      ${S.kase.analyst ? `<p class="sm">کارشناس مسئول: <b>${esc(S.kase.analyst)}</b> (واگذاری مدیر اعتبارات)</p>` : ""}
      ${!S.kase.returned ? `<p class="muted sm">برای دیدن مسیر بازگشت، یک مدرک را «نیاز به اصلاح» بزنید.</p>` : ""}`,
      actions: [["پذیرش همه و «مدارک کامل است»", () => { S.kase.state = "documents_complete"; log("analyst", "مدارک و فرم پذیرفته شد", "مرحله‌ی بازدید و ارقام"); go("figures"); }],
        ...(!S.kase.returned ? [["یک مدرک «نیاز به اصلاح» و بازگرداندن", () => { S.kase.returned = true; S.kase.state = "returned"; log("analyst", "گواهی ثنا برای اصلاح برگشت", "پیامک و کار برای شرکت"); go("fix"); }, "ghost"]] : [])] };
    case "figures": return { body: `<p>کارشناس ارقام اظهارشده را با صورت‌های مالی بارگذاری‌شده تطبیق می‌دهد؛ هر تغییر با دلیل و نگه‌داشتن رقم اولیه ثبت می‌شود. پیش از محاسبه، ارقام قفل می‌شوند.</p>`,
      actions: [["تأیید و قفل ارقام", () => { S.kase.locked = true; log("analyst", "ارقام تأییدشده قفل شد"); go("visitPropose"); }]] };
    case "visitPropose": return { body: `<label class="lb">تاریخ پیشنهادی<input class="in ltr" value="${jd(new Date(Date.parse(S.date) + 86400000 * 3).toISOString().slice(0, 10))}"></label><label class="lb">بازدیدکننده<select class="in"><option>کارشناس فنی</option></select></label>
      <div class="box sm"><b>متن ارسالی به شرکت:</b> ${esc(T.VISIT_INSTRUCTIONS_FA)}</div>`,
      actions: [["ارسال پیشنهاد به شرکت", () => { S.kase.visit = "proposed"; log("analyst", "زمان بازدید پیشنهاد شد", "پیامک به شرکت با متن حضور مدیرعامل و نیروی فنی/مالی"); go("visitConfirm"); }]] };
    case "visitConfirm": return { body: `<div class="warn sm">${esc(T.VISIT_INSTRUCTIONS_FA)}</div><p>شرکت زمان را تأیید می‌کند یا زمان دیگری می‌خواهد (تیکت).</p>`,
      actions: [["تأیید زمان بازدید", () => { S.kase.visit = "confirmed"; log("company", "زمان بازدید تأیید شد"); go("visitReport"); }]] };
    case "visitReport": return { body: `<label class="lb">یافته‌ها<textarea class="in">خط تولید فعال، ۳۰ نفر نیرو، انبار مطابق اظهار.</textarea></label><p class="muted sm">اصل اجازه‌نامه‌های استعلام هم در بازدید تحویل گرفته و ثبت می‌شود.</p>`,
      actions: [["ثبت گزارش و تحویل اصل مدارک", () => { S.kase.visit = "done"; S.kase.originals = true; log("tech", "گزارش بازدید و تحویل اصل مدارک ثبت شد", "پرونده آماده‌ی محاسبه‌ی حد"); go("scoring"); }]] };
    case "scoring": { const c = calc(); return { body: `<div class="grid3">
      <label class="lb">نوع فعالیت<select class="in" data-s="activity">${Object.entries(ACTIVITY).map(([v, l]) => `<option value="${v}" ${S.score.activity === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      ${["rc", "ra", "re"].map((x) => `<label class="lb">${x.toUpperCase()}<input class="in ltr" data-s="${x}" value="${S.score[x]}"></label>`).join("")}</div>
      ${twoCalcs(c)}
      ${c.bHigher ? `<div class="warn"><label class="ck"><input type="checkbox" data-a="tbcheck" ${S.score.tbChecked ? "checked" : ""}> تراز آزمایشی را با اظهارنامه‌ی مالیاتی و سایر مدارک تطبیق دادم (لازم برای مبنا شدن محاسبه‌ی ب).</label></div>` : `<p class="muted sm">${tbPeriod() ? "محاسبه‌ی ب کمتر یا برابر است؛ محاسبه‌ی الف مبناست." : "بهار: فقط محاسبه‌ی الف."}</p>`}
      <p class="muted sm">اعداد با موتور واقعی سامانه (روش نسخه‌ی ۲: وزن‌های ۰٫۴/۰٫۳/۰٫۲/۰٫۱) محاسبه می‌شوند.</p>`,
      actions: [["ثبت دور محاسبه و ارسال برای کارشناس انطباق", () => { if (!c.pick) return toast("ورودی‌ها نامعتبر است"); S.score.result = c; S.round = { state: "pending_approval", preparedBy: "analyst" };
        S.kase.state = "pending_approval"; log("analyst", `دور محاسبه ثبت شد: ${short(R(c.pick.creditLimit))} (محاسبه‌ی ${c.chosen === "a" ? "الف" : "ب"})`, "کار برای کارشناس انطباق؛ شرکت «در انتظار تصمیم صندوق» می‌بیند"); go("toFm"); }]] }; }
    case "toFm": return { body: `${twoCalcs(S.score.result)}<label class="lb">نظر کارشناس انطباق برای مدیر صندوق<textarea class="in" id="cmt">مدارک و ارقام کامل است؛ کمیته‌ی اعتباری حد را بررسی کرد.</textarea></label>
      <p class="muted sm">کارشناس انطباق نمی‌تواند دوری را که خودش آماده کرده جلو ببرد.</p>`,
      actions: [["ارسال برای مدیر صندوق", () => { S.round.state = "ceo_review"; S.round.comment = document.getElementById("cmt").value; log("compliance", "برای مدیر صندوق ارسال شد", "کار برای مدیر صندوق"); go("fmDecide"); }],
        ["بازگشت به کارشناس", () => { S.round = null; S.kase.state = "sent_back_to_analyst"; log("compliance", "به کارشناس برگشت", "کار بازنگری برای کارشناس"); go("scoring"); }, "ghost"]] };
    case "fmDecide": return { body: `${twoCalcs(S.score.result)}<p class="sm"><b>نظر کارشناس انطباق:</b> ${esc(S.round.comment || "")}</p>
      <label class="ck"><input type="checkbox" id="mt"> <b>جلسه‌ی کمیته برای تعیین سقف این پرونده برگزار شده است.</b></label>
      <label class="lb">تاریخ جلسه<input class="in ltr" value="${jd(S.date)}"></label>
      <p class="lb">سقف‌ها (تومان) — قابل ویرایش</p>${ceilings(S.score.result.pick, true)}
      <label class="lb">نظر مدیر صندوق<textarea class="in" id="fmc">جلسه‌ی کمیته برگزار شد؛ حد پیشنهادی تأیید می‌شود.</textarea></label>`,
      actions: [["پذیرش (رمز یکبارمصرف)", () => decideFm("accept")], ["رد درخواست", () => decideFm("decline"), "danger"]] };
    case "release": return { body: `<p>تصمیم مدیر صندوق: ${S.round.decision === "accept" ? `<span class="chip ok">پذیرش</span>` : `<span class="chip bad">رد</span>`} — ${esc(S.round.fmComment)}</p>
      ${S.round.decision === "accept" ? `<p class="sm">حد نهایی: <b>${toman(S.round.limit)}</b>${S.round.edited ? " (ویرایش‌شده توسط مدیر صندوق)" : ""}</p>` : ""}
      <label class="lb">توضیح برای شرکت<textarea class="in" id="rel">${S.round.decision === "accept" ? "حد اعتباری با چک و سفته تعیین شد؛ برای افزایش، وثیقه‌ی ملکی پیشنهاد دهید." : "در این مرحله حد اعتباری تعیین نشد."}</textarea></label>`,
      actions: [["اعلام به شرکت", () => { const note = document.getElementById("rel").value; if (S.round.decision === "accept") {
        S.limit = { limit: S.round.limit, used: 0n, norm: S.round.norm, ra: Number(S.score.ra), re: Number(S.score.re), validTo: T.isoToJalali(new Date(Date.parse(S.date) + 365 * 86400000).toISOString().slice(0, 10)), note, collateral: "cheque" };
        S.kase.state = "limit_issued"; S.round.state = "approved"; log("compliance", "نتیجه به شرکت اعلام شد", `حد اعتباری ${toman(S.limit.limit)} صادر شد، ۱۲ ماه اعتبار؛ پیامک به شرکت`); go("limitSeen"); }
        else { S.kase.state = "declined"; S.round.state = "declined"; log("compliance", "رد به شرکت اعلام شد", "پیامک با توضیح"); go("next"); } }]] };
    case "limitSeen": { const L2 = S.limit; return { body: `<div class="hero"><div class="muted sm">حد اعتباری با ${COLL[L2.collateral]}</div><div class="big">${short(L2.limit)}</div><div class="muted sm">قابل استفاده: ${toman(L2.limit - L2.used)} — تا ${fa(L2.validTo)}</div></div>
      <p class="sm">یادداشت صندوق: ${esc(L2.note)}</p><p class="note">${esc(T.ASSESSMENT_DISCLAIMER_FA)}</p>
      <div class="box"><b>درخواست تأمین مالی (۵ مرحله)</b><p class="muted sm">طرح و شاهد آغاز آن، مبلغ تعهدآور در سقف حد، منبع بازپرداخت، تضامین، مدارک؛ تهیه‌کننده ← تأییدکننده با رمز یکبارمصرف.</p>
      <label class="lb">مبلغ (تومان)<input class="in ltr" id="amt" value="2000000000"></label></div>`,
      actions: [["ارسال درخواست", () => { const a = BigInt(document.getElementById("amt").value.replace(/\D/g, "") || "0") * 10n; if (a > L2.limit - L2.used) return toast("مبلغ از حد قابل استفاده بیشتر است");
        S.app = { amount: a, state: "submitted" }; log("company", `درخواست تأمین مالی ${toman(a)} ارسال شد`, "کار غربالگری برای کارشناس"); go("screening"); }]] }; }
    case "screening": return { body: `<p>چک‌لیست غربالگری: طرح آغاز شده و شاهد دارد، مبلغ مجاز، متقاضی مسدود نیست، حوزه مجاز، منبع بازپرداخت روشن.</p>`,
      actions: [["قبول", () => { const fee = S.exempt.after_screening ? 0n : S.tariff.appFee; if (fee > 0n) { S.app.state = "awaiting_payment"; log("analyst", "غربالگری قبول شد", `صورتحساب کارمزد درخواست ${toman(fee)} صادر شد`); go("appFee"); }
        else { S.app.state = "credit_assessment"; log("analyst", "غربالگری قبول شد", S.exempt.after_screening ? "شرکت از کارمزد درخواست معاف است" : "بدون کارمزد"); go("limitCheck"); } }],
        ["بازگشت با کار برای شرکت", () => { log("analyst", "درخواست برای تکمیل برگشت", "کار برای شرکت؛ پس از انجام، ارسال دوباره"); toast("در سامانه‌ی واقعی شرکت کار را انجام می‌دهد و دوباره می‌فرستد"); }, "ghost"]] };
    case "appFee": { const fee = S.tariff.appFee; return { body: `<p>کارمزد درخواست: <b>${toman(fee)}</b> — موجودی: ${toman(S.org.balance)}</p>`,
      actions: [["پرداخت از موجودی (رمز یکبارمصرف)", () => { if (S.org.balance < fee) return toast("موجودی کافی نیست؛ واریز کنید یا مدیر صندوق معاف کند"); S.org.balance -= fee; S.app.state = "credit_assessment"; log("company", "کارمزد درخواست پرداخت شد", "سهم صندوق و پلتفرم در دفتر کل"); go("limitCheck"); }]] }; }
    case "limitCheck": { const L2 = S.limit; const ra = S.pra ?? "0.9", re = S.pre ?? "0.8";
      const ceiling = (L2.norm * BigInt(Math.round(Number(ra) * 1000)) * BigInt(Math.round(Number(re) * 1000))) / 1000000n;
      return { body: `<p>سقف طرح = نُرم باقی‌مانده × Ra × Re طرح. چیزی رزرو نمی‌شود؛ کسر از حد هنگام تأیید نهایی تأمین مالی است.</p>
      <div class="grid3"><label class="lb">Ra طرح<input class="in ltr" data-p="ra" value="${ra}"></label><label class="lb">Re طرح<input class="in ltr" data-p="re" value="${re}"></label></div>
      <p>نُرم باقی‌مانده: ${short(L2.norm)} — سقف طرح: <b>${toman(ceiling)}</b> — درخواست ${toman(S.app.amount)}: ${S.app.amount <= ceiling ? `<span class="chip ok">در سقف است</span>` : `<span class="chip bad">بیش از سقف</span>`}</p>`,
      actions: [["ثبت بررسی حد", () => { if (S.app.amount > ceiling) { log("analyst", "بیش از سقف طرح", "درخواست در همین مرحله می‌ماند"); return render(); } S.app.state = "due_diligence"; log("analyst", "بررسی حد: در سقف است", "درخواست به «بررسی دقیق» رفت — مراحل بعد هنوز ساخته نشده"); go("next"); }]] }; }
    case "next": return { body: `<div class="okbox"><b>تا اینجا همه‌ی آنچه ساخته شده شبیه‌سازی شد.</b></div>
      <p>مراحل بعدی که هنوز ساخته نشده‌اند (D-C22 و خدماتی که صندوق تعریف می‌کند): بررسی دقیق، کمیته، قرارداد تأمین مالی و امضای دیجیتال، شرایط سری و دو نرخ، توکن‌سازی، پذیره‌نویسی سرمایه‌گذاران، پرداخت به شرکت، بازپرداخت و پرداخت سود.</p>
      <p class="muted sm">از «ابزارهای صندوق» در کنار صفحه می‌توانید تغییر حد، معافیت کارمزد، واگذاری پرونده و برداشت را هم امتحان کنید.</p>`, actions: [["شروع دوباره", () => { const d = S.date; S = fresh(); S.date = d; render(); }]] };
  }
}
function decideFm(decision) {
  if (!document.getElementById("mt").checked) return toast("ابتدا برگزاری جلسه‌ی کمیته را تأیید کنید");
  const pick = S.score.result.pick; const computed = BigInt(R(pick.creditLimit));
  const gv = document.querySelector('[data-edit="g:cheque"]').value.replace(/\D/g, ""); const edited = BigInt(gv || "0") * 10n;
  const limit = edited > 0n ? edited : computed;
  S.round = { ...S.round, state: decision === "accept" ? "ceo_accepted" : "ceo_declined", decision, fmComment: document.getElementById("fmc").value, limit, edited: limit !== computed,
    norm: (BigInt(R(pick.normCeiling)) * limit) / (computed || 1n) };
  log("fm", decision === "accept" ? `پذیرش با رمز یکبارمصرف${S.round.edited ? " (سقف ویرایش شد)" : ""}` : "رد درخواست", "برگزاری جلسه‌ی کمیته ثبت شد؛ کار برای کارشناس انطباق");
  go("release");
}

/* ---------------------------------------------------------------- fund tools (any time, by role) */
function tools() {
  const t = [];
  t.push(["fm", "معافیت از کارمزد ارزیابی", S.exempt.case_submission ? "لغو" : "اعمال", () => { S.exempt.case_submission = !S.exempt.case_submission; log("fm", S.exempt.case_submission ? "شرکت از کارمزد ارزیابی معاف شد (رمز یکبارمصرف)" : "معافیت لغو شد"); render(); }]);
  t.push(["fm", "معافیت از کارمزد درخواست", S.exempt.after_screening ? "لغو" : "اعمال", () => { S.exempt.after_screening = !S.exempt.after_screening; log("fm", S.exempt.after_screening ? "شرکت از کارمزد درخواست معاف شد" : "معافیت لغو شد"); render(); }]);
  if (["submitted", "resubmitted", "document_review", "returned"].includes(S.kase.state)) t.push(["creditmgr", "واگذاری پرونده به کارشناس", "واگذاری", () => { S.kase.analyst = "کارشناس اعتباری ۲"; log("creditmgr", "پرونده به «کارشناس اعتباری ۲» واگذار شد"); render(); }]);
  if (S.limit) t.push(["fm", "تغییر حد: Ra=۰٫۶ و وثیقه‌ی ملکی درجه ۱", "اعمال", () => {
    const v2 = { ...T.DEFAULT_SCORING_METHOD, ...T.SCORING_METHOD_V2_CHANGES, version: 2 }; const c = S.score.result;
    const years = c.chosen === "b" ? [S.figures.tb, ...S.figures.y.slice(0, 3)] : S.figures.y;
    const r = T.scoreCase({ activityType: S.score.activity, years: years.map(year), guarantee: { rc: Number(S.score.rc), ra: 0.6, re: Number(S.score.re) } }, v2);
    const before = S.limit.limit; S.limit.limit = BigInt(R(r.guarantee.ceiling.mortgage_1)); S.limit.collateral = "mortgage_1"; S.limit.norm = (BigInt(R(r.normCeiling)) * BigInt(R(r.guarantee.ceiling.mortgage_1))) / BigInt(R(r.guarantee.ceiling.cheque));
    log("fm", `حد بازنگری شد: ${short(before)} ← ${short(S.limit.limit)}`, "حد قبلی در سابقه ماند؛ پیامک به شرکت"); render(); }]);
  if (S.org.bank && S.org.balance > 0n && !S.wd) t.push(["company", "درخواست برداشت ۱ میلیون تومان", "ثبت", () => { S.wd = "requested"; S.org.balance -= 10000000n; S.org.hold = 10000000n; log("company", "درخواست برداشت ثبت شد (تهیه‌کننده)", "مبلغ در «در حال برداشت» نگه داشته شد"); render(); }]);
  if (S.wd === "requested") t.push(["company", "تأیید برداشت (تأییدکننده)", "تأیید", () => { S.wd = "org_approved"; log("company", "برداشت با رمز یکبارمصرف تأیید شد", "صف واحد مالی"); render(); }]);
  if (S.wd === "org_approved") t.push(["finance", "بررسی و صف برداشت", "صف", () => { S.wd = "queued"; log("finance", "برداشت در صف مالی", "زیر ۱۰ میلیارد ریال: بدون تأیید مدیر صندوق"); render(); }]);
  if (S.wd === "queued") t.push(["finance", "ارسال به بانک (کوبانک جیبیت)", "ارسال", () => { S.wd = "completed"; S.org.hold = 0n; log("finance", "برداشت ارسال و انجام شد", "شناسه‌ی پیگیری جیبیت = شناسه‌ی برداشت؛ تکرار ارسال ممکن نیست"); render(); }]);
  return t;
}

/* ---------------------------------------------------------------- render */
let toastT;
function toast(m) { const el = document.getElementById("toast"); el.textContent = m; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), 2600); }
const CASE_FA = { none: "—", in_preparation: "در حال تکمیل", submitted: "ارسال شده", resubmitted: "ارسال مجدد", returned: "بازگشت برای اصلاح", document_review: "بررسی مدارک", documents_complete: "مدارک کامل", sent_back_to_analyst: "بازگشت به کارشناس", pending_approval: "در انتظار تصمیم صندوق", limit_issued: "حد اعتباری صادر شد", declined: "رد شده" };
const ROUND_FA = { pending_approval: "نزد کارشناس انطباق", ceo_review: "نزد مدیر صندوق", ceo_accepted: "پذیرش؛ آماده‌ی اعلام", ceo_declined: "رد؛ آماده‌ی اعلام", approved: "اعلام شد", declined: "رد اعلام شد" };
const APP_FA = { submitted: "غربالگری", awaiting_payment: "در انتظار کارمزد", credit_assessment: "بررسی حد اعتباری", due_diligence: "بررسی دقیق (ساخته نشده)" };
const WD_FA = { requested: "ثبت شد", org_approved: "تأیید سازمان", queued: "صف مالی", completed: "واریز شد" };

function render() {
  const s = step(), sc = screen();
  const tb = tbPeriod();
  document.getElementById("season").innerHTML = tb ? `تراز آزمایشی: ${fa(tb.label)}` : "بهار: تراز آزمایشی پذیرفته نمی‌شود";
  document.getElementById("simdate").value = T.isoToJalali(S.date);
  document.getElementById("follow").checked = S.follow;
  document.getElementById("roles").innerHTML = Object.entries(ROLES).map(([k, r]) => `<button class="role ${S.role === k ? "on" : ""} ${s.who === k ? "next" : ""}" data-role="${k}" title="${s.who === k ? "نوبت این نقش است" : ""}"><span>${r.icon}</span>${r.fa}</button>`).join("");
  let phase = "";
  document.getElementById("rail").innerHTML = STEPS.map((x) => { const idx = STEPS.indexOf(x), cur = STEPS.indexOf(s);
    const head = x.phase !== phase ? `<li class="ph">${(phase = x.phase)}</li>` : "";
    return `${head}<li class="${idx < cur ? "done" : idx === cur ? "cur" : ""}">${x.who ? `<span class="who">${ROLES[x.who].icon}</span>` : ""}${x.title}</li>`; }).join("");
  const mine = !s.who || S.role === s.who;
  document.getElementById("stage").innerHTML = `
    <div class="stagehead"><div><div class="muted sm">${s.who ? `${ROLES[s.who].app} — نقش: ${ROLES[s.who].fa}` : "پایان مسیر ساخته‌شده"}</div><h2>${s.title}</h2></div>
      <span class="chip">${s.phase}</span></div>
    ${mine ? `<div class="body">${sc.body}</div><div class="acts">${sc.actions.map(([l, , v], i) => `<button class="btn ${v || ""}" data-act="${i}">${l}</button>`).join("")}</div>`
      : `<div class="locked"><p>این کار با نقش <b>${ROLES[s.who].fa}</b> انجام می‌شود؛ شما اکنون «${ROLES[S.role].fa}» هستید.</p><p class="muted sm">در سامانه‌ی واقعی این صفحه برای نقش شما نمایش داده نمی‌شود یا دکمه‌ی آن غیرفعال است.</p><button class="btn" data-role="${s.who}">رفتن به نقش ${ROLES[s.who].fa}</button></div>`}`;
  const st = [["سازمان", S.org.kyb === "approved" ? "تأیید شده" : S.org.kyb === "in_review" ? "در حال بررسی" : S.org.kyb === "info_requested" ? "نیاز به اطلاعات" : "شروع نشده"],
    ["موجودی", toman(S.org.balance)], ...(S.org.hold > 0n ? [["در حال برداشت", toman(S.org.hold)]] : []),
    ["پرونده", CASE_FA[S.kase.state]], ["دور محاسبه", S.round ? ROUND_FA[S.round.state] || "—" : "—"],
    ["حد اعتباری", S.limit ? `${short(S.limit.limit)} (${COLL[S.limit.collateral]})` : "—"], ["درخواست", S.app ? APP_FA[S.app.state] : "—"], ["برداشت", S.wd ? WD_FA[S.wd] : "—"]];
  document.getElementById("state").innerHTML = st.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("");
  document.getElementById("tools").innerHTML = tools().map(([r, t, b], i) => `<li><span>${ROLES[r].icon} ${t}<span class="muted sm"> — ${ROLES[r].fa}</span></span><button class="btn sm2 ${S.role === r ? "" : "ghost"}" data-tool="${i}">${b}</button></li>`).join("") || `<li class="muted sm">در این مرحله ابزاری فعال نیست.</li>`;
  document.getElementById("log").innerHTML = S.log.map((l) => `<li><span class="who">${ROLES[l.who]?.icon || ""}</span><div><div>${esc(l.text)}</div>${l.sys ? `<div class="muted sm">سامانه: ${esc(l.sys)}</div>` : ""}</div></li>`).join("") || `<li class="muted sm">هنوز رویدادی ثبت نشده است.</li>`;
  window.__sc = sc;
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("button, input[type=checkbox]"); if (!b) return;
  if (b.dataset.role) { S.role = b.dataset.role; render(); return; }
  if (b.dataset.act !== undefined) { window.__sc.actions[Number(b.dataset.act)][1](); return; }
  if (b.dataset.tool !== undefined) { const t = tools()[Number(b.dataset.tool)]; if (S.role !== t[0]) { S.role = t[0]; toast(`نقش به «${ROLES[t[0]].fa}» تغییر کرد`); } t[3](); return; }
  const a = b.dataset.a; const k = S.kase;
  if (a === "sections") { k.sections = 9; log("company", "۹ بخش فرم تکمیل شد", "بررسی لحظه‌ای کامل بودن هر بخش"); }
  if (a === "docs") { k.docs = k.docsTotal; log("company", `${fa(k.docsTotal)} مدرک بارگذاری شد`, "هر فایل با بررسی SHA-256 ثبت شد"); }
  if (a === "figs") { document.querySelectorAll("[data-fig]").forEach((i) => { const v = Number(i.value.replace(/\D/g, "")) || 0; if (i.dataset.fig === "tb") S.figures.tb = v; else S.figures.y[Number(i.dataset.fig.slice(1))] = v; }); S.figuresIn = true; log("company", "ارقام مالی ثبت شد", "جمع‌ها و تراز خودکار بررسی شد"); }
  if (a === "letter") { k.letterSigned = true; log("company", "درخواست‌نامه با رمز یکبارمصرف امضا شد"); }
  if (a === "fee") { const fee = S.tariff.feeTehran; if (S.org.balance < fee) { toast("موجودی کافی نیست؛ در مرحله‌ی قبل بیشتر واریز کنید یا مدیر صندوق معاف کند"); return; } S.org.balance -= fee; k.feePaid = true; log("company", `کارمزد ارزیابی ${toman(fee)} پرداخت شد`, "صورتحساب با نسخه‌ی تعرفه؛ سهم صندوق و پلتفرم"); }
  if (a === "fixDoc") { k.fixed = true; log("company", "گواهی ثنا دوباره بارگذاری شد"); }
  if (a === "tbcheck") { S.score.tbChecked = b.checked; }
  if (a) render();
});
document.addEventListener("change", (e) => {
  const i = e.target;
  if (i.dataset.s) { S.score[i.dataset.s] = i.value; if (S.step === "scoring") render(); }
  if (i.dataset.p) { S["p" + i.dataset.p] = i.value; render(); }
  if (i.id === "follow") { S.follow = i.checked; if (S.follow && step().who) S.role = step().who; render(); }
  if (i.id === "simdate") { try { S.date = T.jalaliToIso(i.value.replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))); log("fm", `تاریخ شبیه‌سازی: ${jd(S.date)}`, tbPeriod() ? "تراز آزمایشی تا پایان آخرین فصل کامل" : "بهار: تراز آزمایشی پذیرفته نمی‌شود"); render(); } catch { toast("تاریخ را به شکل ۱۴۰۵/۰۹/۰۷ وارد کنید"); } }
});
document.getElementById("reset").onclick = () => { S = fresh(); render(); };
document.querySelectorAll("[data-date]").forEach((b) => (b.onclick = () => { S.date = b.dataset.date; log("fm", `تاریخ شبیه‌سازی: ${jd(S.date)}`); render(); }));
render();
