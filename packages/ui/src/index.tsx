"use client";
/**
 * Core components (UX spec §5.4). Plain CSS classes from styles.css; no CSS-in-JS.
 * Everything is RTL-first; numbers and codes that must read left-to-right use the `ltr` class.
 */
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { statusOf, type Tone } from "./labels";
import { latin } from "./format";

export * from "./labels";
export * from "./format";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ------------------------------------------------------------------ button
type BtnVariant = "primary" | "secondary" | "outline" | "danger" | "ghost";
export function Button({ variant = "primary", size, block, busy, className, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm"; block?: boolean; busy?: boolean }) {
  return (
    <button className={cx("btn", `btn-${variant}`, size === "sm" && "btn-sm", block && "btn-block", className)} disabled={p.disabled || busy} aria-busy={busy || undefined} {...p}>
      {busy ? "در حال انجام…" : children}
    </button>
  );
}

// ------------------------------------------------------------------ chips
export const Chip = ({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) => <span className={`chip chip-${tone}`}>{children}</span>;
export function Status({ kind, value }: { kind: string; value: string | null | undefined }) {
  const [label, tone] = statusOf(kind, value);
  return <Chip tone={tone}>{label}</Chip>;
}

// ------------------------------------------------------------------ card
export function Card({ title, action, dark, highlight, children, className }: { title?: ReactNode; action?: ReactNode; dark?: boolean; highlight?: boolean; children?: ReactNode; className?: string }) {
  return (
    <section className={cx("card", dark && "card-dark", highlight && "card-highlight", className)}>
      {(title || action) && (
        <div className="card-head">
          {typeof title === "string" ? <h2 className="t-h3">{title}</h2> : title}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

// ------------------------------------------------------------------ fields
let fieldSeq = 0;
const useId = (id?: string) => {
  const r = useRef(id ?? `f${++fieldSeq}`);
  return r.current;
};

export function Field({ label, hint, error, children, id }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: (id: string) => ReactNode; id?: string }) {
  const fid = useId(id);
  return (
    <div className="field">
      <label htmlFor={fid}>{label}</label>
      {children(fid)}
      {error ? <span className="field-error" role="alert">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export function TextInput({ label, hint, error, ltr, digits, onValue, ...p }: Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> & { label: ReactNode; hint?: ReactNode; error?: ReactNode; ltr?: boolean; digits?: boolean; onValue: (v: string) => void }) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(id) => (
        <input id={id} className={cx("input", ltr && "input-ltr")} aria-invalid={!!error || undefined} inputMode={digits ? "numeric" : undefined}
          onChange={(e) => onValue(digits ? latin(e.target.value) : e.target.value)} {...p} value={p.value ?? ""} />
      )}
    </Field>
  );
}

export function TextArea({ label, hint, error, onValue, ...p }: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> & { label: ReactNode; hint?: ReactNode; error?: ReactNode; onValue: (v: string) => void }) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(id) => <textarea id={id} className="textarea" onChange={(e) => onValue(e.target.value)} {...p} value={p.value ?? ""} />}
    </Field>
  );
}

export function Select({ label, hint, error, options, onValue, placeholder, ...p }: Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange"> & { label: ReactNode; hint?: ReactNode; error?: ReactNode; options: [string, string][]; placeholder?: string; onValue: (v: string) => void }) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(id) => (
        <select id={id} className="select" onChange={(e) => onValue(e.target.value)} {...p} value={p.value ?? ""}>
          <option value="" disabled>{placeholder ?? "انتخاب کنید"}</option>
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      )}
    </Field>
  );
}

export function Check({ checked, onValue, children }: { checked: boolean; onValue: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onValue(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

/** Six boxes, auto-advance, paste-friendly, auto-submit when complete (§6). */
export function OtpInput({ length = 6, onComplete, disabled }: { length?: number; onComplete: (code: string) => void; disabled?: boolean }) {
  const [vals, setVals] = useState<string[]>(Array(length).fill(""));
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => refs.current[0]?.focus(), []);
  const set = (i: number, raw: string) => {
    const digits = latin(raw).replace(/\D/g, "");
    if (!digits) {
      const next = [...vals];
      next[i] = "";
      setVals(next);
      return;
    }
    const next = [...vals];
    for (let k = 0; k < digits.length && i + k < length; k++) next[i + k] = digits[k];
    setVals(next);
    const focus = Math.min(i + digits.length, length - 1);
    refs.current[focus]?.focus();
    if (next.every((v) => v)) onComplete(next.join(""));
  };
  return (
    <div className="otp" role="group" aria-label="کد یکبارمصرف">
      {vals.map((v, i) => (
        <input key={i} ref={(el) => { refs.current[i] = el; }} value={v} inputMode="numeric" autoComplete={i === 0 ? "one-time-code" : "off"} disabled={disabled}
          aria-label={`رقم ${i + 1}`} maxLength={length}
          onChange={(e) => set(i, e.target.value)}
          onKeyDown={(e) => { if (e.key === "Backspace" && !vals[i] && i > 0) refs.current[i - 1]?.focus(); }} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ feedback
export function Banner({ tone = "info", children, code }: { tone?: Tone; children: ReactNode; code?: string | null }) {
  return (
    <div className={`banner banner-${tone === "neutral" ? "info" : tone}`} role={tone === "danger" ? "alert" : "status"}>
      <div className="grow">
        {children}
        {code ? <div className="banner-code">کد پیگیری: {code}</div> : null}
      </div>
    </div>
  );
}

export function Empty({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="t-h3" style={{ color: "var(--neutral-900)" }}>{title}</div>
      {children ? <div>{children}</div> : null}
      {action}
    </div>
  );
}

export function Tracker({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="tracker">
      {steps.map((s, i) => <li key={s} className={i < current ? "done" : i === current ? "current" : "todo"}>{s}</li>)}
    </ol>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: [T, ReactNode][]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([k, l]) => (
        <button key={k} role="tab" type="button" className="tab" aria-selected={value === k} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet stack" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}>
        <div className="row-between">
          <h2 className="t-h2">{title}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="بستن">بستن</Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function CopyField({ value, label }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="stack-sm">
      {label ? <span className="field-label">{label}</span> : null}
      <div className="copy">
        <code>{value}</code>
        <Button variant="ghost" size="sm" onClick={async () => { await navigator.clipboard?.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); }}>
          {done ? "کپی شد" : "کپی"}
        </Button>
      </div>
    </div>
  );
}

export function Progress({ value, max, label }: { value: number; max: number; label?: string }) {
  const p = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return <div className="progress" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100} aria-label={label}><span style={{ width: `${p}%` }} /></div>;
}

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, [message, onDone]);
  return message ? <div className="toast" role="status">{message}</div> : null;
}

export function KV({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v], i) => (
        <div key={i} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
