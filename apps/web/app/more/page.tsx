"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAction, useApi, useQuery, useStepUp, ErrorBanner } from "@tp/client/react";
import { Button, Card, ORG_ROLE_FA, Select, Status, TextInput, latin } from "@tp/ui";
import { Shell } from "@/components/Shell";
import { useMe } from "@/lib/me";

interface Member { id: string; role: string; status: string; full_name: string | null; mobile: string | null; email: string | null }

/** «بیشتر»: organisation, members and invitations (FR-ORG-3), settings, sign out. */
export default function MorePage() {
  const api = useApi();
  const stepUp = useStepUp();
  const router = useRouter();
  const { me, org } = useMe();
  const members = useQuery(org ? `members:${org.id}` : null, () => api.get<Member[]>("/orgs/current/members"));
  const [dest, setDest] = useState("");
  const [role, setRole] = useState("preparer");
  const [invited, setInvited] = useState<string | null>(null);
  const invite = useAction(async (idem) => {
    const r = await stepUp<{ token?: string }>("POST", "/orgs/current/invitations", { destination: latin(dest.trim()), role }, { idem, title: "دعوت عضو جدید" });
    setInvited(r?.token ?? "");
    setDest("");
    members.reload();
  });
  const isAdmin = org?.my_role === "org_admin";
  return (
    <Shell title="بیشتر">
      <div className="stack">
        <div className="grid-2">
          <Card title="سازمان">
            <ul className="list">
              <li><Link href="/kyb">احراز هویت سازمان</Link>{org && <Status kind="kyb" value={org.kyb_status} />}</li>
              <li><Link href="/bank">حساب‌های بانکی</Link></li>
              <li><Link href="/financing">پرونده و درخواست‌های تأمین مالی</Link></li>
              <li><Link href="/notifications">اعلان‌ها</Link></li>
              <li><Link href="/onboarding">ثبت یا افزودن سازمان دیگر</Link></li>
            </ul>
          </Card>
          <Card title="حساب کاربری">
            <ul className="list">
              <li><span>شماره‌ی همراه</span><span className="ltr">{me?.mobile ?? "—"}</span></li>
              <li><span>کد ملی</span><span className="ltr">{me?.national_code_masked ?? "—"}</span></li>
              <li><span>نقش شما در سازمان</span><span>{org ? ORG_ROLE_FA[org.my_role] : "—"}</span></li>
            </ul>
            <div style={{ marginTop: 12 }}><Button variant="outline" onClick={async () => { await api.logout(); router.replace("/login"); }}>خروج</Button></div>
          </Card>
        </div>
        <Card title="اعضای سازمان">
          <ErrorBanner error={members.error} />
          <ul className="list">{members.data?.map((m) => (
            <li key={m.id}><span>{m.full_name ?? <span className="ltr">{m.mobile ?? m.email}</span>}</span><span className="row"><span>{ORG_ROLE_FA[m.role] ?? m.role}</span>{m.status !== "active" && <span className="chip chip-neutral">{m.status}</span>}</span></li>
          ))}</ul>
          {isAdmin && (
            <form className="stack" style={{ marginTop: 16 }} onSubmit={(e) => { e.preventDefault(); void invite.run(); }}>
              <div className="fieldset-grid">
                <TextInput label="شماره‌ی همراه یا ایمیل" ltr value={dest} onValue={setDest} />
                <Select label="نقش" value={role} onValue={setRole} options={Object.entries(ORG_ROLE_FA)} />
              </div>
              <p className="t-small t-muted">با دو عضو یا بیشتر، کارها دونفره انجام می‌شود: تهیه‌کننده ثبت می‌کند و تأییدکننده با رمز یکبارمصرف تأیید می‌کند.</p>
              <ErrorBanner error={invite.error} />
              {invited !== null && <span className="chip chip-success">دعوت ارسال شد{invited ? ` — کد آزمایشی: ${invited}` : ""}</span>}
              <Button type="submit" busy={invite.busy} disabled={dest.trim().length < 5}>ارسال دعوت</Button>
            </form>
          )}
        </Card>
      </div>
    </Shell>
  );
}
