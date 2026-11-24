# Data Model & API Spec v1 (Phase 1)

_Version 1.0 draft · 2026-11-04 · Companion to plan/02-prd-v1.md (FR IDs referenced) · All PRD §16 assumptions confirmed as v1 defaults._

_Updated 2026-11-24: ledger posting map for fees, spread and disbursement (§1.6), applicants instead of issuers and the credit case (§1.8), guarantee policy removed (§1.9), series and terms with both rates (§1.10); `invitation_deliveries` (§1.2), chain outbox and `invitations.deliver` jobs as built (§2), idempotency as built (§3.1). New config: CHAIN_TX_STALE_SEC, IDEMPOTENCY_STALE_SEC._

---

## 0. Conventions

| Topic | Rule |
|---|---|
| IDs | UUIDv7 (uuid), generated in the app. Human-readable codes where useful (series_code, application_no). |
| Time | timestamptz in UTC. Calendar dates are date (Gregorian) in the DB. Jalali conversion happens at the edges (UI) and in the return engine. |
| Money | bigint rials. In the API, money is a decimal string (e.g. "125000000") so JavaScript doesn't lose precision. |
| Rates | numeric(9,6) (e.g. 0.235000 = 23.5%). In the API, a decimal string. |
| Units | bigint whole token units. |
| Enums | Postgres text + CHECK constraint (simpler migrations than native enums). |
| Soft delete | None for financial and audit tables. status columns instead. |
| Org scoping | Every org-owned table has org_id. Every query in the app API is filtered by the active org, enforced in the repository layer and covered by tests. |
| Maker–checker | Tables for approvable actions carry prepared_by, prepared_at, approved_by, approved_at, with CHECK (approved_by IS NULL OR approved_by <> prepared_by OR single_user = true); staff actions never allow single_user. |
| Versioning | Config and policy tables are versioned (version, effective_from, status). Business records point to the version that applied. |
| Timestamps | created_at, updated_at on every table (omitted below). |

## 1. Entity Model

### 1.1 Identity & Access

```
users(id, mobile UNIQUE, email UNIQUE NULL, full_name, national_code_enc, national_code_hash UNIQUE NULL,
      shahkar_status[pending|verified|failed], shahkar_checked_at, status[active|locked|disabled],
      password_hash NULL, last_login_at)
user_devices(id, user_id, device_fingerprint, label, trusted_at, revoked_at, last_seen_at)
otp_challenges(id, user_id NULL, channel[sms|email], destination, purpose[login|signup|step_up|contact_verify],
               code_hash, action_hash NULL, attempts, expires_at, consumed_at)
sessions(id, user_id, device_id, refresh_token_hash, expires_at, revoked_at)
step_up_tokens(id, user_id, action_hash, expires_at, consumed_at)          -- 5 min, single use, bound to one action
staff_roles(user_id, role[super_admin|compliance_officer|finance_officer|tokenisation_officer|analyst|
            external_expert|committee_member|fund_manager|auditor], granted_by, granted_at, revoked_at)
```

### 1.2 Organisations, Members, Tasks

```
orgs(id, legal_name, national_id UNIQUE, registration_no, legal_form, is_investor bool, is_issuer bool,
     org_kind[standard|fund|platform_operator], single_user_mode bool, status[active|frozen|closed],
     kyb_status[not_started|submitted|in_review|approved|rejected|info_requested|expired], kyb_expires_at,
     deposit_id UNIQUE)                                            -- شناسه واریز
org_members(id, org_id, user_id, role[org_admin|preparer|approver|viewer], status[invited|active|suspended|removed],
            authority_doc_id NULL, authority_verified_by NULL, authority_verified_at NULL, invited_by)
            UNIQUE(org_id, user_id)
org_invitations(id, org_id, mobile_or_email, role, token_hash, expires_at, accepted_at)
invitation_deliveries(invitation_id PK, channel[sms|email], destination, org_name, token_enc NULL /* AES-256-GCM, wiped once sent */,
                      status[queued|sent|failed|cancelled], attempts, locked_until, last_error, sent_at)   -- migration 012

tasks(id, title, description, linked_type, linked_id, org_id NULL, assignee_user_id NULL, assignee_role NULL,
      created_by NULL /* NULL = system */, due_date, status[open|in_progress|done|cancelled], priority[p0|p1|p2],
      source[manual|workflow], workflow_key NULL, completed_by, completed_at)
task_comments(id, task_id, author_id, body, attachment_doc_ids uuid[])
```

### 1.3 KYB

```
kyb_cases(id, org_id, version, status[...as orgs.kyb_status], submitted_by, submitted_at,
          provider_result jsonb, provider_checked_at, reviewer_id, reviewed_at, decision_reason, expires_at)
kyb_fields(kyb_case_id, data jsonb)                               -- address, activity, registration date, etc.
kyb_persons(id, kyb_case_id, national_code_enc, national_code_hash, full_name,
            person_role[signatory|beneficial_owner|director|representative], ownership_pct numeric(5,2) NULL,
            shahkar_status, user_id NULL)
```

### 1.4 Documents

```
documents(id, owner_type, owner_id, category, access_level[public|verified_investors|series_holders|
          issuer_and_fund|internal|committee|regulator_auditor], scope_series_id NULL, filename, mime,
          size_bytes, storage_key, sha256, version, supersedes_id NULL, uploaded_by)
document_access_log(id, document_id, user_id, org_id NULL, action[view|download], ip, at)
```

### 1.5 Bank Accounts

```
bank_accounts(id, org_id, sheba UNIQUE, bank_name, owner_name_from_inquiry,
              owner_national_id_from_inquiry, status[pending|verified|rejected|removed],
              inquiry_ref, inquiry_raw jsonb, verified_at, withdraw_enabled_at /* verified_at + 24h */,
              is_default bool, added_by, removed_by)
```

### 1.6 Ledger (money)

```
ledger_accounts(id, owner_type[org|series|platform], owner_id NULL,
                kind, series_id NULL, normal_side[debit|credit], UNIQUE(owner_type, owner_id, kind, series_id))
  kinds:
    platform: collection_bank (asset), suspense, fees_fund, fees_platform
    org:      org_available, org_reserved (per series), org_withdrawal_hold
    series:   series_escrow (raised, owed to the issuer), series_repayment (collected from the issuer, owed to holders)

account_balances(account_id PK, balance bigint, version bigint)  -- updated in the same tx as the lines, row lock
journal_entries(id, entry_type, ref_type, ref_id, description, posted_at, posted_by NULL, reverses_id NULL,
                idempotency_key UNIQUE)
journal_lines(id, entry_id, account_id, amount bigint /* +debit / −credit */)
  -- deferred constraint trigger: SUM(amount) per entry_id = 0; at least 2 lines; no UPDATE/DELETE (trigger)
```

Posting map (Dr → Cr, signed so that the lines of each entry sum to 0):

| Event | Debit | Credit |
|---|---|---|
| Deposit matched | collection_bank | org_available |
| Deposit to suspense | collection_bank | suspense |
| Suspense manually matched | suspense | org_available |
| Suspense returned (sent) | suspense | collection_bank |
| Subscribe (reserve) | org_available | org_reserved[series] |
| Release / cancel | org_reserved[series] | org_available |
| Issue (allocation) | org_reserved[series] | series_escrow[series] |
| Assessment / application fee (invoice paid; built) | org_available (applicant) | fund_revenue_services / platform_revenue_services (split) + vat_payable |
| ~~Arrangement fee~~ | — | removed (D-C21) |
| Disbursement to the project company (sent) | series_escrow | collection_bank |
| Project-company repayment received (applicant rate) | collection_bank | series_repayment[series] |
| Fund spread at payout (waterfall, D27) | series_repayment[series] | fund_revenue_spread |
| Payout to holder (investor rate) | series_repayment[series] | org_available |
| Withdrawal requested | org_available | org_withdrawal_hold |
| Withdrawal sent | org_withdrawal_hold | collection_bank |
| Withdrawal failed | org_withdrawal_hold | org_available |
| Default recovery received | collection_bank | series_repayment[series] |

Invariant (checked daily): balance of collection_bank == the bank statement closing balance.

### 1.7 Units (token holdings, mirrored on-chain)

```
holdings(series_id, org_id, units bigint CHECK (units >= 0), PRIMARY KEY(series_id, org_id))
unit_movements(id, series_id, org_id, delta bigint, kind[mint|burn|forced_transfer_in|forced_transfer_out],
               ref_type, ref_id, chain_tx_id NULL, status[pending|confirmed|failed])
```

-- holdings is updated only when its movement is confirmed on-chain

### 1.8 Applicants, Initiatives, Applications

_2026-11-24: as built, `issuer_profiles` became `applicant_profiles` and `issuer_org_id` became `applicant_org_id` on initiatives and applications (migration 004, D14); the applicant onboarding was then replaced by the credit case (doc 07 §10: cases, case items and files, financials, visits, inquiries, scoring_methods, assessment_rounds, credit_limits, limit_usages, application_limit_checks). `credit_scorecard_versions` and `credit_assessments` below are replaced by the scoring rounds and the limit check; `proposed_rate` is not used (rates come from the rate policy, D26). The tables after the limit check (DD, committee) are the v1.0 draft (D-C22). As built: `apps/api/src/db/migrations`._

```
issuer_profiles(org_id PK, status[requested|in_review|approved|rejected|suspended], tax_id, sector,
                main_activity, management jsonb, existing_debts jsonb, reviewed_by, reviewed_at, decision_reason)
initiatives(id, issuer_org_id, title, description, sector, location, started_on, progress_summary,
            status[active|completed|cancelled])
applications(id, application_no UNIQUE, initiative_id, issuer_org_id, investment_type,
             requested_amount bigint, proposed_rate numeric, proposed_duration_days int,
             proposed_rule[all_or_nothing|keep_raised], use_of_funds text, repayment_source text,
             proposed_guarantees jsonb, status /* PRD §7.1 */, current_stage_owner_id NULL,
             prepared_by, approved_by, single_user bool, submitted_at, decided_at, expires_at)
application_events(id, application_id, from_status, to_status, actor_id, reason, at)
screening_results(id, application_id, ruleset_version_id, results jsonb /* per rule pass/fail */,
                  outcome[pass|return|reject], analyst_id, comment)
credit_scorecard_versions(id, version, definition jsonb /* factors, weights, bands */, status, effective_from)
credit_assessments(id, application_id, scorecard_version_id, inputs jsonb, score numeric, grade text,
                   external_reports doc_ids uuid[], analyst_id, finalised_at)
dd_sections(id, application_id, section[financial|legal|technical|guarantee], assignee_user_id, task_id,
            status[pending|in_progress|submitted|accepted], findings text, report_doc_id)
dd_reports(id, application_id, summary, recommendation[approve|approve_with_conditions|reject],
           recommended_amount, recommended_rate, recommended_duration_days, required_guarantees jsonb,
           guarantee_policy_version_id, analyst_id, finalised_at)
committee_sessions(id, scheduled_at, quorum int, majority_rule[simple|two_thirds|unanimous],
                   status[scheduled|open|closed], minutes_doc_id)
committee_session_items(session_id, application_id, decision NULL, conditions text NULL)
committee_members_in_session(session_id, user_id, coi_declared bool)
committee_votes(id, session_id, application_id, user_id, vote[approve|approve_with_conditions|reject|abstain],
                comment, voted_at, UNIQUE(session_id, application_id, user_id))
```

### 1.9 Guarantees

```
guarantee_types(id, code, name_fa, name_en, active)
-- guarantee_policy_* : REMOVED (doc 07 §9) — collateral classes and coefficients live in scoring_methods
guarantee_policy_versions(id, version, status[draft|active|retired], effective_from, approved_by)
guarantee_policy_rules(id, policy_version_id, investment_type, credit_grade, allowed_type_ids uuid[],
                       min_coverage_pct numeric(6,2), allow_combination bool, min_buffer_days_after_maturity int)
guarantees(id, application_id, series_id NULL, type_id, guarantor_name, guarantor_national_id NULL,
           reference_no, amount bigint, issued_on, expires_on, document_id,
           verification_status[pending|verified|rejected], verification_evidence_doc_id, verified_by,
           status[active|called|released|expired])
```

### 1.10 Series & Return Engine

```
series(id, series_code UNIQUE, application_id, initiative_id, issuer_org_id /* = the fund, D14 */, applicant_org_id,
       credit_limit_id, collateral_class, pre_assessed bool, pre_assessed_on NULL /* D23 */, status /* PRD §7.2 */,
       current_terms_version_id, token_address NULL, token_symbol, token_name, terms_hash bytea NULL,
       raised_amount bigint NULL, issued_units bigint NULL, risk_status[normal|watch|at_risk],
       listing_fund_approved_by, listing_fund_approved_at,
       listing_platform_executed_by, listing_platform_approved_by, listing_platform_approved_at)
series_terms_versions(id, series_id, version, terms jsonb /* canonical JSON, PRD FR-SER-1 */,
                      terms_hash bytea, status[draft|signed|superseded],
                      issuer_signed_by, issuer_signed_at, fund_signed_by, fund_signed_at)
payout_schedule_rows(id, series_id, terms_version_id, due_date, principal_per_unit bigint,
                     return_per_unit bigint /* investor rate */, applicant_return_per_unit bigint, spread_per_unit bigint,
                     total_per_unit bigint, seq int)   -- both rates: buildSpreadSchedule in packages/domain (D26)
```

terms jsonb keys (canonical, sorted, no whitespace, before hashing; updated 2026-11-24 for D14, D23, D26, D27 and doc 07): series_code, issuer_org_id, applicant_org_id, initiative_id, financing_contract_doc_sha256, investment_type, credit_limit_ref, collateral_class, pre_assessed (+ assessed_on), face_value_per_unit, target_amount, min_amount, under_subscription_rule, rate_basis, applicant_rate, investor_rate, waterfall_order, return_model:"simple", day_count:"jalali_actual", subscription_open_at, subscription_close_at, close_on_target, allow_cancel_during_offer, issue_date, maturity_date, payout_type:"bullet", min_units_per_org, max_units_per_org, fees, guarantee_ids, disclosure_doc_sha256s, schedule:[{due_date, principal_per_unit, return_per_unit}]

### 1.11 Subscriptions, Issuance, Payouts

```
consents(id, org_id, user_id, consent_type[series_terms|risk_disclosure|issuer_visibility|platform_terms|privacy],
         document_id, document_sha256, series_id NULL, accepted_at, ip, user_agent)
subscriptions(id, series_id, org_id, units bigint, amount bigint, status[draft|pending_approval|reserved|
              allocated|released|cancelled], reserved_at /* FCFS order */, prepared_by, approved_by,
              single_user bool, consent_ids uuid[], journal_entry_id NULL)
              INDEX(series_id, reserved_at)
allocations(id, series_id, subscription_id, org_id, units, amount, unit_movement_id, journal_entry_id)
disbursements(id, series_id, gross bigint, fees bigint, net bigint, bank_account_id,
              status[prepared|approved|sent|completed|failed], bank_ref, prepared_by, approved_by, sent_at)
payout_runs(id, series_id, kind[maturity|default_distribution], due_total bigint, collected_total bigint,
            status[draft|prepared|approved|executing|completed|failed], prepared_by, approved_by)
payout_lines(id, payout_run_id, org_id, units, amount bigint, journal_entry_id, burn_movement_id NULL,
             status[pending|credited|burned])
issuer_obligations(id, series_id, due_date, amount_due bigint, amount_collected bigint,
                   status[upcoming|due|partially_paid|paid|overdue|defaulted])
```

### 1.12 Deposits & Withdrawals

```
bank_statement_imports(id, source[api|file], file_doc_id NULL, period_from, period_to, imported_by,
                       line_count, status[processing|done|failed])
bank_statement_lines(id, import_id, bank_txn_ref UNIQUE, value_date, amount bigint, direction[credit|debit],
                     counterparty_sheba NULL, deposit_id_parsed NULL, description,
                     match_status[unmatched|matched|suspense|returned|ignored],
                     matched_type NULL /* deposit|issuer_repayment|withdrawal|disbursement */, matched_id NULL,
                     journal_entry_id NULL, resolved_by NULL, resolution_reason NULL)
deposits(id, org_id, statement_line_id, amount, status[credited|suspense|returned], journal_entry_id)
withdrawals(id, org_id, bank_account_id, amount, status /* PRD 7.6 */, prepared_by, approved_by, single_user,
            finance_by, internal_approved_by NULL, bank_ref NULL, failure_reason NULL, hold_entry_id, final_entry_id)
```

### 1.13 Monitoring & Disclosures

```
reporting_schedules(id, series_id, frequency[monthly|quarterly|semiannual], next_due_date)
monitoring_reports(id, series_id, period_label, document_ids uuid[], submitted_by, submitted_at,
                   reviewed_by, status[due|submitted|accepted|returned|overdue])
material_events(id, series_id, title, body, document_ids uuid[], reported_by, reported_at,
                reviewed_by, publish_level[holders|public|internal], published_at)
```

### 1.14 Fees

```
fee_definitions(id, series_id, fee_type[application|arrangement|servicing|investor], basis[fixed|pct_of_raised|annual_pct],
                value numeric, fund_share_pct numeric(5,2), platform_share_pct numeric(5,2) CHECK(sum = 100))
fee_charges(id, fee_definition_id NULL, org_id, series_id NULL, application_id NULL, amount, journal_entry_id)
```

### 1.15 Chain

```
wallets(id, org_id UNIQUE, address UNIQUE, hd_path, signer_key_id, registry_status[pending|registered|revoked],
        registry_tx_id NULL)
chain_txs(id, purpose[register_identity|update_identity|revoke_identity|create_series|mint|burn|freeze|unfreeze|pause|unpause],
          ref_type, ref_id, payload jsonb, idempotency_key UNIQUE, from_address, nonce NULL, tx_hash NULL,
          status[queued|signed|submitted|confirmed|finalised|failed|replaced], attempts, last_error,
          gas_used NULL, effective_gas_price NULL, block_number NULL, submitted_at, finalised_at)
chain_events(id, contract_address, event_name, tx_hash, log_index, block_number, args jsonb,
             UNIQUE(tx_hash, log_index))
reconciliation_runs(id, kind[ledger_bank|ledger_chain], run_at, status[ok|mismatch|error], details jsonb)
gas_wallet_snapshots(id, address, balance_wei numeric, at)
```

### 1.16 Notifications, Audit, Config

```
notifications(id, user_id, org_id NULL, event_key, channel[in_app|sms|email], payload jsonb,
              status[queued|sent|failed|read], sent_at, read_at)
notification_templates(id, event_key, channel, locale default 'fa', subject, body, version)
audit_log(id bigserial, at, actor_user_id NULL, actor_type[user|staff|system], org_id NULL, action,
          entity_type, entity_id, before jsonb, after jsonb, ip, device_id, prev_hash bytea, hash bytea)
          -- hash = sha256(prev_hash || canonical(row)); append-only via trigger
config_settings(key PK, value jsonb, updated_by)
screening_rulesets(id, version, rules jsonb, status, effective_from)
feature_flags(key PK, enabled bool, scope jsonb)
```

---

## 2. Background Jobs & Domain Events

| Job / event | Trigger | Does |
|---|---|---|
| bank.import.process | Statement uploaded or pulled | Parse → lines → auto-match (deposit ID + verified Sheba; issuer repayment by issuer deposit ID; withdrawal/disbursement by bank_ref) → post journals → notify |
| series.open | subscription_open_at reached and status deployed | → subscription_open, notify |
| series.close | subscription_close_at or target hit with close_on_target | Apply the rule (FR-CLS-2) → subscription_closed, task for the fund manager to confirm issuance |
| series.issue | Fund manager confirms | Allocations + journals + mint chain_txs (batches of 200) → when all are finalised → issued → active |
| series.cancel | Rule outcome or admin | Release all reserves → cancelled, notify |
| obligation.notice | T-30/T-7/T-1 | Notify issuer with amount due + deposit ID |
| obligation.overdue | Due date + grace | Status overdue, task for the fund manager (wait or default) |
| payout.execute | Run approved | Credit lines → burn chain_txs → when all are burned → redeemed → closed |
| guarantee.watch | Daily | Expiry and coverage alerts (FR-GUA-5) |
| kyb.expiry | Daily | Expire KYB; revoke registry entries (FR-WAL-4) |
| recon.ledger_chain | Daily + before each payout | Compare holdings with on-chain balanceOf; a mismatch blocks payouts and raises a P0 alert |
| recon.ledger_bank | After each import | collection_bank balance vs statement closing balance |
| chain.outbox | Continuous | Sign via Web3Signer, submit, track, re-price stuck txs, mark finalised (wait for the finalized block tag). Built (10 s): a tx with no confirmed receipt after CHAIN_TX_STALE_SEC (1800 s) is re-queued; the pre-send registry check confirms it if it landed. Identity syncs are keyed by KYB event (latest KYB case + expiry) |
| invitations.deliver | Every 30 s | Send queued invitation codes (claim 2 min, 5 attempts, wipe the code when sent / cancelled / failed) |
| chain.indexer | Continuous | Index factory, registry and token events into chain_events |
| gas.watch | Every 15 min | Alert when POL < threshold |
| tasks.escalate | Hourly | Overdue escalations |
| reports.schedule | Daily | Create monitoring report tasks |

All jobs are idempotent (keyed by the business ID plus the step).

---

## 3. API

### 3.1 General

- Base: /api/v1. JSON. Auth: Authorization: Bearer <access_token> (JWT, 15 min) + refresh rotation.
- Active org: header X-Org-Id (must be an org where the user is an active member). Staff endpoints are under /api/v1/admin/* and need staff roles.
- Idempotency: Idempotency-Key header is required on every POST that moves money, units or state. As built: the response is stored with the key **inside the handler's transaction** (the handler does its writes in one transaction and returns its result), so it commits with the action. Same key + same request → replay with `Idempotent-Replay: true`; different request → 422; no response yet → 409 `IDEMPOTENCY_IN_PROGRESS`, unless older than IDEMPOTENCY_STALE_SEC (300 s): then the first request died before committing and the key is taken over. Keys are kept (no 24 h expiry yet).
- Step-up: sensitive endpoints need X-Step-Up-Token, obtained via POST /auth/step-up for that exact action (action_hash = sha256(method + path + canonical body)).
- Pagination: cursor-based (?cursor=&limit=, max 100). Filtering with ?status=&from=&to=.
- Errors: { "error": { "code": "SUBSCRIPTION_LIMIT_EXCEEDED", "message": "...", "message_fa": "...", "details": {} } }, with HTTP 400/401/403/404/409/422/429.
- Money and rates are strings. Dates are ISO YYYY-MM-DD (Gregorian); the UI converts to Jalali. Every schedule response also includes due_date_jalali for convenience.
- The OpenAPI 3.1 spec is generated from code (the source of truth after implementation).

### 3.2 Auth & Profile

```
POST /auth/otp/request            {destination, channel, purpose}
POST /auth/otp/verify             {challenge_id, code, device_fingerprint} → tokens
POST /auth/refresh                {refresh_token}
POST /auth/logout
POST /auth/step-up                {action:{method,path,body_hash}} → otp challenge
POST /auth/step-up/verify         {challenge_id, code} → step_up_token
GET  /me                          profile + memberships + staff roles
PATCH /me                         {full_name, email}
POST /me/national-code            {national_code} → triggers Shahkar
GET  /me/devices | DELETE /me/devices/{id}
```

### 3.3 Orgs, Members, Tasks

```
POST /orgs                        {legal_name, national_id, legal_form}        → org (caller = org_admin)
POST /orgs/join-request           {national_id}
GET  /orgs/current                (X-Org-Id)
PATCH /orgs/current               {single_user_mode, ...}                      [org_admin, step-up]
GET  /orgs/current/members
POST /orgs/current/invitations    {mobile_or_email, role}                      [org_admin, step-up]
POST /invitations/{token}/accept
PATCH /orgs/current/members/{id}  {role|status}                                [org_admin, step-up]
POST /orgs/current/members/{id}/authority  {document_id}

GET  /tasks?mine=true&status=     user's tasks (org + staff)
POST /tasks                       {title, linked_type, linked_id, assignee_user_id|assignee_role, due_date}
PATCH /tasks/{id}                 {status, assignee_user_id, due_date}
POST /tasks/{id}/comments         {body, attachment_doc_ids}
```

### 3.4 Documents

```
POST /documents/upload-url        {owner_type, owner_id, category, filename, mime, size} → {document_id, put_url}
POST /documents/{id}/complete     {sha256}
GET  /documents/{id}              metadata (access-checked)
GET  /documents/{id}/download     → signed URL (logged)
```

### 3.5 KYB

```
GET  /kyb                         current case
PUT  /kyb                         draft fields + persons
POST /kyb/submit                                                         [org_admin, step-up]
```

-- admin

```
GET  /admin/kyb?status=in_review
GET  /admin/kyb/{case_id}
POST /admin/kyb/{case_id}/decision {decision: approve|reject|request_info, reason, expires_at?}   [compliance]
POST /admin/members/{member_id}/authority/verify {approved, reason}                                [compliance]
```

### 3.6 Bank Accounts, Balances, Deposits, Withdrawals

```
GET  /bank-accounts
POST /bank-accounts               {sheba}                                [org_admin, step-up] → inquiry
DELETE /bank-accounts/{id}                                               [org_admin, step-up]
PATCH /bank-accounts/{id}         {is_default}

GET  /balances                    {available, reserved_total, withdrawal_hold, invested_value, by_series[]}
GET  /ledger/statement?from=&to=  org's journal lines (human-readable)
GET  /deposit-instructions        {deposit_id, collection_sheba, bank_name, notes}
GET  /deposits

POST /withdrawals                 {bank_account_id, amount}              [preparer] → requested (hold)
POST /withdrawals/{id}/approve                                           [approver, step-up]
POST /withdrawals/{id}/cancel                                            [preparer|approver, before finance]
GET  /withdrawals
```

-- admin

```
POST /admin/bank-imports          {file_document_id | source:"api", period}            [finance]
GET  /admin/bank-lines?match_status=suspense
POST /admin/bank-lines/{id}/resolve {action: match|return|ignore, org_id?, reason}      [finance/compliance]
GET  /admin/withdrawals?status=org_approved
POST /admin/withdrawals/{id}/queue                                                    [finance]
POST /admin/withdrawals/{id}/approve                                                  [fund_manager, if > threshold]
POST /admin/withdrawals/{id}/mark-sent {bank_ref}                                     [finance]
POST /admin/withdrawals/{id}/mark-failed {reason}                                     [finance]
POST /admin/bank-accounts/{id}/verify-manual {approved, reason}                       [compliance]
```

### 3.7 Digital ID

```
GET /wallet                       {address, registry_status, explorer_url, holdings_onchain[]}
```

### 3.8 Issuer & Applications (issuer side)

```
POST /issuer-profile              {tax_id, sector, ...}                  [org_admin] → requested
GET  /issuer-profile
POST /initiatives | GET /initiatives | GET /initiatives/{id} | PATCH /initiatives/{id}
POST /applications                {initiative_id, investment_type, requested_amount, ...}  → draft
PATCH /applications/{id}          (draft/returned only)
POST /applications/{id}/submit                                           [preparer→approver, step-up]
POST /applications/{id}/withdraw
GET  /applications | GET /applications/{id}  (status, events, open tasks, decision, conditions)
GET  /applications/{id}/terms     draft terms + schedule preview
POST /applications/{id}/terms/sign                                       [approver, step-up]
```

-- issuer series views

```
GET  /issuer/series               series list with raised/target, obligations
GET  /issuer/series/{id}/investors (D16)
GET  /issuer/series/{id}/obligations
POST /issuer/series/{id}/reports  {period_label, document_ids}
POST /issuer/series/{id}/material-events {title, body, document_ids}
```

### 3.9 Assessment (admin, fund side)

```
GET  /admin/issuer-profiles?status=requested
POST /admin/issuer-profiles/{org_id}/decision {decision, reason}              [compliance + analyst]
GET  /admin/applications?status=
GET  /admin/applications/{id}     full pack
POST /admin/applications/{id}/screening   {results, outcome, comment, return_items[]}   [analyst]
PUT  /admin/applications/{id}/credit      {inputs, external_report_doc_ids}  → score, grade   [analyst]
POST /admin/applications/{id}/credit/finalise                                         [analyst]
POST /admin/applications/{id}/dd-sections {section, assignee_user_id, due_date} → task  [analyst]
PATCH /admin/dd-sections/{id}     {status, findings, report_doc_id}          [assignee expert/analyst]
PUT  /admin/applications/{id}/dd-report   {...}  → includes required_guarantees from policy
POST /admin/applications/{id}/dd-report/finalise
POST /admin/committee-sessions    {scheduled_at, application_ids, member_ids, quorum, majority_rule}
POST /admin/committee-sessions/{id}/open | /close   (close → computes decisions, generates minutes PDF)
POST /admin/committee-sessions/{id}/votes {application_id, vote, comment}   [committee_member]
POST /admin/applications/{id}/guarantees  {type_id, guarantor_name, reference_no, amount, issued_on, expires_on, document_id}
POST /admin/guarantees/{id}/verify        {status, evidence_doc_id}
PUT  /admin/applications/{id}/terms       draft terms → returns schedule preview + coverage check
POST /admin/applications/{id}/terms/fund-sign                               [fund_manager, step-up]
```

### 3.10 Tokenisation & Series (admin)

```
GET  /admin/series?status=tokenisation_review
POST /admin/series/{id}/tokenisation/approve-fund                           [fund_manager, step-up]
POST /admin/series/{id}/tokenisation/execute   {token_name, token_symbol}   [tokenisation_officer, step-up]
POST /admin/series/{id}/tokenisation/approve-platform                       [2nd platform approver, step-up]
     → chain_tx create_series → deployed
POST /admin/series/{id}/close-now                                            [fund_manager]
POST /admin/series/{id}/issue                                                [fund_manager, step-up]
POST /admin/series/{id}/cancel    {reason}                                   [fund_manager, step-up]
POST /admin/series/{id}/disbursements {bank_account_id}                      [finance]
POST /admin/disbursements/{id}/approve                                       [fund_manager, step-up]
POST /admin/disbursements/{id}/mark-sent {bank_ref}                          [finance]
POST /admin/series/{id}/payout-runs {kind}                                   [finance]
POST /admin/payout-runs/{id}/approve                                         [fund_manager, step-up]
POST /admin/series/{id}/default   {reason}                                   [fund_manager, step-up]
POST /admin/guarantees/{id}/call  {reason}                                   [fund_manager]
PATCH /admin/series/{id}/risk-status {risk_status, note}                     [analyst]
POST /admin/material-events/{id}/publish {publish_level}                     [analyst]
POST /admin/chain/freeze          {org_id, reason}                           [compliance → tokenisation]
GET  /admin/chain/txs?status= | GET /admin/recon/runs
```

### 3.11 Offerings & Subscriptions (investor side; some endpoints public)

```
GET  /public/offerings?status=open|upcoming|completed
GET  /public/offerings/{series_code}        public fields + public docs + progress
GET  /offerings/{series_code}               + gated docs if KYB approved
GET  /offerings/{series_code}/schedule      per-unit schedule with Jalali dates
POST /subscriptions/quote         {series_code, units} → {amount, fees, eligible, reasons[], consents_required[]}
POST /subscriptions               {series_code, units, consents:[{type, document_id, sha256}]}  [preparer] → pending_approval
POST /subscriptions/{id}/approve                                            [approver, step-up] → reserved
PATCH /subscriptions/{id}         {units}  (reduce; series open, cancel allowed)
POST /subscriptions/{id}/cancel
GET  /subscriptions | GET /portfolio        holdings, schedule, maturity countdown, explorer links
GET  /portfolio/{series_code}/documents     holder-level docs, reports, material events
```

### 3.12 Notifications, Config, Reports, Audit

```
GET  /notifications | POST /notifications/{id}/read
GET  /admin/config/{key} | PUT /admin/config/{key}                           [super_admin / fund_manager by key]
GET  /admin/scorecards | POST /admin/scorecards (new version) | POST /admin/scorecards/{id}/activate
GET  /admin/guarantee-policies | POST ... | POST /admin/guarantee-policies/{id}/activate   [fund_manager]
GET  /admin/screening-rulesets | POST ... | activate
GET  /admin/reports/{report_key}?from=&to=&format=json|xlsx
GET  /admin/audit?entity_type=&entity_id=&actor=                             [auditor, super_admin]
POST /admin/staff/{user_id}/roles {add[], remove[]}                          [super_admin, step-up]
```

### 3.13 Example: subscription quote → create → approve

```http
POST /api/v1/subscriptions/quote
X-Org-Id: 0192f…
{"series_code":"RTF-1405-001","units":50}

200 {"amount":"500000000","fees":"0","eligible":true,"reasons":[],
     "consents_required":[
       {"type":"series_terms","document_id":"…","sha256":"ab12…"},
       {"type":"risk_disclosure","document_id":"…","sha256":"cd34…"},
       {"type":"issuer_visibility","document_id":"…","sha256":"ef56…"}]}

POST /api/v1/subscriptions            Idempotency-Key: 7f…
{"series_code":"RTF-1405-001","units":50,"consents":[…]}
201 {"id":"…","status":"pending_approval"}

POST /api/v1/subscriptions/{id}/approve   X-Step-Up-Token: …   Idempotency-Key: 8a…
200 {"id":"…","status":"reserved","reserved_at":"2026-11-20T08:12:03Z"}
```

---

## 4. Return Engine — Reference Algorithm

```ts
// Inputs: faceValue (bigint rial), annualRate (Decimal), issueDate, maturityDate (Gregorian Date)
// Uses jalaali-js: toJalaali(date), isLeapJalaaliYear(jy)
function yearFraction(issue: Date, maturity: Date): Decimal {
  let f = new Decimal(0);
  for (let d = issue; d < maturity; d = addDays(d, 1)) {   // issue date included, maturity excluded
    const jy = toJalaali(d).jy;
    f = f.plus(new Decimal(1).div(isLeapJalaaliYear(jy) ? 366 : 365));
  }
  return f;
}
returnPerUnit = floor(faceValue × annualRate × yearFraction(issue, maturity))   // round down to the rial
totalPerUnit  = faceValue + returnPerUnit
holderPayout  = totalPerUnit × units
issuerDue     = totalPerUnit × issuedUnits
```

Required tests: a series fully inside one common year; one fully inside a leap year (e.g. 1403 is a Jalali leap year; verify with the library); one spanning a year boundary; a 1-day series; a large face value (no overflow, using Decimal/bigint throughout).

---

## 5. Smart Contract Interfaces (Solidity sketch)

```solidity
interface IIdentityRegistry {
  function register(address wallet, bytes32 orgIdHash, uint8 flags, bytes32 kybHash, uint64 expiry) external; // REGISTRAR
  function update(address wallet, uint8 flags, bytes32 kybHash, uint64 expiry) external;                      // REGISTRAR
  function revoke(address wallet) external;                                                                    // REGISTRAR
  function isVerified(address wallet) external view returns (bool); // registered && !revoked && expiry > now
  event IdentityRegistered(address indexed wallet, bytes32 orgIdHash, uint8 flags, uint64 expiry);
  event IdentityUpdated(address indexed wallet, uint8 flags, uint64 expiry);
  event IdentityRevoked(address indexed wallet);
}

interface ISeriesFactory {
  function createSeries(string calldata name, string calldata symbol, bytes32 seriesIdHash,
                        bytes32 termsHash, uint64 maturity, uint256 maxSupply) external returns (address); // DEPLOYER
  event SeriesCreated(address indexed token, bytes32 indexed seriesIdHash, bytes32 termsHash, uint64 maturity, uint256 maxSupply);
}

interface ISeriesToken /* ERC20, decimals()=0, Pausable, AccessControl */ {
  function termsHash() external view returns (bytes32);
  function maturity() external view returns (uint64);
  function maxSupply() external view returns (uint256);
  function transfersEnabled() external view returns (bool);
  function mint(address to, uint256 amount) external;                 // MINTER; requires registry.isVerified(to) && !frozen[to]
  function burn(address from, uint256 amount) external;               // BURNER
  function freeze(address a) external; function unfreeze(address a) external;   // FREEZER (operator) / admin
  function forcedTransfer(address from, address to, uint256 amount, bytes32 reasonHash) external; // ADMIN (Safe)
  function setTransfersEnabled(bool on) external;                     // ADMIN (Safe) — Phase 3
  event Frozen(address indexed a); event Unfrozen(address indexed a);
  event ForcedTransfer(address indexed from, address indexed to, uint256 amount, bytes32 reasonHash);
}
// _update hook: if from != 0 && to != 0 (holder transfer) → require(transfersEnabled || msg.sender has ADMIN for forcedTransfer path);
//               require(!frozen[from] && !frozen[to]); require(to == 0 || registry.isVerified(to)).
```

Hash conventions: orgIdHash = keccak256(org.id || platform_salt), seriesIdHash = keccak256(series.id). termsHash = SHA-256 of the canonical terms JSON, stored as bytes32.

---

## 6. Suggested Repo Layout (for Claude Code)

```
/apps
  /api            NestJS modular monolith (modules mirror PRD M1–M19)
  /worker         job runners (same codebase, different entrypoint)
  /web            Next.js: public site + investor/issuer PWA (fa, RTL)
  /admin          Next.js: service app (staff)
/packages
  /domain         shared types, enums, state machines, money and Jalali utils, return engine
  /ui             RTL design system (tokens, components)
  /contracts      Foundry/Hardhat project: IdentityRegistry, SeriesFactory, SeriesToken + tests
  /sdk            generated API client from OpenAPI
/infra            docker-compose (postgres, redis, minio, openbao, web3signer, polygon node or RPC for dev), CI
/docs             links to project plan docs
```

---

## 7. Next deliverables

1. UX flows & Farsi screen inventory (investor/issuer PWA, service app)
2. Smart contract implementation + tests (Amoy)
3. Repo scaffold + M-A milestone (auth, orgs, tasks, audit, documents)
