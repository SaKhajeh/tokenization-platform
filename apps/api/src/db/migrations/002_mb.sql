-- Milestone M-B: KYB, bank accounts, wallets + digital ID (chain outbox), ledger, Cobank deposits.
-- Spec: plan/03-data-model-and-api.md §1.3, 1.5, 1.6, 1.12, 1.15 and plan/04-integrations-jibit.md §2–3.

-- ================================================================== KYB
create table legal_identity_snapshots (
  id          uuid primary key,
  org_id      uuid not null references orgs(id),
  national_id text not null,
  data        jsonb not null,            -- normalised LegalIdentity (people, state, flags…)
  raw         jsonb not null,            -- Jibit's response as received
  fetched_by  uuid references users(id),
  fetched_at  timestamptz not null default now()
);
create index legal_identity_snapshots_org_idx on legal_identity_snapshots (org_id, fetched_at desc);

create table kyb_cases (
  id               uuid primary key,
  org_id           uuid not null references orgs(id),
  version          int not null,
  status           text not null check (status in ('in_review','approved','rejected','info_requested','expired')),
  fields           jsonb not null,       -- declared: activity, address, postal_code, phone, website…
  snapshot_id      uuid not null references legal_identity_snapshots(id),
  risk_flags       jsonb not null default '[]',
  bounced_cheques  int,
  submitted_by     uuid not null references users(id),
  submitted_at     timestamptz not null default now(),
  -- the submitter's authority: 'registry' = found as CEO/board member; 'document' = introduction letter to review
  authority_basis  text not null check (authority_basis in ('registry','document')),
  authority_doc_id uuid references documents(id),
  reviewer_id      uuid references users(id),
  reviewed_at      timestamptz,
  decision_reason  text,
  expires_at       timestamptz,
  kyb_hash         text,                 -- keccak of the approved case, written on-chain
  unique (org_id, version),
  check (authority_basis = 'registry' or authority_doc_id is not null),
  check (status not in ('approved','rejected','info_requested') or (reviewer_id is not null and reviewed_at is not null))
);
-- at most one case under review per org
create unique index kyb_cases_one_open on kyb_cases (org_id) where status = 'in_review';

-- ================================================================== bank accounts
create table bank_accounts (
  id                  uuid primary key,
  org_id              uuid not null references orgs(id),
  iban                text not null check (iban ~ '^IR[0-9]{24}$'),
  bank_name           text,
  deposit_number      text,
  owner_names         jsonb not null default '[]',
  iban_status         text,                         -- Jibit: ACTIVE | BLOCK_* | IDLE | UNKNOWN
  matched             boolean,                      -- Jibit IBAN ↔ شناسه ملی
  status              text not null check (status in ('pending_review','verified','rejected','removed')),
  verified_at         timestamptz,
  verified_by         uuid references users(id),    -- null = verified automatically
  withdraw_enabled_at timestamptz,                  -- verified_at + cooling-off
  review_reason       text,
  is_default          boolean not null default false,
  added_by            uuid not null references users(id),
  removed_by          uuid references users(id),
  removed_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
-- an IBAN can be live in only one org at a time
create unique index bank_accounts_live_iban on bank_accounts (iban) where status in ('pending_review','verified');
create unique index bank_accounts_one_default on bank_accounts (org_id) where is_default and status = 'verified';

-- ================================================================== wallets + chain outbox
create sequence wallet_hd_index_seq start 1;
create table wallets (
  id              uuid primary key,
  org_id          uuid not null unique references orgs(id),
  address         text not null unique check (address ~ '^0x[0-9a-fA-F]{40}$'),
  hd_index        int not null unique,
  org_id_hash     text not null,
  registry_status text not null default 'pending' check (registry_status in ('pending','registered','revoked')),
  registered_at   timestamptz,
  created_at      timestamptz not null default now()
);

create table chain_txs (
  id              uuid primary key,
  purpose         text not null check (purpose in ('register_identity','revoke_identity')),
  ref_type        text not null,
  ref_id          text not null,
  payload         jsonb not null,
  idempotency_key text not null unique,
  status          text not null default 'queued' check (status in ('queued','submitted','confirmed','failed')),
  tx_hash         text,
  attempts        int not null default 0,
  last_error      text,
  next_attempt_at timestamptz not null default now(),
  block_number    bigint,
  gas_used        text,
  submitted_at    timestamptz,
  confirmed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index chain_txs_work_idx on chain_txs (status, next_attempt_at);

-- ================================================================== ledger (double entry, rials)
create table ledger_accounts (
  id              uuid primary key,
  owner_type      text not null check (owner_type in ('platform','org','series')),
  owner_id        uuid,
  kind            text not null,
  series_id       uuid,
  normal_side     text not null check (normal_side in ('debit','credit')),
  allow_overdraft boolean not null default false,
  created_at      timestamptz not null default now(),
  unique nulls not distinct (owner_type, owner_id, kind, series_id)
);

-- balance is signed: + = net debit, − = net credit
create table account_balances (
  account_id uuid primary key references ledger_accounts(id),
  balance    bigint not null default 0
);

create table journal_entries (
  id              uuid primary key,
  entry_type      text not null,
  ref_type        text,
  ref_id          text,
  description     text,
  posted_by       uuid references users(id),
  reverses_id     uuid references journal_entries(id),
  idempotency_key text not null unique,
  posted_at       timestamptz not null default now()
);

create table journal_lines (
  id         bigserial primary key,
  entry_id   uuid not null references journal_entries(id),
  account_id uuid not null references ledger_accounts(id),
  amount     bigint not null check (amount <> 0)      -- + debit, − credit
);
create index journal_lines_account_idx on journal_lines (account_id, id);
create index journal_lines_entry_idx on journal_lines (entry_id);

-- Every line updates its account balance; no account may go below zero on its normal side unless allowed.
create function ledger_apply_line() returns trigger language plpgsql as $$
declare
  b bigint;
  side text;
  overdraft boolean;
begin
  insert into account_balances (account_id, balance) values (new.account_id, new.amount)
    on conflict (account_id) do update set balance = account_balances.balance + excluded.balance
    returning balance into b;
  select normal_side, allow_overdraft into side, overdraft from ledger_accounts where id = new.account_id;
  if not overdraft and ((side = 'debit' and b < 0) or (side = 'credit' and b > 0)) then
    raise exception 'LEDGER_NEGATIVE_BALANCE account %', new.account_id using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger journal_lines_apply after insert on journal_lines for each row execute function ledger_apply_line();

-- Every entry must balance (sum = 0) and have at least two lines; checked at commit.
create function ledger_check_entry() returns trigger language plpgsql as $$
declare
  s bigint;
  n int;
begin
  select coalesce(sum(amount), 0), count(*) into s, n from journal_lines where entry_id = new.entry_id;
  if s <> 0 or n < 2 then
    raise exception 'LEDGER_UNBALANCED entry % (sum %, lines %)', new.entry_id, s, n using errcode = 'P0001';
  end if;
  return null;
end $$;
create constraint trigger journal_lines_balanced after insert on journal_lines
  deferrable initially deferred for each row execute function ledger_check_entry();

-- History is append-only: corrections are new, reversing entries.
create trigger journal_entries_no_update_delete before update or delete on journal_entries for each row execute function forbid_mutation();
create trigger journal_lines_no_update_delete before update or delete on journal_lines for each row execute function forbid_mutation();
create trigger journal_entries_no_truncate before truncate on journal_entries for each statement execute function forbid_mutation();
create trigger journal_lines_no_truncate before truncate on journal_lines for each statement execute function forbid_mutation();

-- ================================================================== Cobank deposits
create table bank_statement_lines (
  id                      uuid primary key,
  jibit_reference_number  text not null unique,
  account_iban            text,
  amount                  bigint not null check (amount > 0),
  source_iban             text,
  source_name             text,
  pay_id                  text,
  kyt_status              text,
  merchant_status         text,
  bank_reference_number   text,
  record_type             text,
  bank_timestamp          timestamptz,
  raw                     jsonb not null,
  org_id                  uuid references orgs(id),
  -- our decision, then Jibit's confirmation of it
  decision                text check (decision in ('accept','hold','refund')),
  decision_reason         text,
  status                  text not null default 'received'
                          check (status in ('received','credited','suspense','refunded','failed')),
  jibit_action_done       boolean not null default false,
  journal_entry_id        uuid references journal_entries(id),
  resolved_by             uuid references users(id),
  resolved_at             timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index bank_statement_lines_status_idx on bank_statement_lines (status);
create index bank_statement_lines_org_idx on bank_statement_lines (org_id, created_at desc);


-- ================================================================== job leases (one worker at a time per job)
create table job_leases (
  name       text primary key,
  holder     text not null,
  expires_at timestamptz not null
);
