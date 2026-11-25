-- Fund feedback, 2026-11-25 (master plan §6 item 25).

-- Four years of figures; the latest year may be a balance sheet only.
alter table case_financials drop constraint if exists case_financials_statement_type_check;
alter table case_financials add constraint case_financials_statement_type_check
  check (statement_type in ('audited','tax_return','internal','balance_sheet'));

-- مدیر اعتبارات: assigns cases to analysts and approves credit limits (as well as the fund manager).
alter table staff_roles drop constraint staff_roles_role_check;
alter table staff_roles add constraint staff_roles_role_check check (role in ('super_admin','compliance_officer','finance_officer','tokenisation_officer',
  'analyst','external_expert','technical_expert','committee_member','fund_manager','credit_manager','auditor'));

-- The fund manager can exempt a company from a fee in advance (no invoice is issued while the exemption is active).
create table fee_exemptions (
  id          uuid primary key,
  org_id      uuid not null references orgs(id),
  charge_point text not null check (charge_point in ('case_submission','after_screening')),
  reason      text not null,
  granted_by  uuid not null references users(id),
  granted_at  timestamptz not null default now(),
  revoked_by  uuid references users(id),
  revoked_at  timestamptz
);
create unique index fee_exemptions_active_idx on fee_exemptions (org_id, charge_point) where revoked_at is null;

-- Templates the fund offers for checklist items (e.g. the lease agreement), uploaded by staff, downloadable by applicants.
create table checklist_templates (
  code        text primary key,
  document_id uuid not null references documents(id),
  updated_by  uuid not null references users(id),
  updated_at  timestamptz not null default now()
);

-- A letter with a reason instead of the document (e.g. no tax return for a year).
alter table case_item_files add column alt_reason text;

-- The fund manager's adjustment of an issued limit (new coefficients or collateral class), kept as a new limit row.
alter table credit_limits add column collateral text not null default 'cheque';
alter table credit_limits add column adjusted_from uuid references credit_limits(id);
alter table credit_limits add column adjustment jsonb;

-- Existing cases: the checklist changes apply to slots already created.
update case_items set multi = true where code in ('2-3', '3-1', '3-2', '3-5', '4-4') and kind = 'checklist';
update case_items set required = 'yes' where code in ('3-1', '4-5') and kind = 'checklist';
