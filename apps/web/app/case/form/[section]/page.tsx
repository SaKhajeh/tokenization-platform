"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { sectionProblems, type FormSection } from "@tp/domain/caseFile";
import { jalaliToIso } from "@tp/domain/jalali";
import { useAction, useApi, useQuery, ErrorBanner } from "@tp/client/react";
import { Banner, Button, Card, Check, JalaliDateInput, Select, Status, TextArea, TextInput, Toast, latin } from "@tp/ui";
import { Shell } from "@/components/Shell";
import { useMe } from "@/lib/me";
import { EDITABLE, RETURNED_ITEM, type Case } from "@/lib/case";
import { SECTIONS, SECTION_ORDER, problemText, type FieldDef } from "@/lib/sections";

const get = (o: any, path: string) => path.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
function set(o: any, path: string, v: unknown) {
  const ks = path.split(".");
  const out = structuredClone(o ?? {});
  let cur = out;
  ks.slice(0, -1).forEach((k) => { cur[k] = cur[k] && typeof cur[k] === "object" ? cur[k] : {}; cur = cur[k]; });
  cur[ks[ks.length - 1]] = v;
  return out;
}
const ROLES: [string, string][] = [["ceo", "مدیرعامل"], ["board", "عضو هیئت‌مدیره"], ["shareholder", "سهامدار"]];

function FieldInput({ f, value, onValue, disabled }: { f: FieldDef; value: any; onValue: (v: any) => void; disabled: boolean }) {
  const label = <>{f.label}{f.required ? "" : <span className="t-muted"> (اختیاری)</span>}</>;
  switch (f.type) {
    case "textarea": return <TextArea label={label} value={value ?? ""} onValue={onValue} disabled={disabled} hint={f.hint} />;
    case "date": return <JalaliDateInput label={label} value={value} onValue={onValue} disabled={disabled} />;
    case "select": return <Select label={label} value={value ?? ""} onValue={onValue} options={f.options ?? []} disabled={disabled} hint={f.hint} />;
    case "bool": return (
      <div className="field">
        <span className="field-label">{f.label}</span>
        <div className="row">
          <Button type="button" size="sm" variant={value === true ? "primary" : "outline"} onClick={() => onValue(true)} disabled={disabled}>بله</Button>
          <Button type="button" size="sm" variant={value === false ? "primary" : "outline"} onClick={() => onValue(false)} disabled={disabled}>خیر</Button>
        </div>
      </div>
    );
    case "roles": return (
      <div className="field">
        <span className="field-label">{f.label}</span>
        <div className="row">{ROLES.map(([k, l]) => (
          <Check key={k} checked={(value ?? []).includes(k)} onValue={(c) => onValue(c ? [...(value ?? []), k] : (value ?? []).filter((x: string) => x !== k))}>{l}</Check>
        ))}</div>
      </div>
    );
    case "number": return <TextInput label={label} digits ltr value={value === undefined || value === null ? "" : String(value)} disabled={disabled}
      onValue={(v) => onValue(v.trim() === "" ? null : Number.isFinite(Number(v)) ? Number(v) : v)} />;
    case "digits": case "mobile": return <TextInput label={label} digits ltr value={value ?? ""} onValue={(v) => onValue(latin(v))} disabled={disabled || f.readonly} />;
    default: return <TextInput label={label} value={value ?? ""} onValue={onValue} disabled={disabled || f.readonly} />;
  }
}

/** One section of the information form: generic editor driven by lib/sections.ts, live completeness check. */
export default function SectionPage() {
  const api = useApi();
  const { org } = useMe();
  const { section } = useParams<{ section: string }>();
  const def = SECTIONS[section];
  const cs = useQuery(org ? `case:${org.id}` : null, () => api.get<Case>("/case"));
  const sec = cs.data?.sections.find((s) => s.section === section);
  const [data, setData] = useState<Record<string, any>>({});
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!sec) return;
    let base: Record<string, any> = sec.state === "empty" || !Object.keys(sec.data ?? {}).length ? structuredClone(sec.prefill ?? {}) : structuredClone(sec.data);
    // the registry returns Jalali dates ("1398/01/15"); the form stores ISO dates
    for (const f of def?.fields ?? []) {
      const v = get(base, f.key);
      if (f.type === "date" && typeof v === "string" && /^1[34]\d\d\/\d{1,2}\/\d{1,2}$/.test(v)) {
        try { base = set(base, f.key, jalaliToIso(v)); } catch { /* leave it for the user to correct */ }
      }
    }
    setData(base);
  }, [sec?.section, sec?.state, cs.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = useMemo(() => Object.fromEntries((cs.data?.sections ?? []).map((s) => [s.section, s.section === section ? data : s.data])), [cs.data, data, section]);
  const problems = useMemo(() => (def ? sectionProblems(section as FormSection, data, all as any) : []), [def, section, data, all]);
  const save = useAction(async () => { await api.put(`/case/sections/${section}`, { data }); cs.reload(); setToast("ذخیره شد"); });

  if (!def) return <Shell title="بخش نامعتبر"><Link href="/case">بازگشت به پرونده</Link></Shell>;
  const c = cs.data;
  const editable = !!c && EDITABLE.includes(c.state) && (org?.my_role === "org_admin" || org?.my_role === "preparer") && (c.state !== "returned" || (!!sec && RETURNED_ITEM.includes(sec.state)));
  const idx = SECTION_ORDER.indexOf(section);
  const next = SECTION_ORDER[idx + 1];

  // CVs: one entry per director from section 4
  const directors: any[] = ((all.board as any)?.people ?? []).filter((p: any) => (p.roles ?? []).some((r: string) => r === "ceo" || r === "board"));

  return (
    <Shell title={def.title} action={sec ? <Status kind="item" value={sec.state} /> : null}>
      <div className="stack">
        <Link href="/case">← بازگشت به پرونده</Link>
        <ErrorBanner error={cs.error} />
        {def.intro && <p className="t-muted">{def.intro}</p>}
        {sec?.review && sec.review.decision !== "accept" && (
          <div className="review-note">پیام کارشناس صندوق: {sec.review.message ?? "این بخش نیاز به اصلاح دارد."}</div>
        )}
        {!!sec?.changed_from_registration?.length && <Banner tone="info">برخی موارد با اطلاعات ثبت‌نام فرق دارد؛ پس از تأیید پرونده، به‌روزرسانی احراز هویت سازمان خواسته می‌شود.</Banner>}
        {c && !editable && <Banner tone="info">این بخش اکنون قابل ویرایش نیست.</Banner>}

        {def.fields && (
          <Card>
            <div className="fieldset-grid">
              {def.fields.filter((f) => section !== "knowledge_based" || f.key === "is_knowledge_based" || data.is_knowledge_based === true).map((f) => (
                <div key={f.key} style={f.wide ? { gridColumn: "1 / -1" } : undefined}>
                  <FieldInput f={f} value={get(data, f.key)} disabled={!editable} onValue={(v) => setData((d) => set(d, f.key, v))} />
                </div>
              ))}
            </div>
          </Card>
        )}

        {def.repeats?.map((r) => {
          const rows: any[] = data[r.key] ?? [];
          return (
            <Card key={r.key} title={r.label === "شخص" ? "اشخاص" : `${r.label}ها`} action={editable ? (
              <Button size="sm" variant="secondary" onClick={() => setData((d) => ({ ...d, [r.key]: [...(d[r.key] ?? []), r.autoId ? { [r.autoId]: `${r.key[0].toUpperCase()}${Date.now().toString(36)}` } : {}] }))}>{r.addLabel}</Button>
            ) : null}>
              <div className="stack">
                {!rows.length && <p className="t-muted">موردی ثبت نشده است.</p>}
                {rows.map((row, i) => (
                  <div key={row[r.autoId ?? "_"] ?? i} className="repeat-row">
                    <div className="row-between"><strong>{r.label} {i + 1}</strong>
                      {editable && <Button size="sm" variant="ghost" onClick={() => setData((d) => ({ ...d, [r.key]: rows.filter((_, j) => j !== i) }))}>حذف</Button>}
                    </div>
                    <div className="fieldset-grid">
                      {r.fields.map((f) => (
                        <div key={f.key} style={f.wide ? { gridColumn: "1 / -1" } : undefined}>
                          <FieldInput f={f} value={row[f.key]} disabled={!editable}
                            onValue={(v) => setData((d) => ({ ...d, [r.key]: rows.map((x, j) => (j === i ? { ...x, [f.key]: v } : x)) }))} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}

        {section === "cvs" && (
          <Card title="سوابق مدیران">
            {!directors.length ? <p className="t-muted">ابتدا در بخش ۴ مدیرعامل و اعضای هیئت‌مدیره را وارد کنید.</p> : (
              <div className="stack">
                {directors.map((p) => {
                  const entries: any[] = data.entries ?? [];
                  const e = entries.find((x) => x.national_id === p.national_id) ?? { national_id: p.national_id };
                  const upd = (k: string, v: any) => setData((d) => {
                    const list: any[] = d.entries ?? [];
                    const has = list.some((x) => x.national_id === p.national_id);
                    return { ...d, entries: has ? list.map((x) => (x.national_id === p.national_id ? { ...x, [k]: v } : x)) : [...list, { national_id: p.national_id, [k]: v }] };
                  });
                  return (
                    <div key={p.national_id} className="repeat-row">
                      <strong>{p.name}</strong>
                      <div className="fieldset-grid">
                        <TextInput label="سمت" value={e.position ?? ""} onValue={(v) => upd("position", v)} disabled={!editable} />
                        <TextInput label="رشته و آخرین مدرک" value={e.field_degree ?? ""} onValue={(v) => upd("field_degree", v)} disabled={!editable} />
                        <TextInput label="دانشگاه (اختیاری)" value={e.university ?? ""} onValue={(v) => upd("university", v)} disabled={!editable} />
                        <TextInput label="سال‌های سابقه" digits ltr value={e.experience_years ?? ""} onValue={(v) => upd("experience_years", v === "" ? null : Number(v))} disabled={!editable} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        )}

        {problems.length > 0 ? (
          <Banner tone="warning">
            <div className="stack-sm"><strong>برای کامل شدن این بخش:</strong>
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>{problems.slice(0, 12).map((p) => <li key={p}>{problemText(section, p)}</li>)}</ul>
            </div>
          </Banner>
        ) : <Banner tone="success">این بخش کامل است.</Banner>}
        <ErrorBanner error={save.error} />
        <div className="row">
          {editable && <Button busy={save.busy} onClick={() => save.run()}>ذخیره</Button>}
          {next && <Link href={`/case/form/${next}`}><Button variant="outline">بخش بعد</Button></Link>}
        </div>
      </div>
      <Toast message={toast} onDone={() => setToast(null)} />
    </Shell>
  );
}
