"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAction, useApi, ErrorBanner } from "@tp/client/react";
import { Button, Card, Check, TextInput, Tracker, latin } from "@tp/ui";
import { Shell } from "@/components/Shell";
import { useMe } from "@/lib/me";

/** A-04 identity (Shahkar) → A-05 create organisation → A-05b purpose. KYB follows on /kyb. */
export default function Onboarding() {
  const api = useApi();
  const router = useRouter();
  const { me, org, reload } = useMe();
  const [nc, setNc] = useState("");
  const [name, setName] = useState("");
  const [nid, setNid] = useState("");
  const [invest, setInvest] = useState(true);
  const [financing, setFinancing] = useState(true);

  const verifyNc = useAction(async (_k, code: string) => { await api.post("/me/national-code", { national_code: code }); await reload(); });
  const createOrg = useAction(async (k) => {
    const o = await api.post<{ id: string }>("/orgs", { legal_name: name.trim(), national_id: latin(nid.trim()) }, { idem: k });
    api.setOrg(o.id);
    await reload();
  });
  const setPurpose = useAction(async () => {
    await api.put("/org/purposes", { invest, financing });
    router.push("/kyb");
  });

  const step = !me ? 0 : me.shahkar_status !== "verified" ? 0 : !org ? 1 : 2;
  return (
    <Shell title="شروع کار" allowNoOrg>
      <div className="grid-2" style={{ alignItems: "start" }}>
        <Card>
          <Tracker steps={["هویت شما (شاهکار)", "ثبت سازمان", "هدف سازمان", "احراز هویت سازمان"]} current={step} />
        </Card>
        {step === 0 && (
          <Card title="کد ملی شما">
            <form className="stack" onSubmit={(e) => { e.preventDefault(); void verifyNc.run(latin(nc.trim())); }}>
              <p className="t-muted">کد ملی با شماره‌ی همراه شما در سامانه‌ی شاهکار تطبیق داده می‌شود. برای اقدام از طرف سازمان لازم است.</p>
              <TextInput label="کد ملی" digits ltr value={nc} onValue={setNc} maxLength={10} inputMode="numeric" />
              {me?.shahkar_status === "failed" && <p className="field-error">کد ملی با شماره‌ی همراه تطبیق نداشت؛ کد ملی صاحب این خط را وارد کنید.</p>}
              <ErrorBanner error={verifyNc.error} />
              <Button type="submit" busy={verifyNc.busy} disabled={nc.length !== 10}>تطبیق کد ملی</Button>
            </form>
          </Card>
        )}
        {step === 1 && (
          <Card title="سازمان شما">
            <form className="stack" onSubmit={(e) => { e.preventDefault(); void createOrg.run(); }}>
              <TextInput label="نام ثبتی شرکت" value={name} onValue={setName} />
              <TextInput label="شناسه‌ی ملی (۱۱ رقم)" digits ltr value={nid} onValue={setNid} maxLength={11} hint="اگر سازمان قبلاً ثبت شده، از مدیر آن بخواهید شما را دعوت کند." />
              <ErrorBanner error={createOrg.error} />
              <Button type="submit" busy={createOrg.busy} disabled={name.trim().length < 3 || nid.length !== 11}>ثبت سازمان</Button>
            </form>
          </Card>
        )}
        {step === 2 && (
          <Card title="این سازمان در سامانه چه می‌کند؟">
            <div className="stack">
              <Check checked={invest} onValue={setInvest}>
                <strong>سرمایه‌گذاری</strong>
                <div className="t-small t-muted">پس از احراز هویت سازمان و تأیید حساب بانکی می‌توانید در فرصت‌ها مشارکت کنید.</div>
              </Check>
              <Check checked={financing} onValue={setFinancing}>
                <strong>دریافت تأمین مالی</strong>
                <div className="t-small t-muted">با ارسال احراز هویت، پرونده‌ی اعتباری شما خودکار باز می‌شود. صندوق پس از بررسی، حد اعتباری تعیین می‌کند.</div>
              </Check>
              <ErrorBanner error={setPurpose.error} />
              <Button busy={setPurpose.busy} disabled={!invest && !financing} onClick={() => setPurpose.run()}>ادامه: احراز هویت سازمان</Button>
            </div>
          </Card>
        )}
      </div>
    </Shell>
  );
}
