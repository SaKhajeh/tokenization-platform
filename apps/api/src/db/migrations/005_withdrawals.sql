-- Milestone M-C part 2: withdrawals from the platform balance to the org's verified bank account (PRD FR-WDR,
-- plan/04 §2.5). Money leaves directly from the fund's collection account through Jibit Cobank settlement.
create table withdrawals (
  id                  uuid primary key,                   -- also Jibit's recordTrackId (idempotency)
  org_id              uuid not null references orgs(id),
  bank_account_id     uuid not null references bank_accounts(id),
  destination_iban    text not null,
  amount              bigint not null check (amount > 0),
  status              text not null default 'requested',
  requested_by        uuid not null references users(id),
  org_approved_by     uuid references users(id),
  org_approved_at     timestamptz,
  single_user         boolean not null default false,
  finance_by          uuid references users(id),
  finance_queued_at   timestamptz,
  needs_fund_approval boolean not null default false,
  fund_approved_by    uuid references users(id),
  fund_approved_at    timestamptz,
  sent_by             uuid references users(id),
  sent_at             timestamptz,
  transfer_type       text check (transfer_type in ('NORMAL','ACH','RTGS')),
  transfer_reason     text,
  jibit_state         text,
  fail_reason         text,
  estimated_settle_at timestamptz,
  bank_reference      text,
  completed_at        timestamptz,
  closed_reason       text,                               -- cancel / reject / failure / reversal reason
  hold_entry_id       uuid references journal_entries(id),
  final_entry_id      uuid references journal_entries(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- maker–checker inside the org (single-user mode excepted), and between finance and the fund manager
  check (org_approved_by is null or org_approved_by <> requested_by or single_user),
  check (fund_approved_by is null or finance_by is null or fund_approved_by <> finance_by)
);
create index withdrawals_org_idx on withdrawals (org_id, created_at desc);
create index withdrawals_status_idx on withdrawals (status, created_at);
