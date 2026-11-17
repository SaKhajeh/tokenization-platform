-- Credit case (پرونده اعتباری): plan/07-case-file-and-credit-scoring.md §2–§6, §10.
-- Part 2 of the milestone: the case, its form, its document slots and reviews, the request letter,
-- and the financial summary with declared and verified figures. Visit, scoring, limits: part 4.

-- Registration purpose (A-05b) and the documents uploaded once at registration (D-C9)
alter table orgs add column wants_financing boolean not null default false;
alter table kyb_cases add column articles_doc_id uuid references documents(id);
alter table kyb_cases add column gazette_doc_id uuid references documents(id);

create sequence case_no_seq;
create table cases (
  id                    uuid primary key,
  org_id                uuid not null unique references orgs(id),   -- one case per organisation
  case_no               text not null unique,
  state                 text not null,
  latest_fiscal_year    int not null check (latest_fiscal_year between 1380 and 1500),   -- Jalali, Y0
  request_letter        text,                -- free text written by the applicant (D-C12); not binding
  letter_rendered       text,                -- generated letter (addressee, company, national ID) as signed
  letter_signed_by      uuid references users(id),
  letter_signed_at      timestamptz,
  commitment_signed_by  uuid references users(id),
  commitment_signed_at  timestamptz,
  assigned_analyst      uuid references users(id),
  kyb_update_needed     boolean not null default false,   -- key identity data changed in the case (§2a)
  submissions           int not null default 0,
  submitted_at          timestamptz,
  documents_complete_at timestamptz,
  financials_locked_at  timestamptz,
  financials_locked_by  uuid references users(id),
  last_activity_at      timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index cases_state_idx on cases (state);

create table case_events (
  id         uuid primary key,
  case_id    uuid not null references cases(id),
  from_state text,
  to_state   text not null,
  actor_id   uuid references users(id),
  note       text,
  at         timestamptz not null default now()
);
create index case_events_case_idx on case_events (case_id, at);

-- Information form (1-1): one row per section; `prefill` keeps what registration supplied (§2a).
create table case_sections (
  case_id     uuid not null references cases(id),
  section     text not null,
  data        jsonb not null default '{}',
  prefill     jsonb not null default '{}',
  state       text not null default 'empty',   -- CASE_ITEM states (empty / uploaded = saved / in_review / accepted / needs_fix …)
  updated_by  uuid references users(id),
  updated_at  timestamptz not null default now(),
  primary key (case_id, section)
);

-- Document slots (§3.1–3.4): one row per slot (company, person, year, location, bank) or per ad-hoc request.
create table case_items (
  id              uuid primary key,
  case_id         uuid not null references cases(id),
  code            text not null,
  slot_key        text not null,
  label           text not null,
  kind            text not null check (kind in ('checklist','adhoc')),
  required        text not null check (required in ('yes','if_available')),
  multi           boolean not null default false,
  state           text not null,
  from_kyb        boolean not null default false,
  request_title   text,
  request_message text,
  requested_by    uuid references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (case_id, code, slot_key)
);
create index case_items_case_idx on case_items (case_id);

-- Every upload is a new version; removed files stay for staff history.
create table case_item_files (
  id          uuid primary key,
  item_id     uuid not null references case_items(id),
  document_id uuid not null references documents(id),
  version     int not null,
  link_url    text,
  uploaded_by uuid not null references users(id),
  uploaded_at timestamptz not null default now(),
  removed_by  uuid references users(id),
  removed_at  timestamptz,
  unique (item_id, version)
);

-- Review decisions on items and form sections (§6.2). Comment threads arrive in part 3.
create table case_reviews (
  id             uuid primary key,
  case_id        uuid not null references cases(id),
  target_type    text not null check (target_type in ('item','section')),
  target_id      text not null,
  decision       text not null check (decision in ('accept','needs_fix','reject')),
  reason_code    text,
  message        text,                -- message to the applicant (required for needs_fix / reject)
  file_versions  int[] not null default '{}',
  reviewer_id    uuid not null references users(id),
  at             timestamptz not null default now(),
  check (decision = 'accept' or (message is not null and length(message) > 0))
);
create index case_reviews_target_idx on case_reviews (case_id, target_type, target_id, at);

-- Financial summary (§5): whole million rials as integer strings, three years (Y0, Y-1, Y-2).
create table case_financials (
  case_id        uuid not null references cases(id),
  fiscal_year    int not null,
  statement_type text check (statement_type in ('audited','tax_return','internal')),
  declared       jsonb not null default '{}',
  verified       jsonb,               -- set when the analyst starts verification; scoring reads only this, once locked
  updated_by     uuid references users(id),
  updated_at     timestamptz not null default now(),
  primary key (case_id, fiscal_year)
);

create table financial_adjustments (
  id          uuid primary key,
  case_id     uuid not null references cases(id),
  fiscal_year int not null,
  field       text not null,
  declared    text,
  verified    text not null,
  reason      text not null check (length(reason) >= 3),
  by_user     uuid not null references users(id),
  at          timestamptz not null default now()
);
