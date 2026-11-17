-- Decision D14 (master plan v0.17): in v1 the fund is the only issuer of tokens.
-- Companies are applicants ("project companies"): they request financing; the fund assesses and issues.

alter table issuer_profiles rename to applicant_profiles;

alter table orgs add column is_applicant boolean not null default false;
update orgs set is_applicant = is_issuer, is_issuer = false where org_kind <> 'fund';
-- only the fund org can be an issuer, and there is exactly one fund org
alter table orgs add constraint orgs_issuer_is_fund check (not is_issuer or org_kind = 'fund');
create unique index orgs_single_fund on orgs (org_kind) where org_kind = 'fund';

alter table initiatives rename column issuer_org_id to applicant_org_id;
alter table applications rename column issuer_org_id to applicant_org_id;

update tasks set linked_type = 'applicant_profile' where linked_type = 'issuer_profile';
update tasks set workflow_key = replace(workflow_key, 'issuer.', 'applicant.') where workflow_key like 'issuer.%';
