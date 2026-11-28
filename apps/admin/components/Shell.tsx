"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useApi } from "@tp/client/react";
import { Banner, Button, STAFF_ROLE_FA } from "@tp/ui";
import { useStaff } from "@/lib/me";

type Item = [href: string, label: string, roles: string[]];
const NAV: [string | null, Item[]][] = [
  [null, [["/", "داشبورد", []]]],
  ["صف‌ها", [
    ["/kyb", "احراز هویت سازمان‌ها", ["compliance_officer", "super_admin", "auditor"]],
    ["/bank", "حساب‌های بانکی", ["compliance_officer", "super_admin", "auditor"]],
    ["/withdrawals", "برداشت‌ها", ["finance_officer", "fund_manager", "compliance_officer", "super_admin", "auditor"]],
  ]],
  ["اعتبارسنجی", [
    ["/cases", "پرونده‌های اعتباری", ["analyst", "technical_expert", "fund_manager", "compliance_officer", "auditor", "super_admin"]],
    ["/applications", "درخواست‌های تأمین مالی", ["analyst", "fund_manager", "auditor", "super_admin"]],
  ]],
  ["مالی", [["/invoices", "صورتحساب‌ها", ["fund_manager", "finance_officer", "auditor", "super_admin"]]]],
  ["تنظیمات", [["/config", "تعرفه و روش محاسبه", ["fund_manager", "analyst", "finance_officer", "auditor", "super_admin"]]]],
];

/** Staff layout: sign-in gate, staff-only gate, role-filtered sidebar. */
export function Shell({ title, action, children }: { title?: ReactNode; action?: ReactNode; children: ReactNode }) {
  const api = useApi();
  const router = useRouter();
  const path = usePathname();
  const { me, loading, has } = useStaff();
  useEffect(() => { if (!api.signedIn) router.replace(`/login?next=${encodeURIComponent(path)}`); }, [api.signedIn, router, path]);
  if (!api.signedIn || loading || !me) return <div className="auth"><span style={{ color: "#fff" }}>در حال بارگذاری…</span></div>;
  if (!me.staff_roles.length) return (
    <div className="auth"><div className="card stack">
      <Banner tone="warning">این حساب نقش کارمند صندوق ندارد. اگر کارمند هستید از مدیر سامانه بخواهید نقش شما را ثبت کند.</Banner>
      <Button variant="outline" onClick={async () => { await api.logout(); router.replace("/login"); }}>خروج</Button>
    </div></div>
  );
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <div className="layout">
      <aside className="side" aria-label="منوی پنل">
        <div className="brand">پنل صندوق پژوهش و فناوری</div>
        {NAV.map(([group, items]) => {
          const visible = items.filter(([, , roles]) => !roles.length || has(...roles));
          if (!visible.length) return null;
          return (
            <div key={group ?? "root"}>
              {group && <div className="group">{group}</div>}
              {visible.map(([href, label]) => <Link key={href} href={href} aria-current={active(href) ? "page" : undefined}>{label}</Link>)}
            </div>
          );
        })}
        <div className="who">
          <div style={{ color: "#fff" }}>{me.full_name ?? <span className="ltr">{me.mobile}</span>}</div>
          <div>{me.staff_roles.map((r) => STAFF_ROLE_FA[r] ?? r).join("، ")}</div>
          <button className="btn btn-ghost btn-sm" style={{ color: "#dbe5fb", paddingInline: 0 }} onClick={async () => { await api.logout(); router.replace("/login"); }}>خروج</button>
        </div>
      </aside>
      <main className="content">
        {(title || action) && <div className="head">{typeof title === "string" ? <h1 className="t-h1">{title}</h1> : title}{action}</div>}
        {children}
      </main>
    </div>
  );
}
