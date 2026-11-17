/**
 * Notifications (PRD M17). Written inside the business transaction, so a notification exists iff the event happened.
 * In-app rows for every recipient; important events also queue an SMS, sent by the worker through Jibit
 * (production needs one pre-approved Jibit pattern per event key; dev uses the in-memory sender).
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { DB, Db, Queryable } from "../db/db.js";
import { uuidv7 } from "../common/ids.js";
import { SMS, MessageSender } from "../integrations/providers.js";
import type { OrgRole } from "../common/context.js";
import { Errors } from "../common/errors.js";

const rial = (v: unknown) => {
  try {
    return BigInt(String(v)).toLocaleString("fa-IR");
  } catch {
    return String(v);
  }
};

type Tpl = { title: string; body: (p: any) => string; sms?: boolean; link?: (p: any) => string };

/** Farsi texts per event. Keep SMS texts short (one segment where possible). */
export const TEMPLATES = {
  "kyb.approved": { title: "احراز هویت شرکت تأیید شد", body: () => "احراز هویت شرکت تأیید شد. اکنون می‌توانید حساب بانکی ثبت کنید و واریز انجام دهید.", sms: true, link: () => "/kyb" },
  "kyb.rejected": { title: "احراز هویت شرکت رد شد", body: (p) => `درخواست احراز هویت رد شد. دلیل: ${p.reason}`, sms: true, link: () => "/kyb" },
  "kyb.info_requested": { title: "نیاز به اطلاعات تکمیلی", body: (p) => `برای احراز هویت شرکت اطلاعات تکمیلی لازم است: ${p.reason}`, sms: true, link: () => "/kyb" },
  "kyb.expiring": { title: "احراز هویت به‌زودی منقضی می‌شود", body: (p) => `اعتبار احراز هویت شرکت ${p.days} روز دیگر تمام می‌شود. لطفاً تمدید کنید.`, sms: true, link: () => "/kyb" },
  "kyb.expired": { title: "احراز هویت منقضی شد", body: () => "اعتبار احراز هویت شرکت تمام شد. تا تمدید، واریز و سرمایه‌گذاری جدید ممکن نیست.", sms: true, link: () => "/kyb" },
  "wallet.registered": { title: "هویت دیجیتال ثبت شد", body: () => "هویت دیجیتال شرکت روی بلاکچین ثبت شد.", link: () => "/wallet" },
  "bank_account.verified": { title: "حساب بانکی تأیید شد", body: (p) => `حساب ${p.iban_tail} تأیید شد.`, link: () => "/bank-accounts" },
  "bank_account.rejected": { title: "حساب بانکی رد شد", body: (p) => `حساب ${p.iban_tail} تأیید نشد. دلیل: ${p.reason}`, sms: true, link: () => "/bank-accounts" },
  "deposit.credited": { title: "واریز ثبت شد", body: (p) => `مبلغ ${rial(p.amount)} ریال به موجودی شما اضافه شد.`, sms: true, link: () => "/deposits" },
  "deposit.held": { title: "واریز در انتظار بررسی", body: (p) => `واریز ${rial(p.amount)} ریالی در حال بررسی است.`, sms: true, link: () => "/deposits" },
  "deposit.refunded": { title: "واریز برگشت داده شد", body: (p) => `واریز ${rial(p.amount)} ریالی به حساب مبدأ برگشت داده شد.`, sms: true, link: () => "/deposits" },
  "applicant.approved": { title: "شرکت به‌عنوان متقاضی تأمین مالی تأیید شد", body: () => "شرکت شما تأیید شد و می‌تواند درخواست تأمین مالی برای طرح‌های خود ثبت کند.", sms: true, link: () => "/applicant-profile" },
  "applicant.rejected": { title: "درخواست متقاضی رد شد", body: (p) => `درخواست شما برای ثبت به‌عنوان متقاضی تأمین مالی رد شد. دلیل: ${p.reason}`, sms: true, link: () => "/applicant-profile" },
  "applicant.info_requested": { title: "اطلاعات تکمیلی لازم است", body: (p) => `برای بررسی درخواست متقاضی اطلاعات تکمیلی لازم است: ${p.reason}`, sms: true, link: () => "/applicant-profile" },
  "withdrawal.approval_needed": { title: "برداشت در انتظار تأیید شما", body: (p) => `درخواست برداشت ${rial(p.amount)} ریال منتظر تأیید شماست.`, link: (p) => `/withdrawals/${p.id}` },
  "withdrawal.completed": { title: "برداشت انجام شد", body: (p) => `مبلغ ${rial(p.amount)} ریال به حساب ${p.iban_tail} واریز شد.`, sms: true, link: (p) => `/withdrawals/${p.id}` },
  "withdrawal.failed": { title: "برداشت انجام نشد", body: (p) => `برداشت ${rial(p.amount)} ریالی انجام نشد و مبلغ به موجودی شما برگشت. ${p.reason ?? ""}`.trim(), sms: true, link: (p) => `/withdrawals/${p.id}` },
  "withdrawal.cancelled": { title: "برداشت لغو شد", body: (p) => `درخواست برداشت ${rial(p.amount)} ریالی لغو شد و مبلغ به موجودی برگشت.`, link: (p) => `/withdrawals/${p.id}` },
  "withdrawal.reverted": { title: "برداشت برگشت خورد", body: (p) => `واریز ${rial(p.amount)} ریالی از سوی بانک برگشت خورد و مبلغ به موجودی شما بازگشت.`, sms: true, link: (p) => `/withdrawals/${p.id}` },
  "application.approval_needed": { title: "درخواست در انتظار تأیید شما", body: (p) => `درخواست ${p.no} برای ارسال به صندوق منتظر تأیید شماست.`, link: (p) => `/applications/${p.id}` },
  "application.submitted": { title: "درخواست ارسال شد", body: (p) => `درخواست ${p.no} به صندوق ارسال شد.`, link: (p) => `/applications/${p.id}` },
  "application.screening_started": { title: "بررسی درخواست آغاز شد", body: (p) => `بررسی اولیه درخواست ${p.no} آغاز شد.`, link: (p) => `/applications/${p.id}` },
  "application.returned": { title: "درخواست برای اصلاح برگشت خورد", body: (p) => `درخواست ${p.no} برای اصلاح برگشت داده شد (${p.items} مورد).`, sms: true, link: (p) => `/applications/${p.id}` },
  "application.passed_screening": { title: "بررسی اولیه تأیید شد", body: (p) => `درخواست ${p.no} از بررسی اولیه عبور کرد و وارد اعتبارسنجی شد.`, sms: true, link: (p) => `/applications/${p.id}` },
  "application.rejected": { title: "درخواست رد شد", body: (p) => `درخواست ${p.no} رد شد. دلیل: ${p.reason}`, sms: true, link: (p) => `/applications/${p.id}` },
  "application.payment_required": {
    title: "صورت‌حساب خدمات ارزیابی صادر شد", sms: true, link: (p) => `/invoices/${p.invoice_id}`,
    body: (p) => `درخواست ${p.no} از بررسی اولیه عبور کرد. برای شروع اعتبارسنجی، صورت‌حساب ${p.invoice_no} به مبلغ ${p.amount} را پرداخت کنید.`,
  },
  "case.opened": {
    title: "پرونده‌ی اعتباری شما باز شد", link: () => "/case",
    body: (p) => `پرونده‌ی ${p.no} باز شد و با اطلاعات ثبت‌نام پیش‌پر شده است. برای دریافت حد اعتباری، فرم، صورت‌های مالی و مدارک را تکمیل کنید.`,
  },
  "case.submitted": { title: "پرونده ارسال شد", body: (p) => `پرونده‌ی ${p.no} برای بررسی صندوق ارسال شد.`, link: () => "/case" },
  "case.returned": {
    title: "پرونده برای اصلاح برگشت داده شد", sms: true, link: () => "/case",
    body: (p) => `پرونده‌ی ${p.no}: ${p.items} مورد نیاز به اصلاح یا تکمیل دارد. پیام کارشناس کنار هر مورد آمده است.`,
  },
  "case.documents_complete": { title: "مدارک پرونده کامل شد", body: (p) => `مدارک پرونده‌ی ${p.no} تأیید شد. گام بعد بازدید و تطبیق ارقام مالی است.`, link: () => "/case" },
  "case.kyb_update_needed": {
    title: "به‌روزرسانی اطلاعات سازمان", link: () => "/org",
    body: (p) => `در پرونده‌ی ${p.no} اطلاعات هویتی کلیدی (نام، نوع شرکت یا صاحبان امضا) تغییر کرد؛ لطفاً پروفایل سازمان را هم به‌روز کنید تا احراز هویت دوباره انجام شود.`,
  },
  "invoice.paid": { title: "صورت‌حساب پرداخت شد", body: (p) => `صورت‌حساب ${p.no} به مبلغ ${p.amount} پرداخت شد.`, link: (p) => `/invoices/${p.id}` },
  "application.expired": { title: "درخواست منقضی شد", body: (p) => `درخواست ${p.no} به دلیل عدم فعالیت منقضی شد.`, link: (p) => `/applications/${p.id}` },
} satisfies Record<string, Tpl>;
export type EventKey = keyof typeof TEMPLATES;

export interface Recipients {
  userIds?: string[];
  /** Active members of this org (optionally only these roles). */
  orgId?: string;
  orgRoles?: OrgRole[];
}

@Injectable()
export class NotificationsService {
  private readonly log = new Logger("notifications");

  constructor(@Inject(DB) private readonly db: Db, @Inject(SMS) private readonly sms: MessageSender) {}

  async notify(q: Queryable, input: { to: Recipients; event: EventKey; params?: Record<string, unknown>; orgId?: string | null; dedupeKey?: string }) {
    const tpl: Tpl = TEMPLATES[input.event];
    const p = input.params ?? {};
    const ids = new Set(input.to.userIds ?? []);
    if (input.to.orgId) {
      const r = await q.query(
        `select user_id from org_members where org_id = $1 and status = 'active' and ($2::text[] is null or role = any($2::text[]))`,
        [input.to.orgId, input.to.orgRoles ?? null],
      );
      for (const row of r.rows) ids.add(row.user_id);
    }
    const orgId = input.orgId ?? input.to.orgId ?? null;
    const body = tpl.body(p);
    for (const userId of ids) {
      const id = uuidv7();
      const ins = await q.query(
        `insert into notifications (id, user_id, org_id, event_key, title, body, link, payload, dedupe_key)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing returning id`,
        [id, userId, orgId, input.event, tpl.title, body, tpl.link?.(p) ?? null, JSON.stringify(p), input.dedupeKey ?? null],
      );
      if (!ins.rows[0] || !tpl.sms) continue;
      const u = (await q.query(`select mobile from users where id = $1`, [userId])).rows[0];
      if (u?.mobile) {
        await q.query(`insert into sms_outbox (id, notification_id, to_mobile, template, text) values ($1,$2,$3,$4,$5)`, [
          uuidv7(), id, u.mobile, input.event, `${tpl.title}: ${body}`,
        ]);
      }
    }
  }

  async list(userId: string, unreadOnly: boolean, limit = 50) {
    const r = await this.db.query(
      `select id, org_id, event_key, title, body, link, read_at, created_at from notifications
       where user_id = $1 and ($2::boolean = false or read_at is null) order by created_at desc limit $3`,
      [userId, unreadOnly, limit],
    );
    const unread = (await this.db.query(`select count(*)::int as n from notifications where user_id = $1 and read_at is null`, [userId])).rows[0].n;
    return { unread, items: r.rows };
  }

  async markRead(userId: string, id: string) {
    const r = await this.db.query(`update notifications set read_at = coalesce(read_at, now()) where id = $1 and user_id = $2 returning id`, [id, userId]);
    if (!r.rows[0]) throw Errors.notFound("Notification");
    return { id, read: true };
  }

  async markAllRead(userId: string) {
    const r = await this.db.query(`update notifications set read_at = now() where user_id = $1 and read_at is null returning id`, [userId]);
    return { updated: r.rows.length };
  }

  /** Worker job: deliver queued SMS. Failures retry up to 5 times. */
  async sendQueuedSms(limit = 50) {
    const rows = (await this.db.query(`select * from sms_outbox where status = 'queued' and attempts < 5 order by created_at limit $1`, [limit])).rows;
    let sent = 0;
    let failed = 0;
    for (const m of rows) {
      try {
        await this.sms.sendText(m.to_mobile, m.text, m.id);
        await this.db.query(`update sms_outbox set status='sent', sent_at=now(), attempts=attempts+1 where id=$1`, [m.id]);
        sent++;
      } catch (e: any) {
        const msg = String(e?.message ?? e).slice(0, 300);
        await this.db.query(
          `update sms_outbox set attempts=attempts+1, last_error=$2, status = case when attempts + 1 >= 5 then 'failed' else 'queued' end where id=$1`,
          [m.id, msg],
        );
        failed++;
        this.log.warn(`sms ${m.id} failed: ${msg}`);
      }
    }
    return { sent, failed };
  }
}
