/**
 * Comment threads on the credit case (plan/07 §6b, D-C15, D-C18).
 *
 * Every document item, form section, financial figure and the case itself has a thread. Staff write either a
 * message to the applicant (shown in the app, the applicant can reply) or an internal note (never shown in the app)
 * addressed to one or more recipients — a role or a named staff member — who each get a notification and a task.
 */
import { Inject, Injectable } from "@nestjs/common";
import { CommentTarget, FINANCIAL_FIELDS, FORM_SECTIONS, NoteRecipient } from "@tp/domain";
import { DB, Db, Queryable } from "../db/db.js";
import { AuditService } from "../audit/audit.service.js";
import { ApiError, Errors } from "../common/errors.js";
import { actor, AppRequest } from "../common/context.js";
import { uuidv7 } from "../common/ids.js";
import { NotificationsService } from "../notifications/notifications.service.js";

const err = {
  target: () => new ApiError(404, "COMMENT_TARGET_NOT_FOUND", "Nothing to comment on there", "موردی برای ثبت نظر یافت نشد."),
  recipients: () => new ApiError(422, "RECIPIENTS_REQUIRED", "An internal note needs at least one recipient", "یادداشت داخلی باید دست‌کم یک گیرنده داشته باشد."),
  noRecipients: () => new ApiError(422, "RECIPIENTS_NOT_ALLOWED", "Only internal notes have recipients", "فقط یادداشت داخلی گیرنده دارد."),
  notStaff: () => new ApiError(422, "RECIPIENT_NOT_STAFF", "Recipients must be fund staff", "گیرنده‌ی یادداشت داخلی باید از کارکنان صندوق باشد."),
  closed: () => new ApiError(409, "CASE_CLOSED", "The case is closed", "این پرونده بسته شده است."),
};

export interface CommentInput {
  target_type: CommentTarget;
  target_id: string;
  body: string;
  file_version?: number | null;
}

export const commentView = (c: any, staff: boolean) => ({
  id: c.id, target_type: c.target_type, target_id: c.target_id, type: c.type, body: c.body, file_version: c.file_version,
  author_id: c.author_id, author_name: c.author_name ?? null, created_at: c.created_at,
  ...(staff ? { recipients: c.recipients } : {}),
});

@Injectable()
export class CommentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Checks that the target belongs to this case. Returns a short label for notifications. */
  private async target(q: Queryable, c: any, type: CommentTarget, id: string): Promise<string> {
    if (type === "case") {
      if (id !== c.id) throw err.target();
      return c.case_no;
    }
    if (type === "section") {
      if (!(FORM_SECTIONS as readonly string[]).includes(id)) throw err.target();
      return id;
    }
    if (type === "fin_cell") {
      const [y, field] = id.split(":");
      const year = Number(y);
      if (![c.latest_fiscal_year, c.latest_fiscal_year - 1, c.latest_fiscal_year - 2].includes(year) || !(FINANCIAL_FIELDS as readonly string[]).includes(field)) throw err.target();
      return id;
    }
    const i = (await q.query(`select code, label from case_items where id = $1 and case_id = $2`, [id, c.id])).rows[0];
    if (!i) throw err.target();
    return `${i.code} — ${i.label}`;
  }

  /** Resolves recipients to user ids; every one must be active staff. */
  private async resolve(q: Queryable, recipients: NoteRecipient[]) {
    const users = new Set<string>();
    const tags: string[] = [];
    for (const r of recipients) {
      if ("role" in r) {
        tags.push(`role:${r.role}`);
        const rows = (await q.query(`select user_id from staff_roles where role = $1 and revoked_at is null`, [r.role])).rows;
        rows.forEach((x: any) => users.add(x.user_id));
      } else {
        const ok = (await q.query(`select 1 from staff_roles where user_id = $1 and revoked_at is null limit 1`, [r.userId])).rows[0];
        if (!ok) throw err.notStaff();
        tags.push(`user:${r.userId}`);
        users.add(r.userId);
      }
    }
    return { users: [...users], tags: [...new Set(tags)] };
  }

  /** Inserts a comment in the caller's transaction (also used by reviews: the message to the applicant joins the item's thread). */
  async insert(q: Queryable, c: any, i: { target_type: CommentTarget; target_id: string; type: "to_applicant" | "internal" | "applicant_reply"; author: string; body: string; recipients?: string[]; file_version?: number | null }) {
    const id = uuidv7();
    await q.query(
      `insert into case_comments (id, case_id, target_type, target_id, type, author_id, recipients, file_version, body) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, c.id, i.target_type, i.target_id, i.type, i.author, i.recipients ?? [], i.file_version ?? null, i.body.trim()],
    );
    await q.query(`update cases set last_activity_at = now() where id = $1`, [c.id]);
    return id;
  }

  async staffComment(req: AppRequest, caseId: string, input: CommentInput & { type: "to_applicant" | "internal"; recipients?: NoteRecipient[] }) {
    return this.db.tx(async (q) => {
      const c = (await q.query(`select * from cases where id = $1`, [caseId])).rows[0];
      if (!c) throw Errors.notFound("Case");
      const label = await this.target(q, c, input.target_type, input.target_id);
      if (input.type === "internal" && !input.recipients?.length) throw err.recipients();
      if (input.type === "to_applicant" && input.recipients?.length) throw err.noRecipients();
      const r = input.type === "internal" ? await this.resolve(q, input.recipients!) : { users: [], tags: [] };
      const id = await this.insert(q, c, { ...input, author: req.user!.id, recipients: r.tags });
      if (input.type === "internal") {
        // a task per recipient (a role queue or a named person) and a notification to each staff member
        for (const tag of r.tags) {
          const [kind, val] = tag.split(":");
          await q.query(
            `insert into tasks (id, title, description, linked_type, linked_id, assignee_role, assignee_user_id, priority, source, workflow_key, created_by)
             values ($1,$2,$3,'case_comment',$4,$5,$6,'p1','workflow','case.internal_note',$7)`,
            [uuidv7(), `یادداشت داخلی — پرونده ${c.case_no}: ${label}`, input.body.slice(0, 500), id, kind === "role" ? val : null, kind === "user" ? val : null, req.user!.id],
          );
        }
        const others = r.users.filter((u) => u !== req.user!.id);
        if (others.length) await this.notifications.notify(q, { to: { userIds: others }, event: "case.internal_note", params: { no: c.case_no, target: label, case_id: c.id } });
      } else {
        await this.notifications.notify(q, { to: { orgId: c.org_id }, event: "case.message", params: { no: c.case_no, target: label } });
      }
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: `case.comment_${input.type}`, entityType: "case", entityId: c.id, after: { target: `${input.target_type}:${input.target_id}`, recipients: r.tags } });
      return { id, type: input.type, recipients: r.tags };
    });
  }

  async applicantReply(req: AppRequest, input: CommentInput) {
    return this.db.tx(async (q) => {
      const c = (await q.query(`select * from cases where org_id = $1`, [req.org!.id])).rows[0];
      if (!c) throw Errors.notFound("Case");
      if (["withdrawn", "closed_inactive"].includes(c.state)) throw err.closed();
      const label = await this.target(q, c, input.target_type, input.target_id);
      const id = await this.insert(q, c, { ...input, type: "applicant_reply", author: req.user!.id });
      if (c.assigned_analyst) await this.notifications.notify(q, { to: { userIds: [c.assigned_analyst] }, event: "case.applicant_reply", params: { no: c.case_no, target: label, case_id: c.id } });
      await this.audit.append(q, { ...actor(req), orgId: c.org_id, action: "case.comment_applicant_reply", entityType: "case", entityId: c.id, after: { target: `${input.target_type}:${input.target_id}` } });
      return { id, type: "applicant_reply" };
    });
  }

  /** All comments of a case, filtered for the viewer: the applicant never sees internal notes. */
  async forCase(q: Queryable, caseId: string, staff: boolean) {
    const r = await q.query(
      `select cc.*, u.full_name as author_name from case_comments cc join users u on u.id = cc.author_id
       where cc.case_id = $1 ${staff ? "" : "and cc.type <> 'internal'"} order by cc.created_at`,
      [caseId],
    );
    return r.rows.map((x: any) => commentView(x, staff));
  }

  /** «یادداشت‌های داخلی برای شما»: notes addressed to me or to one of my roles. */
  async myNotes(req: AppRequest) {
    const tags = [`user:${req.user!.id}`, ...req.user!.staffRoles.map((r) => `role:${r}`)];
    const r = await this.db.query(
      `select cc.*, u.full_name as author_name, c.case_no, o.legal_name from case_comments cc
       join users u on u.id = cc.author_id join cases c on c.id = cc.case_id join orgs o on o.id = c.org_id
       where cc.type = 'internal' and cc.recipients && $1::text[] order by cc.created_at desc limit 200`,
      [tags],
    );
    return r.rows.map((x: any) => ({ ...commentView(x, true), case_id: x.case_id, case_no: x.case_no, org_name: x.legal_name }));
  }
}
