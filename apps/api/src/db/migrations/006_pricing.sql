-- Pricing (master plan D25–D27): the fund's service price list, rate policy (applicant vs investor rate, spread),
-- repayment order, and service invoices that applicants pay before assessment starts.

-- ================================================================== service price list (versioned; edits add a new version)
create table service_catalogue (
  id              uuid primary key,
  code            text not null check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  version         int not null,
  title           text not null,
  description     text,
  amount          bigint not null check (amount >= 0),               -- rials, before VAT
  fund_share_bps  int not null check (fund_share_bps between 0 and 10000), -- the platform gets the rest
  charge_point    text not null check (charge_point in ('after_screening')),
  active          boolean not null default true,
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  retired_by      uuid references users(id),
  retired_at      timestamptz,
  unique (code, version)
);
create unique index service_catalogue_current on service_catalogue (code) where active;

-- ================================================================== rate policy (versioned; the latest row is in force)
create table pricing_policies (
  id                      uuid primary key,
  version                 int not null unique,
  rate_basis              text not null check (rate_basis in ('annual','monthly')),
  default_applicant_rate  numeric(9,6) not null check (default_applicant_rate > 0 and default_applicant_rate < 1),
  default_investor_rate   numeric(9,6) not null check (default_investor_rate > 0 and default_investor_rate < 1),
  min_spread              numeric(9,6) not null default 0 check (min_spread >= 0),
  waterfall_order         text not null check (waterfall_order in ('fund_first','investors_first','pro_rata')),
  vat_bps                 int not null default 0 check (vat_bps between 0 and 10000),
  note                    text,
  created_by              uuid not null references users(id),
  created_at              timestamptz not null default now(),
  check (default_investor_rate <= default_applicant_rate - min_spread)
);

-- ================================================================== invoices
create sequence invoice_no_seq;
create table invoices (
  id               uuid primary key,
  invoice_no       text not null unique,
  org_id           uuid not null references orgs(id),
  linked_type      text not null,
  linked_id        uuid not null,
  charge_point     text not null,
  status           text not null default 'issued' check (status in ('issued','paid','waived','cancelled')),
  subtotal         bigint not null check (subtotal >= 0),
  vat_bps          int not null,
  vat              bigint not null check (vat >= 0),
  total            bigint not null check (total = subtotal + vat),
  fund_share       bigint not null,
  platform_share   bigint not null check (fund_share + platform_share = subtotal),
  policy_version   int,
  issued_by        uuid references users(id),
  issued_at        timestamptz not null default now(),
  paid_by          uuid references users(id),
  paid_at          timestamptz,
  ledger_entry_id  uuid,
  closed_by        uuid references users(id),
  closed_reason    text,
  closed_at        timestamptz,
  check (status <> 'paid' or (paid_by is not null and paid_at is not null and ledger_entry_id is not null)),
  check (status not in ('waived','cancelled') or closed_reason is not null)
);
-- one open (or paid) invoice per item and charge point
create unique index invoices_one_per_item on invoices (linked_type, linked_id, charge_point) where status in ('issued','paid');
create index invoices_org_idx on invoices (org_id, status);

create table invoice_lines (
  invoice_id      uuid not null references invoices(id),
  line_no         int not null,
  service_id      uuid not null references service_catalogue(id),
  code            text not null,
  title           text not null,
  amount          bigint not null check (amount >= 0),
  fund_share_bps  int not null,
  primary key (invoice_id, line_no)
);

-- ================================================================== applications
alter table applications add column proposed_rate_basis text not null default 'annual' check (proposed_rate_basis in ('annual','monthly'));
alter table applications add column assessment_invoice_id uuid references invoices(id);
