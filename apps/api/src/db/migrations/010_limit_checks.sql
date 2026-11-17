-- Credit case part 4b: the application's credit step is a limit check against the company's remaining norm
-- (plan/07 §9, S-11, D-C22). Applicant onboarding (issuer_profiles, FR-ISS-1) is replaced by the credit case;
-- its table is kept for history but no longer used.
create table application_limit_checks (
  id               uuid primary key,
  application_id   uuid not null references applications(id),
  credit_limit_id  uuid not null references credit_limits(id),
  ra               numeric(4,3) not null check (ra > 0 and ra <= 1),
  re               numeric(4,3) not null check (re > 0 and re <= 1),
  reason           text not null,
  amount_rials     bigint not null,
  remaining_norm_rials   bigint not null,
  project_ceiling_rials  bigint not null,
  fits             boolean not null,
  usage_id         uuid references limit_usages(id),   -- the reservation made when it fits
  checked_by       uuid not null references users(id),
  checked_at       timestamptz not null default now()
);
create index application_limit_checks_app_idx on application_limit_checks (application_id, checked_at);
