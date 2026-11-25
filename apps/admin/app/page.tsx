"use client";
import Link from "next/link";
import { useApi, useQuery, ErrorBanner } from "@tp/client/react";
import { Card, Empty, Status, jdate, jdatetime } from "@tp/ui";
import { Shell } from "@/components/Shell";
import { useStaff } from "@/lib/me";

interface Task { id: string; title: string; linked_type: string | null; linked_id: string | null; assignee_role: string | null; priority: string; status: string; due_date: string | null; created_at: string }
interface Note { id: string; body: string; case_id?: string; case_no?: string; created_at: string; [k: string]: any }

const LINK: Record<string, (id: string) => string> = {
  kyb_case: (id) => `/kyb/${id}`, case: (id) => `/cases/${id}`, application: (id) => `/applications/${id}`, withdrawal: () => "/withdrawals", bank_account: () => "/bank",
};

/** S-01: the staff member's queue (tasks for their roles) and internal notes addressed to them. */
export default function Dashboard() {
  const api = useApi();
  const { me } = useStaff();
  const tasks = useQuery(me ? "tasks" : null, () => api.get<Task[]>("/admin/tasks"));
  const notes = useQuery(me ? "notes" : null, () => api.get<Note[]>("/admin/notes").catch(() => []));
  const open = (tasks.data ?? []).filter((t) => ["open", "in_progress"].includes(t.status));
  const overdue = open.filter((t) => t.due_date && new Date(t.due_date) < new Date()).length;
  return (
    <Shell title="داشبورد">
      <div className="stack">
        <ErrorBanner error={tasks.error} />
        <div className="grid-2">
          <Card><div className="stack-sm"><span className="t-muted t-small">کارهای باز</span><span className="t-num">{open.length.toLocaleString("fa-IR")}</span></div></Card>
          <Card><div className="stack-sm"><span className="t-muted t-small">گذشته از موعد</span><span className="t-num" style={overdue ? { color: "var(--danger-700)" } : undefined}>{overdue.toLocaleString("fa-IR")}</span></div></Card>
        </div>
        <Card title="کارهای من">
          {open.length ? (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>عنوان</th><th>اولویت</th><th>موعد</th><th>وضعیت</th></tr></thead>
              <tbody>{open.map((t) => {
                const href = t.linked_type && t.linked_id && LINK[t.linked_type] ? LINK[t.linked_type](t.linked_id) : null;
                return (
                  <tr key={t.id}>
                    <td>{href ? <Link href={href}>{t.title}</Link> : t.title}</td>
                    <td>{t.priority === "p0" ? <span className="chip chip-danger">فوری</span> : t.priority === "p1" ? <span className="chip chip-warning">بالا</span> : <span className="chip chip-neutral">عادی</span>}</td>
                    <td style={t.due_date && new Date(t.due_date) < new Date() ? { color: "var(--danger-700)" } : undefined}>{jdate(t.due_date)}</td>
                    <td><Status kind="task" value={t.status} /></td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          ) : <Empty title="کار بازی ندارید" />}
        </Card>
        {!!notes.data?.length && (
          <Card title="یادداشت‌های داخلی برای شما">
            <ul className="list">{notes.data.slice(0, 20).map((n) => (
              <li key={n.id} style={{ alignItems: "flex-start" }}>
                <span>{n.case_id ? <Link href={`/cases/${n.case_id}`}>{n.case_no ?? "پرونده"}</Link> : null} {n.body}</span>
                <span className="t-small t-muted" style={{ whiteSpace: "nowrap" }}>{jdatetime(n.created_at)}</span>
              </li>
            ))}</ul>
          </Card>
        )}
      </div>
    </Shell>
  );
}
