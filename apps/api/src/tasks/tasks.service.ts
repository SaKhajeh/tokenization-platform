import { Inject, Injectable } from "@nestjs/common";
import { DB, Db } from "../db/db.js";
import { ApiError, Errors } from "../common/errors.js";
import { uuidv7 } from "../common/ids.js";
import { AuditService } from "../audit/audit.service.js";
import { actor, AppRequest } from "../common/context.js";

type Status = "open" | "in_progress" | "done" | "cancelled";
const NEXT: Record<Status, Status[]> = {
  open: ["in_progress", "done", "cancelled"],
  in_progress: ["open", "done", "cancelled"],
  done: [],
  cancelled: [],
};

export interface CreateTask {
  title: string;
  description?: string;
  linked_type?: string;
  linked_id?: string;
  assignee_user_id?: string;
  assignee_role?: "org_admin" | "preparer" | "approver" | "viewer";
  due_date?: string;
  priority?: "p0" | "p1" | "p2";
}

@Injectable()
export class TasksService {
  constructor(@Inject(DB) private readonly db: Db, private readonly audit: AuditService) {}

  /** Visible tasks in the active org: assigned to me, to my role, or created by me (scope filters). */
  async list(req: AppRequest, f: { scope: "mine" | "role" | "created" | "all"; status?: Status }) {
    // Postgres rejects bound parameters a statement does not use, so add only the ones this scope needs.
    const p: unknown[] = [req.org!.id];
    const me = () => `$${p.push(req.user!.id)}`;
    const role = () => `$${p.push(req.org!.role)}`;
    let scope: string;
    if (f.scope === "mine") scope = `t.assignee_user_id = ${me()}`;
    else if (f.scope === "role") scope = `t.assignee_role = ${role()}`;
    else if (f.scope === "created") scope = `t.created_by = ${me()}`;
    else {
      const u = me(), r = role();
      scope = `(t.assignee_user_id = ${u} or t.assignee_role = ${r} or t.created_by = ${u} or ${r} = 'org_admin')`;
    }
    const status = f.status ? ` and t.status = $${p.push(f.status)}` : "";
    const { rows } = await this.db.query(
      `select t.*, (t.due_date < current_date and t.status in ('open','in_progress')) as overdue
       from tasks t where t.org_id = $1 and ${scope}${status}
       order by (t.status in ('open','in_progress')) desc, t.priority, t.due_date nulls last, t.created_at desc limit 200`,
      p,
    );
    return rows;
  }

  private async getVisible(req: AppRequest, id: string) {
    const t = (await this.db.query(`select * from tasks where id = $1 and org_id = $2`, [id, req.org!.id])).rows[0];
    if (!t) throw Errors.notFound("Task");
    return t;
  }

  async get(req: AppRequest, id: string) {
    return this.getVisible(req, id);
  }

  async create(req: AppRequest, input: CreateTask) {
    if (req.org!.role === "viewer") throw Errors.forbidden("Viewers cannot create tasks");
    if (!input.assignee_user_id && !input.assignee_role)
      throw new ApiError(400, "ASSIGNEE_REQUIRED", "Assign the task to a member or a role", "کار را به یک عضو یا نقش واگذار کنید.");
    return this.db.tx(async (q) => {
      if (input.assignee_user_id) {
        const m = await q.query(`select 1 from org_members where org_id = $1 and user_id = $2 and status = 'active'`, [req.org!.id, input.assignee_user_id]);
        if (!m.rows.length) throw new ApiError(400, "ASSIGNEE_NOT_MEMBER", "Assignee is not an active member", "مسئول انتخاب‌شده عضو فعال سازمان نیست.");
      }
      const t = (
        await q.query(
          `insert into tasks (id, org_id, title, description, linked_type, linked_id, assignee_user_id, assignee_role, created_by, due_date, priority)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
          [uuidv7(), req.org!.id, input.title, input.description ?? null, input.linked_type ?? null, input.linked_id ?? null,
           input.assignee_user_id ?? null, input.assignee_role ?? null, req.user!.id, input.due_date ?? null, input.priority ?? "p1"],
        )
      ).rows[0];
      await this.audit.append(q, { ...actor(req), orgId: req.org!.id, action: "task.created", entityType: "task", entityId: t.id, after: { title: t.title, assignee_user_id: t.assignee_user_id, assignee_role: t.assignee_role } });
      return t;
    });
  }

  /** Assignee, creator or org_admin may update. Status follows NEXT; done/cancelled are final. */
  async update(req: AppRequest, id: string, input: { status?: Status; assignee_user_id?: string | null; assignee_role?: string | null; due_date?: string | null }) {
    return this.db.tx(async (q) => {
      const t = (await q.query(`select * from tasks where id = $1 and org_id = $2 for update`, [id, req.org!.id])).rows[0];
      if (!t) throw Errors.notFound("Task");
      const me = req.user!.id;
      const allowed = t.assignee_user_id === me || t.created_by === me || req.org!.role === "org_admin" || (t.assignee_role && t.assignee_role === req.org!.role);
      if (!allowed) throw Errors.forbidden("Only the assignee, the creator or an org admin can update this task");
      if (input.status && input.status !== t.status && !NEXT[t.status as Status].includes(input.status))
        throw new ApiError(409, "ILLEGAL_TRANSITION", `Cannot move task from ${t.status} to ${input.status}`, "تغییر وضعیت کار به این حالت مجاز نیست.");
      if (input.assignee_user_id) {
        const m = await q.query(`select 1 from org_members where org_id = $1 and user_id = $2 and status = 'active'`, [req.org!.id, input.assignee_user_id]);
        if (!m.rows.length) throw new ApiError(400, "ASSIGNEE_NOT_MEMBER", "Assignee is not an active member", "مسئول انتخاب‌شده عضو فعال سازمان نیست.");
      }
      const next = {
        status: input.status ?? t.status,
        assignee_user_id: input.assignee_user_id === undefined ? t.assignee_user_id : input.assignee_user_id,
        assignee_role: input.assignee_role === undefined ? t.assignee_role : input.assignee_role,
        due_date: input.due_date === undefined ? t.due_date : input.due_date,
      };
      if (!next.assignee_user_id && !next.assignee_role)
        throw new ApiError(400, "ASSIGNEE_REQUIRED", "Assign the task to a member or a role", "کار را به یک عضو یا نقش واگذار کنید.");
      const done = next.status === "done" && t.status !== "done";
      const row = (
        await q.query(
          `update tasks set status = $2, assignee_user_id = $3, assignee_role = $4, due_date = $5, updated_at = now(),
                  completed_by = case when $6 then $7::uuid else completed_by end, completed_at = case when $6 then now() else completed_at end
           where id = $1 returning *`,
          [id, next.status, next.assignee_user_id, next.assignee_role, next.due_date, done, me],
        )
      ).rows[0];
      await this.audit.append(q, {
        ...actor(req), orgId: req.org!.id, action: "task.updated", entityType: "task", entityId: id,
        before: { status: t.status, assignee_user_id: t.assignee_user_id, assignee_role: t.assignee_role },
        after: { status: row.status, assignee_user_id: row.assignee_user_id, assignee_role: row.assignee_role },
      });
      return row;
    });
  }

  async comments(req: AppRequest, id: string) {
    await this.getVisible(req, id);
    const { rows } = await this.db.query(
      `select c.id, c.body, c.attachment_doc_ids, c.created_at, c.author_id, u.full_name as author_name
       from task_comments c join users u on u.id = c.author_id where c.task_id = $1 order by c.created_at`,
      [id],
    );
    return rows;
  }

  async addComment(req: AppRequest, id: string, input: { body: string; attachment_doc_ids?: string[] }) {
    await this.getVisible(req, id);
    const docs = input.attachment_doc_ids ?? [];
    if (docs.length) {
      const ok = await this.db.query(`select count(*)::int as n from documents where id = any($1::uuid[]) and org_id = $2 and status = 'uploaded'`, [docs, req.org!.id]);
      if (ok.rows[0].n !== new Set(docs).size)
        throw new ApiError(400, "ATTACHMENT_INVALID", "Attachments must be uploaded documents of this organisation", "پیوست‌ها باید اسناد بارگذاری‌شده همین سازمان باشند.");
    }
    return this.db.tx(async (q) => {
      const c = (
        await q.query(`insert into task_comments (id, task_id, author_id, body, attachment_doc_ids) values ($1,$2,$3,$4,$5::uuid[]) returning *`, [
          uuidv7(), id, req.user!.id, input.body, docs,
        ])
      ).rows[0];
      await this.audit.append(q, { ...actor(req), orgId: req.org!.id, action: "task.commented", entityType: "task", entityId: id, after: { comment_id: c.id } });
      return c;
    });
  }
}
