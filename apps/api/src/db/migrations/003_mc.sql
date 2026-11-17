-- Milestone M-C (part 1): issuer onboarding, initiatives + applications (through screening), notifications,
-- KYB expiry with on-chain update / revoke / reinstate. Spec: PRD M7, M8 (screening), M17; plan/03 §1.8, §1.16.

-- ================================================================== chain: more purposes
alter table chain_txs drop constraint chain_txs_purpose_check;
alter table chain_txs add constraint chain_txs_purpose_check
  check (purpose in ('register_identity','update_identity','revoke_identity','reinstate_identity'));

-- ================================================================== issuer onboarding (FR-ISS-1)
create table issuer_profiles (
  org_id               uuid primary key references orgs(id),
  status               text not null check (status in ('in_review','info_requested','approved','rejected')),
  tax_id               text not null,
  sector               text not null,
  main_activity        text not null,
  management           jsonb not null,           -- [{name, position, experience_years}]
  existing_debts       jsonb not null,           -- [{lender, amount, maturity}]; amounts as strings (rials)
  financial_doc_ids    uuid[] not null,
  submitted_by         uuid not null references users(id),
  submitted_at         timestamptz not null default now(),
  version              int not null default 1,
  analyst_id           uuid references users(id),
  analyst_recommendation text check (analyst_recommendation in ('approve','reject','request_info')),
  analyst_comment      text,
  analyst_reviewed_at  timestamptz,
  decided_by           uuid references users(id),
  decided_at           timestamptz,
  decision_reason      text,
  -- maker–checker: the person who decides is not the analyst who reviewed
  check (decided_by is null or analyst_id is null or decided_by <> analyst_id)
);

-- ================================================================== initiatives + applications (FR-APP)
create table initiatives (
  id               uuid primary key,
  issuer_org_id    uuid not null references orgs(id),
  title            text not null,
  description      text not null,
  sector           text not null,
  location         text not null,
  started_on       date not null,
  progress_summary text not null,
  evidence_doc_ids uuid[] not null default '{}',
  status           text not null default 'active' check (status in ('active','completed','cancelled')),
  created_by       uuid not null references users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index initiatives_org_idx on initiatives (issuer_org_id);

create sequence application_no_seq start 1;
create table applications (
  id                     uuid primary key,
  application_no         text not null unique,
  initiative_id          uuid not null references initiatives(id),
  issuer_org_id          uuid not null references orgs(id),
  investment_type        text not null,
  requested_amount       bigint not null check (requested_amount > 0),
  min_amount             bigint check (min_amount is null or (min_amount > 0 and min_amount <= requested_amount)),
  proposed_rate          numeric(9,6) not null check (proposed_rate > 0 and proposed_rate < 1),
  proposed_duration_days int not null check (proposed_duration_days between 30 and 3650),
  proposed_rule          text not null check (proposed_rule in ('all_or_nothing','keep_raised')),
  use_of_funds           text not null,
  repayment_source       text not null,
  proposed_guarantees    jsonb not null default '[]',
  document_ids           uuid[] not null default '{}',
  status                 text not null default 'draft',
  prepared_by            uuid references users(id),
  prepared_at            timestamptz,
  submitted_by           uuid references users(id),
  submitted_at           timestamptz,
  single_user            boolean not null default false,
  analyst_id             uuid references users(id),
  last_activity_at       timestamptz not null default now(),
  decided_at             timestamptz,
  created_by             uuid not null references users(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (submitted_by is null or prepared_by is not null),
  check (submitted_by is null or submitted_by <> prepared_by or single_user)
);
create index applications_org_idx on applications (issuer_org_id, status);
create index applications_status_idx on applications (status, last_activity_at);

create table application_events (
  id             bigserial primary key,
  application_id uuid not null references applications(id),
  from_status    text,
  to_status      text not null,
  actor_id       uuid references users(id),
  reason         text,
  details        jsonb,
  at             timestamptz not null default now()
);
create index application_events_app_idx on application_events (application_id, id);

create table screening_results (
  id             uuid primary key,
  application_id uuid not null references applications(id),
  checklist      jsonb not null,               -- [{item, ok, note}]
  outcome        text not null check (outcome in ('pass','return','reject')),
  comment        text,
  return_items   jsonb not null default '[]',  -- [{title, description}] → tasks for the issuer
  analyst_id     uuid not null references users(id),
  at             timestamptz not null default now()
);

-- ================================================================== notifications (M17)
create table notifications (
  id          uuid primary key,
  user_id     uuid not null references users(id),
  org_id      uuid references orgs(id),
  event_key   text not null,
  title       text not null,
  body        text not null,
  link        text,
  payload     jsonb not null default '{}',
  dedupe_key  text,                       -- the same event never notifies the same user twice
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create unique index notifications_dedupe on notifications (user_id, dedupe_key) where dedupe_key is not null;
create index notifications_user_idx on notifications (user_id, created_at desc);

create table sms_outbox (
  id              uuid primary key,
  notification_id uuid not null references notifications(id),
  to_mobile       text not null,
  template        text not null,
  text            text not null,
  status          text not null default 'queued' check (status in ('queued','sent','failed')),
  attempts        int not null default 0,
  last_error      text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index sms_outbox_status_idx on sms_outbox (status, created_at);
