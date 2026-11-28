-- Fund answers, 2026-11-26 (master plan §6 item 27, doc 07 §13.2).

-- The current-year trial balance is entered as its own period (fiscal year = latest + 1), up to the end of the last
-- completed season.
alter table case_financials drop constraint case_financials_statement_type_check;
alter table case_financials add constraint case_financials_statement_type_check
  check (statement_type in ('audited','tax_return','internal','balance_sheet','trial_balance'));
alter table case_financials add column through_month int check (through_month in (3, 6, 9, 12));

-- مدیرعامل صندوق: confirms the committee meeting, edits or accepts or declines the limit.
alter table staff_roles drop constraint staff_roles_role_check;
alter table staff_roles add constraint staff_roles_role_check check (role in ('super_admin','compliance_officer','finance_officer','tokenisation_officer',
  'analyst','external_expert','technical_expert','committee_member','fund_manager','credit_manager','ceo','auditor'));

-- After the credit approval: compliance officer → CEO (committee meeting held, may edit numbers, accept or decline)
-- → compliance officer → the company.
alter table assessment_rounds add column compliance_comment text;
alter table assessment_rounds add column compliance_by uuid references users(id);
alter table assessment_rounds add column compliance_at timestamptz;
alter table assessment_rounds add column committee_meeting_on date;
alter table assessment_rounds add column ceo_decision text check (ceo_decision in ('accept','decline'));
alter table assessment_rounds add column ceo_comment text;
alter table assessment_rounds add column ceo_overrides jsonb;     -- edited ceilings {guarantee:{class:rials}, facility:{class:rials}}
alter table assessment_rounds add column ceo_by uuid references users(id);
alter table assessment_rounds add column ceo_at timestamptz;
alter table assessment_rounds add column released_by uuid references users(id);
alter table assessment_rounds add column released_at timestamptz;
