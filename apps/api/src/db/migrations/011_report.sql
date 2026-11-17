-- Credit case: inquiries for the fund's report (plan/07 §7.6). Bureau used and date, result, Sana registration —
-- for the company and for each board member — entered by the analyst; red flags are computed from them and the case.
create table case_inquiries (
  id                  uuid primary key,
  case_id             uuid not null references cases(id),
  subject_type        text not null check (subject_type in ('company','person')),
  subject_national_id text not null,
  subject_name        text not null,
  bureau              text not null,           -- e.g. اعتبارسنجی ارزش‌آفرین اعتماد, اعتبارسنجی حافظ سامان ایرانیان
  inquiry_date        date not null,
  result              text not null check (result in ('pass','fail')),
  sana_registered     boolean not null,
  description         text,
  document_id         uuid references documents(id),
  recorded_by         uuid not null references users(id),
  recorded_at         timestamptz not null default now()
);
create index case_inquiries_case_idx on case_inquiries (case_id, subject_national_id, inquiry_date);
