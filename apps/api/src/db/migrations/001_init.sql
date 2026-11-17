-- M-A schema: identity & access, organisations, tasks, documents, audit, idempotency.
-- Conventions: uuid ids generated in the app (UUIDv7); timestamptz in UTC; statuses as text + CHECK.

create table users (
  id                  uuid primary key,
  mobile              text unique check (mobile ~ '^09[0-9]{9}$'),
  email               text unique,
  full_name           text,
  national_code_enc   text,                        -- AES-256-GCM, app-level key
  national_code_hash  text unique,                 -- HMAC for lookups / uniqueness
  shahkar_status      text not null default 'pending' check (shahkar_status in ('pending','verified','failed')),
  shahkar_checked_at  timestamptz,
  status              text not null default 'active' check (status in ('active','locked','disabled')),
  last_login_at       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (mobile is not null or email is not null)
);

create table user_devices (
  id            uuid primary key,
  user_id       uuid not null references users(id),
  fingerprint   text not null,
  label         text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz,
  unique (user_id, fingerprint)
);

create table otp_challenges (
  id           uuid primary key,
  user_id      uuid references users(id),
  channel      text not null check (channel in ('sms','email')),
  destination  text not null,
  purpose      text not null check (purpose in ('login','step_up','contact_verify')),
  code_hash    text not null,
  action_hash  text,
  attempts     int not null default 0,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index otp_challenges_dest_idx on otp_challenges (destination, created_at desc);

create table sessions (
  id                          uuid primary key,
  user_id                     uuid not null references users(id),
  device_id                   uuid not null references user_devices(id),
  refresh_token_hash          text not null unique,
  previous_refresh_token_hash text unique,       -- reuse of a rotated token = theft → revoke
  expires_at                  timestamptz not null,
  revoked_at                  timestamptz,
  revoke_reason               text,
  created_at                  timestamptz not null default now(),
  rotated_at                  timestamptz
);

create table step_up_tokens (
  id          uuid primary key,
  user_id     uuid not null references users(id),
  token_hash  text not null unique,
  action_hash text not null,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

create table staff_roles (
  user_id    uuid not null references users(id),
  role       text not null check (role in ('super_admin','compliance_officer','finance_officer','tokenisation_officer',
                                           'analyst','external_expert','committee_member','fund_manager','auditor')),
  granted_by uuid references users(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (user_id, role)
);

create table orgs (
  id               uuid primary key,
  legal_name       text not null,
  national_id      text not null unique check (national_id ~ '^[0-9]{11}$'),
  registration_no  text,
  legal_form       text,
  is_investor      boolean not null default true,
  is_issuer        boolean not null default false,
  org_kind         text not null default 'standard' check (org_kind in ('standard','fund','platform_operator')),
  single_user_mode boolean not null default false,
  status           text not null default 'active' check (status in ('active','frozen','closed')),
  kyb_status       text not null default 'not_started'
                   check (kyb_status in ('not_started','submitted','in_review','approved','rejected','info_requested','expired')),
  kyb_expires_at   timestamptz,
  deposit_id       text unique,                    -- Jibit payment ID, assigned at KYB approval
  created_by       uuid not null references users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table org_members (
  id                    uuid primary key,
  org_id                uuid not null references orgs(id),
  user_id               uuid not null references users(id),
  role                  text not null check (role in ('org_admin','preparer','approver','viewer')),
  status                text not null default 'active' check (status in ('active','suspended','removed')),
  authority_doc_id      uuid,
  authority_verified_by uuid references users(id),
  authority_verified_at timestamptz,
  invited_by            uuid references users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (org_id, user_id)
);
create index org_members_user_idx on org_members (user_id) where status = 'active';

create table org_invitations (
  id          uuid primary key,
  org_id      uuid not null references orgs(id),
  destination text not null,                      -- normalised mobile or lower-case email
  channel     text not null check (channel in ('sms','email')),
  role        text not null check (role in ('org_admin','preparer','approver','viewer')),
  token_hash  text not null unique,
  invited_by  uuid not null references users(id),
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references users(id),
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

create table documents (
  id            uuid primary key,
  owner_type    text not null check (owner_type in ('org','user','platform')),
  owner_id      uuid,
  org_id        uuid references orgs(id),
  category      text not null,
  access_level  text not null check (access_level in ('public','owner_org','verified_investors','series_holders',
                                                      'issuer_and_fund','internal','committee','regulator_auditor')),
  filename      text not null,
  mime          text not null,
  size_bytes    bigint not null check (size_bytes > 0),
  storage_key   text not null unique,
  sha256        text check (sha256 ~ '^[0-9a-f]{64}$'),
  status        text not null default 'pending' check (status in ('pending','uploaded')),
  version       int not null default 1,
  supersedes_id uuid references documents(id),
  uploaded_by   uuid not null references users(id),
  created_at    timestamptz not null default now(),
  uploaded_at   timestamptz
);
create index documents_org_idx on documents (org_id);

create table document_access_log (
  id          uuid primary key,
  document_id uuid not null references documents(id),
  user_id     uuid not null references users(id),
  org_id      uuid,
  action      text not null check (action in ('view','download')),
  ip          text,
  at          timestamptz not null default now()
);

create table tasks (
  id               uuid primary key,
  org_id           uuid references orgs(id),      -- null = staff task
  title            text not null,
  description      text,
  linked_type      text,
  linked_id        text,
  assignee_user_id uuid references users(id),
  assignee_role    text,
  created_by       uuid references users(id),     -- null = created by a workflow
  due_date         date,
  status           text not null default 'open' check (status in ('open','in_progress','done','cancelled')),
  priority         text not null default 'p1' check (priority in ('p0','p1','p2')),
  source           text not null default 'manual' check (source in ('manual','workflow')),
  workflow_key     text,
  completed_by     uuid references users(id),
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (assignee_user_id is not null or assignee_role is not null)
);
create index tasks_org_idx on tasks (org_id, status);
create index tasks_assignee_idx on tasks (assignee_user_id, status);

create table task_comments (
  id                 uuid primary key,
  task_id            uuid not null references tasks(id),
  author_id          uuid not null references users(id),
  body               text not null check (length(body) between 1 and 5000),
  attachment_doc_ids uuid[] not null default '{}',
  created_at         timestamptz not null default now()
);

-- Append-only audit log with a hash chain (FR-AUD-1)
create table audit_log (
  id            bigserial primary key,
  at            timestamptz not null,
  actor_user_id uuid,
  actor_type    text not null check (actor_type in ('user','staff','system')),
  org_id        uuid,
  action        text not null,
  entity_type   text not null,
  entity_id     text,
  before        jsonb,
  after         jsonb,
  ip            text,
  device_id     uuid,
  prev_hash     text not null,
  hash          text not null unique
);
create index audit_log_entity_idx on audit_log (entity_type, entity_id);

create function forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'append-only table %: % is not allowed', tg_table_name, tg_op using errcode = 'P0001';
end $$;

create trigger audit_log_no_update_delete before update or delete on audit_log
  for each row execute function forbid_mutation();
create trigger audit_log_no_truncate before truncate on audit_log
  for each statement execute function forbid_mutation();

create table idempotency_keys (
  user_id      uuid not null,
  key          text not null,
  method       text not null,
  path         text not null,
  request_hash text not null,
  status_code  int,
  response     jsonb,
  created_at   timestamptz not null default now(),
  primary key (user_id, key)
);
