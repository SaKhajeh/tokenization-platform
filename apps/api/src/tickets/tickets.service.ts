/**
 * Tickets (plan/07 §6c, D-C17): always available to every organisation user and to the fund, inside and outside
 * the credit case. A message from one side hands the ticket to the other (TICKET machine). While the fund owes an
 * answer the ticket has a due time (one business day by default); overdue tickets escalate to the fund manager.
 */
import { Inject, Injectable } from "@nestjs/common";
import { addBusinessDays, TICKET, TicketCategory, TicketStatus, transition, jalaliYearOf } from "@tp/domain";
import { DB, Db, Queryable } from "../db/db.js";
import { AuditService } from "../audit/audit.service.js";
import { ApiError, Errors } from "../common/errors.js";
import { actor, AppRequest, StaffRole } from "../common/context.js";
import { uuidv7 } from "../common/ids.js";
import { closeWorkflowTasks } from "../common/workflow.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { tehranToday } from "../applications/applications.service.js";
import { withLease } from "../common/lease.js";

const err = {
  link: () => new ApiError(422, "TICKET_LINK_NOT_FOUND", "The linked item was not found for this organisation", "مورد پیوست‌شده برای این سازمان یافت نشد."),
  attachment: () => new ApiError(422, "BAD_ATTACHMENT", "Attachments must be this organisation's uploaded documents", "پیوست باید سند بارگذاری‌شده‌ی همین سازمان باشد."),
  closed: () => new ApiError(409, "TICKET_CLOSED", "The ticket is closed", "این تیکت بسته شده است."),
  assignee: () => new ApiError(422, "ASSIGNEE_NOT_STAFF", "Assignee must be fund staff", "مسئول تیکت باید از کارکنان صندوق باشد."),
};

/** Which staff queue picks up a new ticket. */
const QUEUE: Record<TicketCategory, StaffRole> = {
  credit_case: "analyst", financing: "analyst", payments_wallet: "finance_officer", technical_login: "super_admin", other: "compliance_officer",
};

export interface TicketInput {
  category: TicketCategory;
  subject: string;
  body: string;
  link_type?: "case" | "case_item" | "application" | "withdrawal" | null;
  link_id?: string | null;
  attachment_doc_ids?: string[];
}

const view = (t: any, staff: boolean) => ({
  id: t.id, ticket_no: t.ticket_no, org_id: t.org_id, category: t.category, link_type: t.link_type, link_id: t.link_id, subject: t.subject,
  status: t.status, opened_side: t.opened_side, created_at: t.created_at, updated_at: t.updated_at, closed_at: t.closed_at,
  ...(staff ? { assignee_role: t.assignee_role, assignee_id: t.assignee_id, due_at: t.due_at, escalated_at: t.escalated_at, org_name: t.legal_name } : {}),
});

@Injectable()
export class TicketsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private due() {
    return addBusinessDays(new Date(), 1);
  }

  /** The link must belong to the organisation. */
  private async checkLink(q: Queryable, orgId: string, type: TicketInput["link_type"], id: string | null | undefined) {
    if (!type || !id) return;
    const sql = {
      case: `select 1 from cases where id = $1 and org_id = $2`,
      case_item: `select 1 from case_items i join cases c on c.id = i.case_id where i.id = $1 and c.org_id = $2`,
      application: `select 1 from applications where id = $1 and applicant_org_id = $2`,
      withdrawal: `select 1 from withdrawals where id = $1 and org_id = $2`,
    }[type];
    if (!(await q.query(sql, [id, orgId])).rows[0]) throw err.link();
  }

  private async checkAttachments(q: Queryable, orgId: string, ids: string[] = []) {
    if (!ids.length) return;
    const n = (await q.query(`select count(*)::int as n from documents where id = any($1) and org_id = $2 and status = 'uploaded'`, [ids, orgId])).rows[0].n;
    if (n !== new Set(ids).size) throw err.attachment();
  }

  private async load(q: Queryable, id: string, orgId?: string, lock = false) {
    const t = (await q.query(`select * from tickets where id = $1 ${orgId ? "and org_id = $2" : ""} ${lock ? "for update" : ""}`, orgId ? [id, orgId] : [id])).rows[0];
    if (!t) throw Errors.notFound("Ticket");
    return t;
  }

  private async setStatus(q: Queryable, t: any, to: TicketStatus) {
    if (t.status === to) return;
    transition("ticket", TICKET, t.status as TicketStatus, to);
    t.status = to;
  }

  /** Puts a task in the staff queue (or for the assignee) when the fund owes an answer. */
  private async fundTask(q: Queryable, t: any) {
    await closeWorkflowTasks(q, "ticket", t.id, null);
    await q.query(
      `insert into tasks (id, title, linked_type, linked_id, assignee_role, assignee_user_id, priority, source, workflow_key, due_date)
       values ($1,$2,'ticket',$3,$4,$5,'p1','workflow','ticket.answer',$6)`,
      [uuidv7(), `پاسخ به تیکت ${t.ticket_no}: ${t.subject}`, t.id, t.assignee_id ? null : t.assignee_role, t.assignee_id, new Date(t.due_at).toISOString().slice(0, 10)],
    );
    if (t.assignee_id) await this.notifications.notify(q, { to: { userIds: [t.assignee_id] }, event: "ticket.staff_message", params: { id: t.id, no: t.ticket_no, subject: t.subject } });
  }

  private async create(q: Queryable, req: AppRequest, orgId: string, side: "applicant" | "fund", input: TicketInput) {
    await this.checkLink(q, orgId, input.link_type, input.link_id);
    if (side === "applicant") await this.checkAttachments(q, orgId, input.attachment_doc_ids);
    const n = Number((await q.query(`select nextval('ticket_no_seq') as n`)).rows[0].n);
    const id = uuidv7();
    // a credit-case ticket goes to the case's analyst if one is assigned
    let assigneeId: string | null = null;
    if (input.category === "credit_case") assigneeId = (await q.query(`select assigned_analyst from cases where org_id = $1`, [orgId])).rows[0]?.assigned_analyst ?? null;
    if (side === "fund") assigneeId = req.user!.id;
    const status: TicketStatus = side === "applicant" ? "waiting_fund" : "waiting_applicant";
    const t = (await q.query(
      `insert into tickets (id, ticket_no, org_id, category, link_type, link_id, subject, status, opened_by, opened_side, assignee_role, assignee_id, due_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
      [id, `T-${jalaliYearOf(tehranToday())}-${String(n).padStart(5, "0")}`, orgId, input.category, input.link_type ?? null, input.link_id ?? null, input.subject,
        status, req.user!.id, side, QUEUE[input.category], assigneeId, side === "applicant" ? this.due() : null],
    )).rows[0];
    await q.query(`insert into ticket_messages (id, ticket_id, author_id, side, body, attachment_doc_ids) values ($1,$2,$3,$4,$5,$6)`, [
      uuidv7(), id, req.user!.id, side, input.body, side === "applicant" ? input.attachment_doc_ids ?? [] : [],
    ]);
    if (side === "applicant") await this.fundTask(q, t);
    else await this.notifications.notify(q, { to: { orgId }, event: "ticket.message", params: { id, no: t.ticket_no, subject: t.subject } });
    await this.audit.append(q, { ...actor(req), orgId, action: "ticket.opened", entityType: "ticket", entityId: id, after: { category: input.category, side, link: input.link_type ?? null } });
    return t;
  }

  // ------------------------------------------------------------------ applicant side

  async open(req: AppRequest, input: TicketInput) {
    return this.db.tx(async (q) => view(await this.create(q, req, req.org!.id, "applicant", input), false));
  }

  async listMine(req: AppRequest) {
    const rows = (await this.db.query(`select * from tickets where org_id = $1 order by updated_at desc limit 200`, [req.org!.id])).rows;
    return { waiting_you: rows.filter((t: any) => t.status === "waiting_applicant").length, items: rows.map((t: any) => view(t, false)) };
  }

  async getMine(req: AppRequest, id: string) {
    const t = await this.load(this.db, id, req.org!.id);
    return { ...view(t, false), messages: await this.messages(this.db, id) };
  }

  private async messages(q: Queryable, id: string) {
    const r = await q.query(
      `select m.*, u.full_name from ticket_messages m join users u on u.id = m.author_id where m.ticket_id = $1 order by m.created_at`,
      [id],
    );
    return r.rows.map((m: any) => ({ id: m.id, side: m.side, author_name: m.full_name, body: m.body, attachment_doc_ids: m.attachment_doc_ids, created_at: m.created_at }));
  }

  /** A message from the applicant (re)opens the ticket for the fund and restarts the response clock. */
  async replyAsApplicant(req: AppRequest, id: string, input: { body: string; attachment_doc_ids?: string[] }) {
    return this.db.tx(async (q) => {
      const t = await this.load(q, id, req.org!.id, true);
      await this.checkAttachments(q, t.org_id, input.attachment_doc_ids);
      await this.setStatus(q, t, "waiting_fund");
      const due = this.due();
      await q.query(`update tickets set status = 'waiting_fund', due_at = $2, escalated_at = null, closed_at = null, closed_by = null, updated_at = now() where id = $1`, [id, due]);
      t.due_at = due;
      await q.query(`insert into ticket_messages (id, ticket_id, author_id, side, body, attachment_doc_ids) values ($1,$2,$3,'applicant',$4,$5)`, [
        uuidv7(), id, req.user!.id, input.body, input.attachment_doc_ids ?? [],
      ]);
      await this.fundTask(q, t);
      await this.audit.append(q, { ...actor(req), orgId: t.org_id, action: "ticket.message", entityType: "ticket", entityId: id, after: { side: "applicant" } });
      return view(t, false);
    });
  }

  async closeAsApplicant(req: AppRequest, id: string) {
    return this.db.tx(async (q) => this.close(q, req, await this.load(q, id, req.org!.id, true), false));
  }

  private async close(q: Queryable, req: AppRequest, t: any, staff: boolean) {
    if (t.status === "closed") throw err.closed();
    await this.setStatus(q, t, "closed");
    await q.query(`update tickets set status = 'closed', closed_by = $2, closed_at = now(), updated_at = now() where id = $1`, [t.id, req.user!.id]);
    await closeWorkflowTasks(q, "ticket", t.id, req.user!.id);
    await this.audit.append(q, { ...actor(req), orgId: t.org_id, action: "ticket.closed", entityType: "ticket", entityId: t.id });
    return view(t, staff);
  }

  // ------------------------------------------------------------------ fund side

  async openForOrg(req: AppRequest, orgId: string, input: TicketInput) {
    return this.db.tx(async (q) => {
      if (!(await q.query(`select 1 from orgs where id = $1`, [orgId])).rows[0]) throw Errors.notFound("Organisation");
      return view(await this.create(q, req, orgId, "fund", input), true);
    });
  }

  async queue(req: AppRequest, f: { status?: TicketStatus; mine?: boolean; org_id?: string }) {
    const where: string[] = [];
    const args: unknown[] = [];
    if (f.status) where.push(`t.status = $${args.push(f.status)}`);
    if (f.org_id) where.push(`t.org_id = $${args.push(f.org_id)}`);
    if (f.mine) where.push(`(t.assignee_id = $${args.push(req.user!.id)} or (t.assignee_id is null and t.assignee_role = any($${args.push(req.user!.staffRoles)})))`);
    const r = await this.db.query(
      `select t.*, o.legal_name from tickets t join orgs o on o.id = t.org_id ${where.length ? "where " + where.join(" and ") : ""}
       order by (t.status = 'waiting_fund') desc, t.due_at nulls last, t.updated_at desc limit 500`,
      args,
    );
    return r.rows.map((t: any) => ({ ...view(t, true), overdue: t.status === "waiting_fund" && t.due_at && new Date(t.due_at) < new Date() }));
  }

  async getForStaff(id: string) {
    const t = (await this.db.query(`select t.*, o.legal_name from tickets t join orgs o on o.id = t.org_id where t.id = $1`, [id])).rows[0];
    if (!t) throw Errors.notFound("Ticket");
    return { ...view(t, true), messages: await this.messages(this.db, id) };
  }

  async replyAsFund(req: AppRequest, id: string, body: string) {
    return this.db.tx(async (q) => {
      const t = await this.load(q, id, undefined, true);
      await this.setStatus(q, t, "waiting_applicant");
      await q.query(
        `update tickets set status = 'waiting_applicant', due_at = null, closed_at = null, closed_by = null, assignee_id = coalesce(assignee_id, $2), updated_at = now() where id = $1`,
        [id, req.user!.id],
      );
      await q.query(`insert into ticket_messages (id, ticket_id, author_id, side, body) values ($1,$2,$3,'fund',$4)`, [uuidv7(), id, req.user!.id, body]);
      await closeWorkflowTasks(q, "ticket", id, req.user!.id);
      await this.notifications.notify(q, { to: { orgId: t.org_id }, event: "ticket.message", params: { id, no: t.ticket_no, subject: t.subject } });
      await this.audit.append(q, { ...actor(req), orgId: t.org_id, action: "ticket.message", entityType: "ticket", entityId: id, after: { side: "fund" } });
      return view(t, true);
    });
  }

  async assign(req: AppRequest, id: string, userId: string) {
    return this.db.tx(async (q) => {
      const t = await this.load(q, id, undefined, true);
      if (!(await q.query(`select 1 from staff_roles where user_id = $1 and revoked_at is null limit 1`, [userId])).rows[0]) throw err.assignee();
      await q.query(`update tickets set assignee_id = $2, updated_at = now() where id = $1`, [id, userId]);
      t.assignee_id = userId;
      if (t.status === "waiting_fund") await this.fundTask(q, t);
      await this.audit.append(q, { ...actor(req), orgId: t.org_id, action: "ticket.assigned", entityType: "ticket", entityId: id, after: { assignee_id: userId } });
      return view(t, true);
    });
  }

  async closeAsFund(req: AppRequest, id: string) {
    return this.db.tx(async (q) => this.close(q, req, await this.load(q, id, undefined, true), true));
  }

  /** Overdue tickets (still waiting for the fund past the due time) escalate once to the fund manager. */
  async escalateOverdue() {
    const res = await withLease(this.db, "tickets.escalate", 300, async () => {
      const due = (await this.db.query(`select * from tickets where status = 'waiting_fund' and due_at < now() and escalated_at is null`)).rows;
      for (const t of due) {
        await this.db.tx(async (q) => {
          const r = await q.query(`update tickets set escalated_at = now() where id = $1 and escalated_at is null returning id`, [t.id]);
          if (!r.rows[0]) return;
          await q.query(
            `insert into tasks (id, title, linked_type, linked_id, assignee_role, priority, source, workflow_key) values ($1,$2,'ticket',$3,'fund_manager','p0','workflow','ticket.escalated')`,
            [uuidv7(), `تیکت بی‌پاسخ ${t.ticket_no}: ${t.subject}`, t.id],
          );
          const fms = (await q.query(`select user_id from staff_roles where role = 'fund_manager' and revoked_at is null`)).rows.map((x: any) => x.user_id);
          if (fms.length) await this.notifications.notify(q, { to: { userIds: fms }, event: "ticket.escalated", params: { id: t.id, no: t.ticket_no, subject: t.subject } });
          await this.audit.append(q, { actorType: "system", orgId: t.org_id, action: "ticket.escalated", entityType: "ticket", entityId: t.id });
        });
      }
      return { escalated: due.length };
    });
    return res ?? { skipped: "another worker holds the lease" };
  }
}
