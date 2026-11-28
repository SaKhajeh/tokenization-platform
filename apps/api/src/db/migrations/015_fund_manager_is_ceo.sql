-- Fund answers, 2026-11-27: the fund manager is the fund's CEO (no separate role), and there is no separate credit
-- approval — the compliance officer takes the analyst's round to the fund manager.
insert into staff_roles (user_id, role) select user_id, 'fund_manager' from staff_roles where role = 'ceo' and revoked_at is null
  on conflict (user_id, role) do update set revoked_at = null;
delete from staff_roles where role = 'ceo';
alter table staff_roles drop constraint staff_roles_role_check;
alter table staff_roles add constraint staff_roles_role_check check (role in ('super_admin','compliance_officer','finance_officer','tokenisation_officer',
  'analyst','external_expert','technical_expert','committee_member','fund_manager','credit_manager','auditor'));
update assessment_rounds set state = 'pending_approval' where state = 'credit_approved';
