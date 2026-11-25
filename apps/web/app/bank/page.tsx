"use client";
import { useState } from "react";
import { useAction, useApi, useQuery, useStepUp, ErrorBanner } from "@tp/client/react";
import { Banner, Button, Card, Chip, Empty, Status, TextInput, jdatetime, latin } from "@tp/ui";
import { Shell } from "@/components/Shell";
import { useMe } from "@/lib/me";

interface Account { id: string; iban: string; bank_name: string | null; owner_names: string[]; status: string; is_default: boolean; withdraw_enabled_at: string | null; review_reason: string | null }

/** A-09 / FR-BANK: IBANs are checked against the company's national ID (Jibit); new accounts wait 24 h before withdrawals. */
export default function BankPage() {
  const api = useApi();
  const stepUp = useStepUp();
  const { org } = useMe();
  const list = useQuery(org ? `banks:${org.id}` : null, () => api.get<Account[]>("/bank-accounts"));
  const [iban, setIban] = useState("");
  const clean = "IR" + latin(iban).replace(/^IR/i, "").replace(/\D/g, "");
  const add = useAction(async (idem) => {
    await stepUp("POST", "/bank-accounts", { iban: clean }, { idem, title: "افزودن حساب بانکی", summary: <span className="ltr">{clean}</span> });
    setIban("");
    list.reload();
  });
  const remove = useAction(async (_k, a: Account) => {
    await stepUp("DELETE", `/bank-accounts/${a.id}`, undefined, { title: "حذف حساب بانکی", summary: <span className="ltr">{a.iban}</span> });
    list.reload();
  });
  const setDefault = useAction(async (_k, id: string) => { await api.patch(`/bank-accounts/${id}`, { is_default: true }); list.reload(); });
  const isAdmin = org?.my_role === "org_admin";

  return (
    <Shell title="حساب‌های بانکی">
      <div className="stack">
        <ErrorBanner error={list.error ?? remove.error ?? setDefault.error} />
        {org?.kyb_status !== "approved" && <Banner tone="warning">ثبت حساب بانکی پس از تأیید احراز هویت سازمان ممکن است.</Banner>}
        <Card>
          {list.data?.length ? (
            <ul className="list">
              {list.data.filter((a) => a.status !== "removed").map((a) => (
                <li key={a.id}>
                  <div className="stack-sm">
                    <span className="ltr" style={{ fontWeight: 600 }}>{a.iban}</span>
                    <span className="t-small t-muted">{a.bank_name ?? "—"}{a.owner_names.length ? ` — ${a.owner_names.join("، ")}` : ""}</span>
                    {a.status === "verified" && a.withdraw_enabled_at && new Date(a.withdraw_enabled_at) > new Date() && (
                      <span className="t-small t-muted">برداشت به این حساب از {jdatetime(a.withdraw_enabled_at)} ممکن می‌شود.</span>
                    )}
                    {a.review_reason && <span className="t-small field-error">{a.review_reason}</span>}
                  </div>
                  <div className="row">
                    {a.is_default && <Chip tone="info">پیش‌فرض</Chip>}
                    <Status kind="bank" value={a.status} />
                    {isAdmin && a.status === "verified" && !a.is_default && <Button size="sm" variant="ghost" onClick={() => setDefault.run(a.id)}>پیش‌فرض شود</Button>}
                    {isAdmin && <Button size="sm" variant="ghost" onClick={() => remove.run(a)}>حذف</Button>}
                  </div>
                </li>
              ))}
            </ul>
          ) : list.data ? <Empty title="هنوز حسابی ثبت نشده است">واریز فقط از حساب‌های تأییدشده‌ی سازمان پذیرفته می‌شود و برداشت هم فقط به همین حساب‌ها انجام می‌شود.</Empty> : null}
        </Card>
        {isAdmin && org?.kyb_status === "approved" && (
          <Card title="افزودن حساب">
            <form className="stack" onSubmit={(e) => { e.preventDefault(); void add.run(); }}>
              <TextInput label="شماره‌ی شبا" ltr value={iban} onValue={setIban} placeholder="IR000000000000000000000000" hint="صاحب حساب باید همین شرکت باشد؛ تطبیق با شناسه‌ی ملی خودکار انجام می‌شود." />
              <ErrorBanner error={add.error} />
              <Button type="submit" busy={add.busy} disabled={clean.length !== 26}>بررسی و افزودن</Button>
            </form>
          </Card>
        )}
      </div>
    </Shell>
  );
}
