"use client";
import { useRef, useState } from "react";
import { ApiError } from "@tp/client";
import { useApi } from "@tp/client/react";
import { Button } from "@tp/ui";

/** One upload button: picks a file, uploads it (presigned PUT + SHA-256 check) and returns the document id. */
export function FilePick({ label = "انتخاب فایل", category = "case_document", onUploaded, disabled, size }: {
  label?: string; category?: string; onUploaded: (documentId: string, file: File) => void | Promise<void>; disabled?: boolean; size?: "sm";
}) {
  const api = useApi();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="stack-sm" style={{ display: "inline-flex" }}>
      <input ref={ref} type="file" hidden accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.docx,.xlsx"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true); setErr(null);
          try { await onUploaded(await api.upload(f, category), f); }
          catch (x) { setErr(x instanceof ApiError ? x.messageFa : "بارگذاری انجام نشد."); }
          finally { setBusy(false); }
        }} />
      <Button type="button" variant="outline" size={size} busy={busy} disabled={disabled} onClick={() => ref.current?.click()}>{label}</Button>
      {err ? <span className="field-error">{err}</span> : null}
    </span>
  );
}
