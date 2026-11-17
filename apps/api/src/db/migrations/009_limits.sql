-- Credit case part 4a: fee tariff (D-C13, §6d), site visit (D-C16), scoring rounds and approval (§6.6),
-- credit limits and the norm usage ledger (§7.5). plan/07-case-file-and-credit-scoring.md.

-- ================================================================== fee tariff (versioned; the latest effective row applies)
create table fee_tariffs (
  id                     uuid primary key,
  version                int not null unique,
  effective_from         date not null,
  assessment_fee_tehran  bigint not null check (assessment_fee_tehran >= 0),   -- rials, charged at case submission
  assessment_fee_outside bigint not null check (assessment_fee_outside >= 0),
  application_fee        bigint not null default 0 check (application_fee >= 0),
  servicing_fee_bps      int not null default 0 check (servicing_fee_bps between 0 and 10000),
  investor_fee_bps       int not null default 0 check (investor_fee_bps between 0 and 10000),
  platform_share_bps     int not null default 0 check (platform_share_bps between 0 and 10000),  -- platform's share of fee income
  note                   text,
  created_by             uuid not null references users(id),
  created_at             timestamptz not null default now()
);
alter table cases add column fee_invoice_id uuid references invoices(id);

-- ================================================================== site visit
create table case_visits (
  id               uuid primary key,
  case_id          uuid not null references cases(id),
  state            text not null,
  visit_date       date not null,
  visit_time       text not null check (visit_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  visitor_id       uuid not null references users(id),
  proposed_by      uuid not null references users(id),
  proposed_at      timestamptz not null default now(),
  confirmed_by     uuid references users(id),
  confirmed_at     timestamptz,
  change_ticket_id uuid references tickets(id),
  reminder_sent_at timestamptz,
  findings         text,
  photo_doc_ids    uuid[] not null default '{}',
  reported_by      uuid references users(id),
  done_at          timestamptz
);
create index case_visits_case_idx on case_visits (case_id, proposed_at);
-- at most one live visit per case
create unique index case_visits_live on case_visits (case_id) where state in ('proposed','confirmed','change_requested');

-- originals (1-2 consent forms, 1-6 signature certificates) handed over at the visit
alter table case_items add column original_received_at timestamptz;
alter table case_items add column original_received_by uuid references users(id);

-- ================================================================== scoring method (versioned) and rounds
create table scoring_methods (
  version    int primary key,
  config     jsonb not null,
  note       text,
  created_by uuid references users(id),            -- null = the built-in default (the fund's workbook)
  created_at timestamptz not null default now()
);

create table assessment_rounds (
  id              uuid primary key,
  case_id         uuid not null references cases(id),
  round_no        int not null,
  state           text not null,
  method_version  int not null references scoring_methods(version),
  activity_type   text not null,
  judgement       jsonb not null,     -- {rc, ra, re} for guarantees + a written reason for each (D-C4)
  facility        jsonb,              -- optional separate {rc, ra, re} for short-term facilities (workbook M24:M26)
  inputs          jsonb not null,     -- the locked, verified figures used
  outputs         jsonb not null,     -- full scoring result
  summary         text,               -- analyst's summary to the fund manager
  prepared_by     uuid not null references users(id),
  prepared_at     timestamptz not null default now(),
  decided_by      uuid references users(id),
  decided_at      timestamptz,
  decision_reason text,
  note_to_applicant text,
  unique (case_id, round_no),
  check (decided_by is null or decided_by <> prepared_by)
);

-- ================================================================== credit limits and usage
create table credit_limits (
  id                 uuid primary key,
  org_id             uuid not null references orgs(id),
  case_id            uuid not null references cases(id),
  round_id           uuid not null unique references assessment_rounds(id),
  limit_rials        bigint not null check (limit_rials >= 0),   -- D-C2: guarantee ceiling with cheque and promissory note
  norm_ceiling_rials bigint not null check (norm_ceiling_rials >= 0),
  ra                 numeric(4,3) not null,                      -- the round's Ra/Re, the default for usage
  re                 numeric(4,3) not null,
  ceilings           jsonb not null,                             -- all products × collateral classes, rials as strings
  valid_from         date not null,
  valid_to           date not null,
  status             text not null default 'active' check (status in ('active','expired','superseded')),
  created_at         timestamptz not null default now()
);
create unique index credit_limits_one_active on credit_limits (org_id) where status = 'active';

create table limit_usages (
  id           uuid primary key,
  org_id       uuid not null references orgs(id),
  source_type  text not null check (source_type in ('existing_guarantee','existing_facility','application','series')),
  source_id    uuid,
  description  text not null,
  amount_rials bigint not null check (amount_rials > 0),
  ra           numeric(4,3) not null check (ra > 0 and ra <= 1),
  re           numeric(4,3) not null check (re > 0 and re <= 1),
  active       boolean not null default true,
  created_by   uuid not null references users(id),
  created_at   timestamptz not null default now(),
  released_by  uuid references users(id),
  released_at  timestamptz,
  release_reason text
);
create index limit_usages_org_idx on limit_usages (org_id, created_at);
