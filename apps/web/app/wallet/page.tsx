"use client";
import Link from "next/link";
import { useState } from "react";
import { useAction, useApi, useQuery, useStepUp, ErrorBanner } from "@tp/client/react";
import { Banner, Button, Card, CopyField, Empty, KV, Select, Status, Tabs, TextInput, jdatetime, latin, toman } from "@tp/ui";
import { Shell } from "@/components/Shell";
import { useMe } from "@/lib/me";

interface Balances { available: string; reserved_total: string; withdrawal_hold: string; total: string }
interface Instructions { payment_id: string; collection_iban: string; bank_name: string; account_holder: string; allowed_source_accounts: { iban: string; bank_name: string }[]; notes_fa: string[] }
interface Deposit { id: string; amount: string; status: string; source_iban: string | null; received_at?: string; created_at: string }
interface Withdrawal { id: string; amount: string; status: string; iban?: string; bank_account_id: string; created_at: string; failure_reason?: string | null }
interface Account { id: string; iban: string; status: string; withdraw_enabled_at: string | null }
interface Line { id?: string; amount: string; direction?: string; description?: string | null; created_at?: string; posted_at?: string; [k: string]: any }

/** A-20 … A-25: balances, deposit by payment ID (Cobank), withdrawals (D24), statement. */
export default function WalletPage() {
  const api = useApi();
  const stepUp = useStepUp();
  const { org } = useMe();
  const k = org?.id ?? null;
  const [tab, setTab] = useState<"deposit" | "withdraw" | "history">("deposit");
  const bal = useQuery(k && `bal:${k}`, () => api.get<Balances>("/balances"));
  const ins = useQuery(k && org?.kyb_status === "approved" ? `ins:${k}` : null, () => api.get<Instructions>("/deposit-instructions"));
  const deps = useQuery(k && `deps:${k}`, () => api.get<Deposit[]>("/deposits"));
  const wds = useQuery(k && `wds:${k}`, () => api.get<Withdrawal[]>("/withdrawals"));
  const accts = useQuery(k && `accts:${k}`, () => api.get<Account[]>("/bank-accounts"));
  const stmt = useQuery(k && tab === "history" ? `stmt:${k}` : null, () => api.get<Line[]>("/ledger/statement"));

  const [amount, setAmount] = useState("");
  const [acct, setAcct] = useState("");
  const usable = (accts.data ?? []).filter((a) => a.status === "verified");
  const rials = latin(amount).replace(/\D/g, "") ? (BigInt(latin(amount).replace(/\D/g, "")) * 10n).toString() : "";
  const request = useAction(async (idem) => {
    await api.post("/withdrawals", { bank_account_id: acct, amount: rials }, { idem });
    setAmount("");
    wds.reload(); bal.reload();
  });
  const approve = useAction(async (idem, w: Withdrawal) => {
    await stepUp("POST", `/withdrawals/${w.id}/approve`, {}, { idem, title: "تأیید برداشت", summary: <span>برداشت {toman(w.amount)}</span> });
    wds.reload(); bal.reload();
  });
  const cancel = useAction(async (_k, w: Withdrawal) => { await api.post(`/withdrawals/${w.id}/cancel`, { reason: "انصراف درخواست‌کننده" }); wds.reload(); bal.reload(); });
  const canApprove = org && ["org_admin", "approver"].includes(org.my_role);

  return (
    <Shell title="کیف پول">
      <div className="stack">
        <Card dark>
          <div className="row-between">
            <div className="hero-figure">
              <span className="t-small t-muted">موجودی قابل استفاده</span>
              <span className="t-display">{bal.data ? toman(bal.data.available) : "—"}</span>
            </div>
            <KV rows={[["رزرو شده", bal.data ? toman(bal.data.reserved_total) : "—"], ["در حال برداشت", bal.data ? toman(bal.data.withdrawal_hold) : "—"]]} />
          </div>
        </Card>
        <Tabs tabs={[["deposit", "واریز"], ["withdraw", "برداشت"], ["history", "گردش حساب"]]} value={tab} onChange={setTab} />
        <ErrorBanner error={bal.error} />

        {tab === "deposit" && (
          org?.kyb_status !== "approved" ? <Banner tone="warning">واریز پس از تأیید احراز هویت سازمان ممکن است.</Banner> :
          ins.data ? (
            <div className="grid-2" style={{ alignItems: "start" }}>
              <Card title="واریز با شناسه‌ی پرداخت">
                <div className="stack">
                  <CopyField label="شناسه‌ی پرداخت (حتماً وارد کنید)" value={ins.data.payment_id} />
                  <CopyField label={`شبای حساب ${ins.data.account_holder} — ${ins.data.bank_name}`} value={ins.data.collection_iban} />
                  <ul className="stack-sm t-small" style={{ margin: 0, paddingInlineStart: 18 }}>{ins.data.notes_fa.map((n) => <li key={n}>{n}</li>)}</ul>
                  {!ins.data.allowed_source_accounts.length && <Banner tone="warning">ابتدا <Link href="/bank">حساب بانکی سازمان</Link> را ثبت کنید.</Banner>}
                </div>
              </Card>
              <Card title="واریزهای اخیر">
                {deps.data?.length ? (
                  <ul className="list">{deps.data.map((d) => (
                    <li key={d.id}><div><div>{toman(d.amount)}</div><div className="t-small t-muted">{jdatetime(d.received_at ?? d.created_at)}</div></div><Status kind="deposit" value={d.status} /></li>
                  ))}</ul>
                ) : <Empty title="واریزی ثبت نشده است">پس از انتقال با شناسه‌ی پرداخت، واریز اینجا دیده می‌شود.</Empty>}
              </Card>
            </div>
          ) : <ErrorBanner error={ins.error} />
        )}

        {tab === "withdraw" && (
          <div className="grid-2" style={{ alignItems: "start" }}>
            <Card title="درخواست برداشت">
              <form className="stack" onSubmit={(e) => { e.preventDefault(); void request.run(); }}>
                <TextInput label="مبلغ (تومان)" digits ltr value={amount} onValue={setAmount} hint={bal.data ? `حداکثر ${toman(bal.data.available)}` : undefined} />
                <Select label="به حساب" value={acct} onValue={setAcct} options={usable.map((a) => [a.id, a.iban])} placeholder={usable.length ? "انتخاب حساب" : "حساب تأییدشده ندارید"} />
                <ErrorBanner error={request.error} />
                <Button type="submit" busy={request.busy} disabled={!rials || !acct}>ثبت درخواست</Button>
                <p className="t-small t-muted">درخواست پس از تأیید تأییدکننده‌ی سازمان (با رمز یکبارمصرف) به واحد مالی صندوق می‌رود.</p>
              </form>
            </Card>
            <Card title="برداشت‌ها">
              <ErrorBanner error={approve.error ?? cancel.error} />
              {wds.data?.length ? (
                <ul className="list">{wds.data.map((w) => (
                  <li key={w.id}>
                    <div><div>{toman(w.amount)}</div><div className="t-small t-muted">{jdatetime(w.created_at)}</div></div>
                    <div className="row">
                      <Status kind="withdrawal" value={w.status} />
                      {w.status === "requested" && canApprove && <Button size="sm" onClick={() => approve.run(w)}>تأیید</Button>}
                      {["requested", "org_approved"].includes(w.status) && <Button size="sm" variant="ghost" onClick={() => cancel.run(w)}>لغو</Button>}
                    </div>
                  </li>
                ))}</ul>
              ) : <Empty title="برداشتی ثبت نشده است" />}
            </Card>
          </div>
        )}

        {tab === "history" && (
          <Card>
            {stmt.data?.length ? (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>تاریخ</th><th>شرح</th><th>مبلغ</th></tr></thead>
                <tbody>{stmt.data.map((l, i) => (
                  <tr key={l.id ?? i}><td>{jdatetime(l.posted_at ?? l.created_at)}</td><td>{l.description ?? l.kind ?? "—"}</td><td className="num">{toman(l.amount)}</td></tr>
                ))}</tbody>
              </table></div>
            ) : <Empty title="گردشی ثبت نشده است" />}
          </Card>
        )}
      </div>
    </Shell>
  );
}
