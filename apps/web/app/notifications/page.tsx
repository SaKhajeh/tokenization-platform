"use client";
import { useAction, useApi, useQuery, ErrorBanner } from "@tp/client/react";
import { Button, Card, Empty, jdatetime } from "@tp/ui";
import { Shell } from "@/components/Shell";
import { useMe } from "@/lib/me";

interface Note { id: string; title: string; body: string; link: string | null; read_at: string | null; created_at: string }

export default function NotificationsPage() {
  const api = useApi();
  const { org } = useMe();
  const q = useQuery(`notes-all:${org?.id}`, () => api.get<{ unread: number; items: Note[] }>("/notifications"));
  const readAll = useAction(async () => { await api.post("/notifications/read-all"); q.reload(); });
  // the API's links point at app routes by name; map the ones that moved
  const href = (l: string | null) => (l === "/case/limit" ? "/limit" : l);
  return (
    <Shell title="اعلان‌ها" action={q.data?.unread ? <Button size="sm" variant="outline" busy={readAll.busy} onClick={() => readAll.run()}>همه خوانده شد</Button> : null}>
      <Card>
        <ErrorBanner error={q.error} />
        {q.data?.items.length ? (
          <ul className="list">{q.data.items.map((n) => (
            <li key={n.id} style={{ alignItems: "flex-start" }}>
              <div className="stack-sm">
                <strong style={{ fontWeight: n.read_at ? 500 : 700 }}>{n.title}</strong>
                <span className="t-small">{n.body}</span>
                {n.link && <a className="t-small" href={href(n.link)!}>مشاهده</a>}
              </div>
              <span className="t-small t-muted" style={{ whiteSpace: "nowrap" }}>{jdatetime(n.created_at)}</span>
            </li>
          ))}</ul>
        ) : q.data ? <Empty title="اعلانی ندارید" /> : null}
      </Card>
    </Shell>
  );
}
