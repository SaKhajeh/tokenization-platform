"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useApi, useQuery } from "@tp/client/react";
import { fa } from "@tp/ui";
import { useMe } from "@/lib/me";
import { IconCase, IconHome, IconMore, IconWallet } from "./Icons";

const NAV: [string, string, () => ReactNode][] = [
  ["/", "خانه", IconHome],
  ["/financing", "تأمین مالی", IconCase],
  ["/wallet", "کیف پول", IconWallet],
  ["/more", "بیشتر", IconMore],
];

/**
 * Authenticated layout. Sends signed-out users to /login, and users without Shahkar or an organisation to /onboarding.
 */
export function Shell({ title, action, children, allowNoOrg }: { title?: ReactNode; action?: ReactNode; children: ReactNode; allowNoOrg?: boolean }) {
  const api = useApi();
  const router = useRouter();
  const path = usePathname();
  const { me, org, loading, failed, reload, switchOrg } = useMe();
  const notes = useQuery(me ? `notes:${org?.id}` : null, () => api.get<{ unread: number }>("/notifications?unread=true"));

  useEffect(() => {
    if (!api.signedIn) { router.replace(`/login?next=${encodeURIComponent(path)}`); return; }
    if (!loading && me && !allowNoOrg && (me.shahkar_status !== "verified" || me.organisations.length === 0)) router.replace("/onboarding");
  }, [api.signedIn, loading, me, allowNoOrg, router, path]);

  if (failed && !me) return (
    <div className="auth"><div className="card stack">
      <h1 className="t-h2">ارتباط برقرار نشد</h1>
      <p className="t-muted">{failed} چند لحظه بعد دوباره تلاش کنید.</p>
      <button className="btn btn-primary" onClick={() => reload()}>تلاش دوباره</button>
    </div></div>
  );
  if (!api.signedIn || loading || !me) return <div className="auth"><span style={{ color: "#fff" }}>در حال بارگذاری…</span></div>;

  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <div className="shell">
      <nav className="nav" aria-label="منوی اصلی">
        {NAV.map(([href, label, Icon]) => (
          <Link key={href} href={href} aria-current={active(href) ? "page" : undefined}><Icon /><span>{label}</span></Link>
        ))}
      </nav>
      <div className="shell-body">
        <header className="top">
          <span className="brand">صندوق پژوهش و فناوری</span>
          {me.organisations.length > 0 && (
            <select className="org-switch" aria-label="سازمان فعال" value={org?.id ?? ""} onChange={(e) => switchOrg(e.target.value)}>
              {me.organisations.map((o) => <option key={o.id} value={o.id}>{o.legal_name}</option>)}
            </select>
          )}
          <Link className="bell" href="/notifications" aria-label="اعلان‌ها">
            اعلان‌ها{notes.data?.unread ? ` (${fa(notes.data.unread)})` : ""}
          </Link>
        </header>
        <main className="main">
          {(title || action) && (
            <div className="page-title">
              {typeof title === "string" ? <h1 className="t-h1">{title}</h1> : title}
              {action}
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
