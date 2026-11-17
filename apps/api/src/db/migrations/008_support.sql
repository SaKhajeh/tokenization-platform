-- Comment threads, internal notes, case file access log, tickets: plan/07 §6a–§6c (D-C15, D-C17, D-C18).

-- The fund's technical expert (کارشناس فنی): receives internal notes, does site visits (part 4).
alter table staff_roles drop constraint staff_roles_role_check;
alter table staff_roles add constraint staff_roles_role_check check (role in ('super_admin','compliance_officer','finance_officer','tokenisation_officer',
  'analyst','external_expert','technical_expert','committee_member','fund_manager','auditor'));

-- ================================================================== comment threads (§6b)
create table case_comments (
  id           uuid primary key,
  case_id      uuid not null references cases(id),
  target_type  text not null check (target_type in ('item','section','fin_cell','case')),
  target_id    text not null,           -- item id, section key, "1404:sales", or the case id
  type         text not null check (type in ('to_applicant','internal','applicant_reply')),
  author_id    uuid not null references users(id),
  -- internal notes name their recipients: "role:fund_manager" or "user:<uuid>" (D-C18)
  recipients   text[] not null default '{}',
  file_version int,                     -- the file version the comment refers to, if any
  body         text not null check (length(body) between 1 and 5000),
  created_at   timestamptz not null default now(),
  check (type = 'internal' or cardinality(recipients) = 0),
  check (type <> 'internal' or cardinality(recipients) > 0)
);
create index case_comments_target_idx on case_comments (case_id, target_type, target_id, created_at);
create index case_comments_recipients_idx on case_comments using gin (recipients);

-- ================================================================== tickets (§6c)
create sequence ticket_no_seq;
create table tickets (
  id            uuid primary key,
  ticket_no     text not null unique,
  org_id        uuid not null references orgs(id),
  category      text not null check (category in ('credit_case','financing','payments_wallet','technical_login','other')),
  link_type     text check (link_type in ('case','case_item','application','withdrawal')),
  link_id       uuid,
  subject       text not null check (length(subject) between 3 and 200),
  status        text not null check (status in ('waiting_fund','waiting_applicant','closed')),
  opened_by     uuid not null references users(id),
  opened_side   text not null check (opened_side in ('applicant','fund')),
  assignee_role text,
  assignee_id   uuid references users(id),
  due_at        timestamptz,            -- target response time while waiting for the fund
  escalated_at  timestamptz,
  closed_by     uuid references users(id),
  closed_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check ((link_type is null) = (link_id is null))
);
create index tickets_org_idx on tickets (org_id, status);
create index tickets_queue_idx on tickets (status, due_at);

create table ticket_messages (
  id                 uuid primary key,
  ticket_id          uuid not null references tickets(id),
  author_id          uuid not null references users(id),
  side               text not null check (side in ('applicant','fund')),
  body               text not null check (length(body) between 1 and 5000),
  attachment_doc_ids uuid[] not null default '{}',
  created_at         timestamptz not null default now()
);
create index ticket_messages_ticket_idx on ticket_messages (ticket_id, created_at);
