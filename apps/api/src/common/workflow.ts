/** Workflow tasks for staff queues (org_id null, assigned to a staff role). */
import type { Queryable } from "../db/db.js";
import type { StaffRole } from "./context.js";
import { uuidv7 } from "./ids.js";

export async function staffTask(
  q: Queryable,
  t: { title: string; description?: string; linkedType: string; linkedId: string; role: StaffRole; priority?: "p0" | "p1" | "p2"; key: string; dueInHours?: number },
) {
  const due = t.dueInHours ? new Date(Date.now() + t.dueInHours * 3600_000).toISOString().slice(0, 10) : null;
  await q.query(
    `insert into tasks (id, title, description, linked_type, linked_id, assignee_role, priority, source, workflow_key, due_date)
     values ($1,$2,$3,$4,$5,$6,$7,'workflow',$8,$9)`,
    [uuidv7(), t.title, t.description ?? null, t.linkedType, t.linkedId, t.role, t.priority ?? "p1", t.key, due],
  );
}

/** Closes open workflow tasks for an item once it has been handled. */
export async function closeWorkflowTasks(q: Queryable, linkedType: string, linkedId: string, by: string | null) {
  await q.query(
    `update tasks set status='done', completed_by=$3, completed_at=now(), updated_at=now()
     where linked_type=$1 and linked_id=$2 and source='workflow' and status in ('open','in_progress')`,
    [linkedType, linkedId, by],
  );
}
