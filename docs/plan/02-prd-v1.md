# PRD v1 — Tokenization Platform (Phase 1 Pilot)

_Version 1.0 draft · 2026-11-04 · Owner: Salman Khajeh · Language: English spec, Farsi product UI Source of decisions: plan/01-master-plan.md (D1–D18)_

_Updated 2026-11-24: FR-ORG-3 (invitation codes through an outbox) and §12.4 (idempotency recorded with the action). Still to align with doc 07 (credit grade → credit limit) and D14 (issuers → applicants); where they differ, 07 and 01 win._

---

## 1. Overview

### 1.1 Product

A Farsi, mobile-first (responsive web/PWA) platform where:

- Issuers (the research & technology fund and third-party businesses) apply to raise money for initiatives that have already started and have a guaranteed return.
- The fund assesses each initiative (screening, credit assessment, due diligence, committee decision) and approves it.
- The platform tokenises approved series on Polygon PoS. Each token is one unit of a fixed-return note.
- Investors (legal entities in v1) complete KYB, fund their balance from their own verified bank account, subscribe, hold tokens in a custodial wallet (their on-chain digital ID), and receive principal + return at maturity.

### 1.2 Goals (Phase 1)

- G1. Run 1–3 of the fund's own series end to end: application → assessment → tokenisation → subscription → issuance → payout → redemption.
- G2. Onboard invited third-party issuers through the same pipeline.
- G3. A complete, auditable money trail: every rial is reconciled between bank statement, ledger and chain.
- G4. Investors pay zero fees for blockchain actions; every holding can be verified on Polygonscan.

### 1.3 Non-goals (Phase 1)

- Individual (natural person) investors or issuers.
- Secondary market, peer-to-peer transfers, order book.
- Compound return, periodic coupons (bullet payout at maturity only).
- Self-custody wallets, investor-signed transactions.
- Multiple funds (tenants).
- Native mobile apps (a PWA is enough; native shells later).

### 1.4 Success metrics

- Time from KYB submission to approval ≤ 2 business days (median).
- Deposit auto-match rate ≥ 95% (deposits matched by deposit ID without manual work).
- 0 unreconciled differences between ledger and chain at daily close.
- Payout run completed on the due date for 100% of matured series.

---

## 2. Glossary

| Term | Meaning |
|---|---|
| Organisation (Org) | A legal entity on the platform. Types: investor, issuer, fund, platform_operator. One org can be investor and issuer at once. |
| Member | A user linked to an org, with org roles. |
| Initiative | The real-world project or investment an issuer raises money for. |
| Application | An issuer's request to raise money for an initiative; goes through the assessment pipeline. |
| Series | One tokenised issuance for an initiative, with frozen terms. One initiative may have several series over time. |
| Unit / Token | One unit of a series = one token (0 decimals). Face value is set per series (e.g. 10,000,000 IRR). |
| Balance | An org's rial balance in the platform ledger (held legally in the fund's collection account). |
| Digital ID | The org's custodial Polygon address, registered in IdentityRegistry. |
| Sponsor / Assessor | The fund: assesses and approves initiatives. |
| Tokenisation operator | The platform company: configures, deploys and mints tokens and runs the registry. |
| Credit grade | The output of the credit assessment (e.g. A, B, C, D). It drives the guarantee requirements. |

## 3. Actors & Roles

### 3.1 Org roles (inside any org)

| Role | Can |
|---|---|
| org_admin | Manage org profile, members, roles and bank accounts; everything approver can do. |
| preparer | Draft subscriptions, withdrawals, applications, reports and task responses. |
| approver | Approve money actions and submissions that a preparer drafted (OTP). |
| viewer | Read-only. |

Single-user mode (D17): if an org has exactly one active member and single_user_mode = true, that member is both preparer and approver. Every money action or submission then needs an OTP step-up at approval. When a second member joins, org_admin can switch the org to dual control.

### 3.2 Platform roles (staff of the fund and of the platform operator)

| Role | Belongs to | Responsibilities |
|---|---|---|
| super_admin | Platform operator | System config, staff accounts, emergency pause. |
| compliance_officer | Platform operator (the fund can also have one) | KYB review, bank account verification exceptions, AML flags, freeze/unfreeze. |
| finance_officer | Platform operator | Deposit reconciliation, withdrawals (prepare), disbursements (prepare), payout runs (prepare). |
| tokenisation_officer | Platform operator | Configure token from approved terms, deploy, mint/burn requests, chain monitoring. |
| analyst | Fund | Screening, credit assessment, DD coordination, monitoring. |
| external_expert | Fund (guest) | Access only to the applications assigned to them by task; submits evaluation reports. |
| committee_member | Fund | Votes on applications. |
| fund_manager | Fund | Final approval of terms and listing; approves withdrawals/disbursements/payout runs above a threshold; calls guarantees. |
| auditor | External / fund | Read-only across everything, including the audit log. |

A staff user may hold several roles, but the maker–checker rule (§12.3) stops the same person from preparing and approving the same action.

---

## 4. Scope summary (Phase 1)

| Module | In v1 |
|---|---|
| M1 Auth & accounts | ✅ |
| M2 Orgs, members, roles, tasks | ✅ |
| M3 KYB | ✅ |
| M4 Bank accounts | ✅ |
| M5 Digital ID & custodial wallets | ✅ |
| M6 Ledger, deposits, withdrawals | ✅ |
| M7 Issuer onboarding & applications | ✅ |
| M8 Assessment (screening, credit, DD, committee) | ✅ |
| M9 Guarantee policy & guarantees | ✅ |
| M10 Series terms & return engine | ✅ |
| M11 Tokenisation & chain | ✅ |
| M12 Offering & subscription | ✅ |
| M13 Close, issuance, disbursement | ✅ |
| M14 Maturity, payout, redemption, default | ✅ |
| M15 Monitoring & disclosures | ✅ |
| M16 Documents & access control | ✅ |
| M17 Notifications | ✅ |
| M18 Fees | ✅ |
| M19 Admin, config, audit, reports | ✅ |
| Public site (fund website + offerings) | ✅ |

## 5. Functional Requirements

Requirement IDs: FR-<module>-<n>. Priority: P0 = must-have for the pilot, P1 = should-have, P2 = nice-to-have.

### M1 — Auth & Accounts

- FR-AUTH-1 (P0) Sign up with a mobile number (OTP by SMS) or an email (OTP by email). Both can be linked later; a mobile number is required before any money action.
- FR-AUTH-2 (P0) Login with OTP. Optional password + OTP. Sessions use short-lived access tokens and rotating refresh tokens.
- FR-AUTH-3 (P0) Device binding: a new device needs OTP; list and revoke devices.
- FR-AUTH-4 (P0) Step-up OTP for sensitive actions: approving money actions, changing bank accounts, changing members/roles, signing terms.
- FR-AUTH-5 (P1) Rate limits and lockouts on OTP and login. Alert on login from a new device.
- FR-AUTH-6 (P0) A user profile holds name, national code, mobile and email. Shahkar verification (mobile ↔ national code) is required before the user can act for an org.

### M2 — Organisations, Members, Roles, Tasks

- FR-ORG-1 (P0) A verified user can create an org (enter شناسه ملی) and becomes its org_admin. If the شناسه ملی already exists, they can request to join instead.
- FR-ORG-2 (P0) An org can be flagged investor, issuer or both. The issuer flag is enabled after issuer onboarding (M7).
- FR-ORG-3 (P0) org_admin invites members by mobile/email, assigns org roles, and suspends or removes them. Every change is audited. The invitation code is delivered through an outbox written with the invitation (retried until sent; stored encrypted until then), so a created invitation always gets its code.
- FR-ORG-4 (P0) A user can belong to several orgs and switch the active org in the app header.
- FR-ORG-5 (P0) Single-user mode setting (D17), with its rules in §3.1.
- FR-ORG-6 (P0) Each representative must show authority to act: named in the latest روزنامه رسمی as a signatory, or an uploaded معرفی‌نامه / power of attorney signed by the signatories. Compliance verifies it.
- FR-TASK-1 (P0) A generic task object: title, description, linked_entity (type+id), assignee (user or role), creator, due_date (Jalali), status (open|in_progress|done|cancelled), comments, attachments.
- FR-TASK-2 (P0) Tasks can be created manually (by org admins or staff) and automatically by workflows (e.g. "Upload guarantee document" when screening returns an application).
- FR-TASK-3 (P0) Task inbox per user and per role queue, with filters, overdue highlight and notifications.
- FR-TASK-4 (P1) Reassign and escalate when overdue (e.g. after N days, notify the next role up).

### M3 — KYB (entity verification)

- FR-KYB-1 (P0) KYB form: legal name, شناسه ملی, registration number, registration date, legal form, address, postcode, phone, activity, website. Uploads: founding documents (اساسنامه), the latest روزنامه رسمی for signatories, and the latest change notice.
- FR-KYB-2 (P0) Signatories and beneficial owners: national code, name, ownership %, role. Each signatory/representative gets a Shahkar check.
- FR-KYB-3 (P0) Automatic checks through the KYB provider where available: the company exists, its status is active, the registered name matches. Results are stored with the raw response.
- FR-KYB-4 (P0) Compliance review queue: approve / reject / request more information (this creates a task for the org). The reason is mandatory.
- FR-KYB-5 (P0) KYB states: not_started → submitted → in_review → (approved | rejected | info_requested). approved has an expiry date (default 12 months) and goes to expired when it passes.
- FR-KYB-6 (P0) KYB must be approved before the org can deposit, subscribe or (as issuer) apply.
- FR-KYB-7 (P1) Re-KYB is triggered by changes to signatories or key fields, or by expiry.

### M4 — Bank Accounts

- FR-BANK-1 (P0) The org adds a Sheba (IR + 24 digits), validated by checksum.
- FR-BANK-2 (P0) An ownership inquiry service checks that the account owner's national ID equals the org's شناسه ملی. On a match the account is verified; otherwise rejected, with manual review by compliance.
- FR-BANK-3 (P0) Multiple verified accounts are allowed. One is the default for withdrawals.
- FR-BANK-4 (P0) Adding or removing an account needs org_admin + step-up OTP. A newly verified account is locked for withdrawals for 24 h (cool-down).
- FR-BANK-5 (P0) Issuer disbursements go only to a verified account of the issuer org.

### M5 — Digital ID & Custodial Wallets

- FR-WAL-1 (P0) When KYB is approved, the system derives a custodial address for the org (HD path per org) and registers it in IdentityRegistry with {orgTypeFlags, kybHash, expiry}.
- FR-WAL-2 (P0) The private key never leaves the signing service (Web3Signer + OpenBao). App servers request signatures by key ID only.
- FR-WAL-3 (P0) The org's "Digital ID" screen shows its address, verification status, holdings per series on-chain, and links to Polygonscan.
- FR-WAL-4 (P0) If KYB expires or the org is frozen, the registry entry is updated (verified=false). Tokens stay, but the org can't receive new mints.
- FR-WAL-5 (P1) Option to generate a fresh address per series for privacy. Default: one address per org.

### M6 — Ledger, Deposits, Withdrawals

- FR-LED-1 (P0) Double-entry ledger. All amounts are integer rials (BIGINT); toman is a display option only.
- FR-LED-2 (P0) Accounts per org: available, reserved, invested (investor side); issuer_payable, issuer_collected (issuer side). Platform accounts: collection_bank, fees_fund, fees_platform, suspense.
- FR-LED-3 (P0) Every movement is an immutable journal entry with a reference to its source (deposit, subscription, series, payout…). There are no edits; corrections are reversal entries.
- FR-DEP-1 (P0) Each org gets a unique deposit ID (شناسه واریز) shown in the app, with the collection bank's Sheba and instructions.
- FR-DEP-2 (P0) Bank statement ingestion: an API if the bank supports it, otherwise a file upload (CSV/Excel). Each credit line is matched by deposit ID and source Sheba ∈ the org's verified accounts.
- FR-DEP-3 (P0) Matched → credit available and notify. Unmatched, or from an unverified account → suspense, with a compliance task. The resolution is either to match manually (with a reason) or to return to the sender.
- FR-DEP-4 (P1) Card payment gateway (IPG) top-up for small amounts, behind a feature flag.
- FR-WDR-1 (P0) Withdrawal request: amount ≤ available, destination = a verified account. Flow: preparer → approver (or single-user step-up) → finance prepares the bank transfer → fund_manager approval above a threshold → paid → confirmed with the bank reference.
- FR-WDR-2 (P0) Withdrawal states: requested → org_approved → finance_queued → (approved_internal) → sent → completed | failed (funds return to available).
- FR-WDR-3 (P0) On request, the amount moves from available to a withdrawal_hold, so it can't be double-spent.

### M7 — Issuer Onboarding & Applications

- FR-ISS-1 (P0) A KYB-approved org can request issuer status. Extra information: financial statements (last 2 years if available), tax ID, main activity, management team, existing debts. Compliance and an analyst review it; on approval the issuer flag is set.
- FR-ISS-2 (P0) The fund org is pre-configured as an issuer.
- FR-APP-1 (P0) Application form:
  - Initiative: title, description, sector, location, start date, current progress, evidence that it has started (contracts, invoices, progress reports).
  - Raise: amount requested, proposed annual rate, proposed duration, proposed under-subscription rule, use of funds.
  - Repayment source.
  - Proposed guarantees.
  - Documents.
- FR-APP-2 (P0) Save drafts; submit needs preparer + approver (or a single-user step-up).
- FR-APP-3 (P1) Application fee (configurable; can be 0) charged from the issuer's available balance at submission.
- FR-APP-4 (P0) The issuer sees the application status, open tasks/questions from the fund, and the history.
- FR-APP-5 (P0) Application states: draft → submitted → screening → (returned ↔ resubmitted) → credit_assessment → due_diligence → committee → (approved | approved_with_conditions | rejected) → terms_negotiation → terms_signed → handed_to_tokenisation. Also withdrawn (by the issuer) and expired (inactive for N days).

### M8 — Assessment (Fund side)

- FR-ASM-1 (P0) Screening: a completeness checklist and eligibility rules, configurable (e.g. initiative started = yes; amount within [min, max]; issuer not blocked; sector allowed). The analyst marks it pass/fail with a comment. "Return" creates tasks for the issuer listing what is missing.
- FR-ASM-2 (P0) Credit assessment: the analyst completes a configurable credit scorecard (financial ratios, track record, repayment-source strength, sector risk, qualitative factors). The system computes a score → credit grade (configurable bands, e.g. A/B/C/D) and stores the inputs. Uploaded external credit reports (e.g. a rating agency report or bank inquiry) are attached.
- FR-ASM-3 (P0) Due diligence: a DD workspace with sections (financial, legal/contract, technical, guarantee verification). The analyst assigns sections to external_experts through tasks. Experts see only the assigned application and upload their reports and findings. Guarantee verification: record the confirmation from the guarantor (a letter or inquiry reference).
- FR-ASM-4 (P0) DD report: a summary, a recommendation (approve / with conditions / reject), recommended terms (amount, rate, duration) and the required guarantees from the policy matrix (M9).
- FR-ASM-5 (P0) Committee: the analyst schedules a committee session with one or more applications. Members see the DD pack and vote approve | approve_with_conditions | reject | abstain, with comments. Quorum and the majority rule are configurable. Minutes are generated automatically (who, when, votes, conditions) and stored as a PDF.
- FR-ASM-6 (P0) The decision is sent to the issuer. If conditions are attached, they become tasks for the issuer.
- FR-ASM-7 (P0) Conflict of interest: a committee member or expert linked to the issuer org cannot vote or review it (blocked if they are a member of that org; otherwise self-declared).

### M9 — Guarantee Policy & Guarantees

- FR-GUA-1 (P0) A configurable list of guarantee types: e.g. bank guarantee (ضمانت‌نامه بانکی), insurance policy, fund guarantee, collateral (property or securities), corporate guarantee, promissory note (سفته) or cheque.
- FR-GUA-2 (P0) A policy matrix: investment_type × credit_grade → {allowed guarantee types, minimum coverage % of (principal + return), whether combinations are allowed}. It is maintained by the fund_manager and versioned; each application records which policy version applied.
- FR-GUA-3 (P0) Each guarantee record holds: type, guarantor, reference no., amount, issue date, expiry date, document, verification status and verification evidence.
- FR-GUA-4 (P0) Listing is blocked unless the guarantees meet the matrix requirement and every guarantee expires ≥ N days (configurable, default 30) after maturity.
- FR-GUA-5 (P0) Daily job: alert analyst + fund manager when a guarantee will expire within X days, and when coverage falls below the requirement.

### M10 — Series Terms & Return Engine

- FR-SER-1 (P0) Series terms (frozen at terms_signed): series_code, initiative_id, issuer_org_id, contract_type, contract_doc, investment_type, credit_grade, face_value_per_unit, target_amount, min_amount (nullable), under_subscription_rule (all_or_nothing | keep_raised), annual_rate (decimal, e.g. 0.2350), return_model = simple, day_count = jalali_actual, subscription_open_at, subscription_close_at, issue_date, maturity_date, payout_type = bullet, min_subscription_per_org, max_subscription_per_org, fees (see M18), disclosure_docs[], guarantees[].
- FR-SER-2 (P0) target_amount and min_amount must be multiples of face_value_per_unit. Subscriptions are in whole units.
- FR-SER-3 (P0) The return engine computes the per-unit payout schedule (§8.3) and shows it for review before terms are signed. Signing freezes it. The terms JSON (canonical form) + schedule are hashed with SHA-256 → termsHash.
- FR-SER-4 (P0) Series states: draft → terms_signed → tokenisation_review → deployed → subscription_open → subscription_closed → (issued | cancelled) → active → matured → paid_out → redeemed → closed, plus defaulted (from matured).
- FR-SER-5 (P0) Any change after terms_signed is not allowed. The series is cancelled and a new one created (before subscriptions open only).

### M11 — Tokenisation & Chain (Platform operator)

- FR-TOK-1 (P0) When terms are signed, the series enters the tokenisation_review queue. The tokenisation_officer checks that the terms are technically complete and that the token config matches them (name, symbol, units, maturity, termsHash).
- FR-TOK-2 (P0) Listing approval requires both: (a) fund_manager approval of the terms and listing (the fund's assessment authority), and (b) tokenisation_officer execution plus a second platform approver (the platform's authority). Both are recorded.
- FR-TOK-3 (P0) Deployment: SeriesFactory.createSeries(...) deploys a SeriesToken. Its address is stored and the series goes to deployed.
- FR-TOK-4 (P0) All chain writes go through an outbox: an idempotent job with a nonce manager, gas estimation, retries, and confirmation tracking (waiting for Polygon finality before the business state is marked done).
- FR-TOK-5 (P0) Chain events are indexed into the DB. A daily reconciliation compares the ledger's invested units per org per series with on-chain balanceOf. Any mismatch triggers a P0 alert and blocks payout runs.
- FR-TOK-6 (P0) Gas wallet monitoring: POL balance threshold alert; a documented top-up procedure.
- FR-TOK-7 (P0) Emergency: super_admin can pause a series token or the factory (via the multisig). Compliance can freeze an address (registry verified=false + token freeze).

### M12 — Offering & Subscription

- FR-OFF-1 (P0) Public offering page (on the public site): title, issuer (name and profile), summary, rate, duration, face value, target, min, rule, Jalali dates, credit grade, guarantee summary, public documents, progress bar (raised / target), countdown.
- FR-OFF-2 (P0) Documents tagged verified_investors or higher are visible only to logged-in orgs with approved KYB (M16).
- FR-SUB-1 (P0) Subscribe: choose the number of units; the system checks per-org min/max, remaining capacity, KYB valid, and that available ≥ amount (+ fees if any are charged to investors — default none).
- FR-SUB-2 (P0) Before confirming, the investor must accept: the series terms document, the risk disclosure, and the consent to share the org's identity and subscription amount with the issuer (D16). The accepted versions are recorded with a timestamp, user and IP.
- FR-SUB-3 (P0) Flow: preparer drafts → approver confirms with OTP (or single-user step-up) → available → reserved.
- FR-SUB-4 (P0) While subscription is open, the investor can cancel or reduce a subscription (reserved → available) unless the series disables it (allow_cancel_during_offer, default true).
- FR-SUB-5 (P0) Over-subscription: first come, first served by approval timestamp. Once capacity is full, new subscriptions are rejected. (Pro-rata allocation is P2.)
- FR-SUB-6 (P0) Subscription states: draft → pending_approval → reserved → (allocated | released | cancelled).

### M13 — Close, Issuance, Disbursement

- FR-CLS-1 (P0) At subscription_close_at (or early close when the target is reached and close_on_target = true), the system computes raised.
- FR-CLS-2 (P0) Apply the rule:
  - all_or_nothing and raised < target → cancelled: release all reserves and notify.
  - keep_raised and raised < min → cancelled.
  - Otherwise → issue for the raised amount; the payout schedule is recalculated on the actual principal, the totals are shown to the fund manager, and termsHash stays the same (the schedule per unit doesn't change).
- FR-CLS-3 (P0) Issuance: fund_manager confirms → for each allocation, reserved → invested and mint units to the org's address (batched) → series issued → active.
- FR-CLS-4 (P0) Disbursement to the issuer: raised − arrangement fee (and any other upfront fees) → finance prepares the transfer to the issuer's verified Sheba → fund manager approves → sent → confirmed. Ledger: collection → issuer_payable → paid.
- FR-CLS-5 (P0) The issuer sees its investor list (org name, شناسه ملی, units, amount) per D16. Export is P1.

### M14 — Maturity, Payout, Redemption, Default

- FR-PAY-1 (P0) Payment notices to the issuer at T-30, T-7 and T-1 days before maturity: the amount due = Σ(principal + return) over all units, plus the issuer's deposit ID.
- FR-PAY-2 (P0) The issuer pays into the collection account → matched → issuer_collected for that series.
- FR-PAY-3 (P0) Payout run (on or after maturity, once collected ≥ due): finance prepares → fund manager approves → for each holder, credit available with the per-unit schedule amount × units (rounding §8.3) → burn the tokens → series paid_out → redeemed → closed.
- FR-PAY-4 (P0) Partial collection: the payout run is blocked. The fund manager can either (a) wait (grace period, configurable, default 5 business days) or (b) declare default.
- FR-PAY-5 (P0) Default: series defaulted → tasks to call the guarantees → as recoveries are collected, the fund manager runs distributions pro-rata by units (several runs allowed) → tokens are burned at the final distribution. Every step is notified to holders.
- FR-PAY-6 (P1) Late-payment penalty terms (if the contract has them) are recorded and distributed.

### M15 — Monitoring & Disclosures

- FR-MON-1 (P0) Each series has a reporting schedule (e.g. quarterly). The system creates "Submit progress report" tasks for the issuer.
- FR-MON-2 (P0) The issuer can file a material event report at any time (delay, change, risk). The analyst reviews it and publishes it to holders (and to the public, if marked so).
- FR-MON-3 (P0) The analyst can update the series' risk status (normal | watch | at_risk); holders are notified on changes.
- FR-MON-4 (P1) Overdue reports escalate to the fund manager.

### M16 — Documents & Access Control

- FR-DOC-1 (P0) Every file carries: owner entity, category, access level, version, uploader, SHA-256 hash and timestamps.
- FR-DOC-2 (P0) Access levels: public, verified_investors (any org with approved KYB), series_holders (orgs holding or subscribed to that series), issuer_and_fund, internal (fund + platform staff), committee, regulator_auditor.
- FR-DOC-3 (P0) Downloads of non-public documents are logged (who, when). An optional watermark with the org name is P1.
- FR-DOC-4 (P0) Files are stored in MinIO (S3-compatible), encrypted at rest. Signed short-lived URLs.

### M17 — Notifications

- FR-NOT-1 (P0) Channels: in-app, SMS, email. Per-event templates in Farsi.
- FR-NOT-2 (P0) Mandatory events include: OTP, KYB result, bank verified/rejected, deposit credited/suspended, subscription confirmed/released, series issued/cancelled, payout credited, withdrawal status, task assigned or overdue, application status change, material events, default.
- FR-NOT-3 (P1) User preferences for non-mandatory events.

### M18 — Fees

- FR-FEE-1 (P0) Fee types are configurable per series: application_fee (fixed, charged to the issuer at submission), arrangement_fee (% of raised, deducted at disbursement), servicing_fee (annual %, deducted from collected funds or invoiced — P1), investor_fee (default 0).
- FR-FEE-2 (P0) Each fee has a split rule between fees_fund and fees_platform (percentages).
- FR-FEE-3 (P1) Fee invoices (PDF) for issuers.

### M19 — Admin, Config, Audit, Reports

- FR-ADM-1 (P0) Config screens: eligibility rules, credit scorecard and grade bands, guarantee types and policy matrix, approval thresholds, KYB expiry, grace periods, notification templates, feature flags.
- FR-ADM-2 (P0) Staff user management with role assignment (super_admin only), with step-up.
- FR-AUD-1 (P0) An append-only audit log for every state change and sensitive read: actor, org, action, entity, before/after, IP, device, timestamp. A hash chain (each entry includes the hash of the previous one) makes tampering detectable.
- FR-REP-1 (P0) Reports:
  - Daily reconciliation (bank ↔ ledger ↔ chain).
  - Series book (subscriptions, holders, units).
  - Investor statement per org (Jalali period).
  - Issuer obligations calendar.
  - Fee report.
  - KYB/compliance queue metrics.
  - Export to Excel.

#### Public site (the fund website)

- FR-WEB-1 (P0) Home: about the fund, how it works, open/upcoming/completed offerings, stats (total raised, number of series).
- FR-WEB-2 (P0) Offering list and detail (FR-OFF-1), "how to invest", FAQ, contact, legal pages (terms, privacy, risk).
- FR-WEB-3 (P0) "Raise funds" page for prospective issuers → sign up → issuer onboarding.
- FR-WEB-4 (P1) Basic CMS for news and pages.

---

## 6. Key User Flows (summary)

F1 Investor onboarding: Sign up (OTP) → Shahkar → create org (شناسه ملی) → KYB form + uploads → submitted → compliance approves → digital ID created + registered on-chain → add Sheba → verified → see deposit ID.

F2 Fund & subscribe: Bank transfer with deposit ID → statement matched → available credited → browse offering → choose units → accept terms, risk disclosure and issuer-visibility consent → preparer submits → approver OTP → reserved.

F3 Issuer application: Org KYB approved → request issuer status → approved → new application (draft) → submit → screening (maybe returned with tasks) → credit assessment (grade) → DD (expert tasks) → committee vote → decision → terms negotiation + guarantees lodged → issuer signs terms (OTP) → fund manager approves terms → tokenisation review → deploy → open.

F4 Close & issue: Close → apply rule → issue (mint) or cancel (release) → disburse to issuer net of fees.

F5 Maturity: Notices → issuer pays → matched → payout run → holders credited → burn → closed. Or: partial/no payment → grace period → default → guarantees called → distributions.

F6 Withdraw: Request → approve (OTP) → finance → (fund manager above threshold) → bank transfer → completed.

---

## 7. State Machines

### 7.1 Application

draft → submitted → screening ─┬→ returned → resubmitted → screening

```
                               └→ credit_assessment → due_diligence → committee
```

committee → approved | approved_with_conditions | rejected

approved* → terms_negotiation → terms_signed → handed_to_tokenisation

```
any(pre-committee) → withdrawn | expired
```

### 7.2 Series

draft → terms_signed → tokenisation_review → deployed → subscription_open

subscription_open → subscription_closed → issued | cancelled

issued → active → matured → paid_out → redeemed → closed

matured → defaulted → (distributions…) → redeemed → closed

### 7.3 Subscription

draft → pending_approval → reserved → allocated | released | cancelled

### 7.4 KYB

not_started → submitted → in_review → approved | rejected | info_requested

info_requested → submitted ; approved → expired → submitted

### 7.5 Deposit line

imported → matched → credited

imported → suspense → (manually_matched → credited) | returned

### 7.6 Withdrawal

requested → org_approved → finance_queued → [internal_approved] → sent → completed | failed

Every transition is logged in the audit log with the actor and reason.

---

## 8. Business Rules

### 8.1 Money

- All amounts are in integer rials. Display in rial or toman, with Persian digits and thousands separators.
- Ledger invariant: for each series, Σ invested (all orgs) == raised until payout; Σ units on-chain == Σ allocated units.

### 8.2 Eligibility to subscribe

KYB approved and not expired · org not frozen · digital ID registered and verified · available ≥ amount · within per-org min/max · series subscription_open · consents accepted.

### 8.3 Return engine (simple, Jalali)

- days_in_jalali_year(y) = 366 if Jalali year y is a leap year, else 365. Use the standard Jalali leap algorithm (a well-tested library, e.g. jalaali-js).
- Return accrues for each day d in [issue_date, maturity_date) with weight 1 / days_in_jalali_year(year_of(d)). So year_fraction = Σ 1/days_in_jalali_year(year_of(d)).
- return_per_unit = face_value × annual_rate × year_fraction, computed in high-precision decimal and rounded down to the nearest rial per unit.
- payout_per_unit = face_value + return_per_unit (bullet, paid at maturity).
- Holder payout = payout_per_unit × units, so there are no fractional rials.
- Assumptions to confirm: the day-weighting method; the issue date counts and the maturity date doesn't; rounding down per unit.
- The schedule is persisted as rows: (series_id, due_date, principal_per_unit, return_per_unit, total_per_unit). This allows periodic payouts later.

### 8.4 Under-subscription

See FR-CLS-2.

### 8.5 Maker–checker thresholds (configurable defaults)

- Withdrawal > X IRR → fund manager approval as well as finance.
- Disbursement and payout runs → always fund manager.
- Series listing → fund manager + tokenisation officer + a second platform approver.

### 8.6 Issuer visibility (D16)

Issuers see: org legal name, شناسه ملی, units and amount, subscription date. Not visible: members, bank accounts or other holdings.

---

## 9. Permissions Matrix (summary)

| Action | Investor org | Issuer org | Analyst | Expert | Committee | Fund mgr | Compliance | Finance | Tokenisation | Super admin | Auditor |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Submit KYB | admin | admin |  |  |  |  |  |  |  |  | R |
| Approve KYB |  |  |  |  |  |  | ✅ |  |  |  | R |
| Verify bank exception |  |  |  |  |  |  | ✅ |  |  |  | R |
| Subscribe | prep/appr |  |  |  |  |  |  |  |  |  | R |
| Submit application |  | prep/appr |  |  |  |  |  |  |  |  | R |
| Screening / credit / DD |  |  | ✅ | assigned |  |  |  |  |  |  | R |
| Vote |  |  |  |  | ✅ | ✅ |  |  |  |  | R |
| Sign terms |  | appr |  |  |  | ✅ |  |  |  |  | R |
| Deploy / mint / burn |  |  |  |  |  |  |  |  | ✅ (+2nd) |  | R |
| Approve listing |  |  |  |  |  | ✅ |  |  | ✅ |  | R |
| Reconcile deposits |  |  |  |  |  |  |  | ✅ |  |  | R |
| Withdrawal / disbursement / payout | prep/appr (own) |  |  |  |  | ✅ approve |  | ✅ prepare |  |  | R |
| Declare default |  |  |  |  |  | ✅ |  |  |  |  | R |
| Freeze org / address |  |  |  |  |  |  | ✅ |  | ✅ execute | ✅ | R |
| Config & policy |  |  |  |  |  | ✅ policy |  |  |  | ✅ system | R |

(R = read-only. "assigned" = only through an assigned task. Full matrix to be maintained in a separate doc.)

---

## 10. Smart Contracts (Polygon PoS)

### 10.1 Contracts

- IdentityRegistry
  - register(address wallet, bytes32 orgIdHash, uint8 flags, bytes32 kybHash, uint64 expiry), update(...), revoke(address), isVerified(address) → bool.
  - Roles: DEFAULT_ADMIN_ROLE (Safe multisig), REGISTRAR_ROLE (operator key).
- SeriesFactory
  - createSeries(string name, string symbol, bytes32 termsHash, uint64 maturity, uint256 maxSupply) → address. Emits SeriesCreated.
  - Roles: admin (multisig), DEPLOYER_ROLE (operator).
- SeriesToken (one per series)
  - ERC-20, decimals() = 0, termsHash (immutable), maturity, maxSupply, link to the registry.
  - mint(to, amount) and burn(from, amount) (operator only); mint requires registry.isVerified(to).
  - Holder-to-holder transfer/transferFrom revert while transfersEnabled = false (Phase 3 switch, admin only).
  - forcedTransfer(from, to, amount, reasonHash) for legal corrections (admin multisig only).
  - freeze(address) / unfreeze; pause() / unpause() (Pausable).
  - Events for everything; reasonHash points to an off-chain document.

### 10.2 Keys

- operator (hot key, in Web3Signer/OpenBao): pays gas; holds the REGISTRAR, DEPLOYER and MINTER/BURNER roles.
- admin = Safe 2-of-3 multisig (keys held by platform officers, on hardware wallets): role grants, pause, forcedTransfer, enabling transfers.
- Org custodial addresses: hold tokens only; they never need to sign in v1.

### 10.3 Testing & release

- Hardhat or Foundry, OpenZeppelin v5, ≥ 95% line coverage, invariant tests (supply ≤ maxSupply; no transfers while locked).
- Deploy to Amoy → pilot dry run → mainnet. An external audit is recommended before mainnet with real money (P1, at least a peer review).
- Contracts are verified on Polygonscan.

---

## 11. Integrations

| Integration | Purpose | v1 approach |
|---|---|---|
| SMS gateway | OTP, notifications | Iranian SMS provider API (vendor TBD) |
| Email | OTP, notifications | SMTP / transactional email |
| Shahkar | mobile ↔ national code | Through a licensed inquiry provider |
| Company registry / KYB | Entity existence & status | KYB provider API (TBD) + manual review |
| Sheba ownership inquiry | Bank account ↔ شناسه ملی | Inquiry provider API (TBD) |
| Collection bank | Statements, transfers | Bank API if available; otherwise statement file import + manual transfer with reference entry |
| IPG (optional) | Small top-ups | Shaparak PSP, behind a feature flag |
| Polygon PoS | Registry, tokens | Own node (JSON-RPC), ethers.js, Web3Signer |
| Polygonscan | Public verification | Links only |

All integrations sit behind adapter interfaces with sandbox/mock implementations, for development and tests.

---

## 12. Non-Functional Requirements

### 12.1 Localisation & UX

- Farsi UI, full RTL, Vazirmatn (or a similar) font, Persian digits in UI and plain digits in exports.
- Jalali calendar everywhere in the UI (date pickers, schedules, reports). Store UTC timestamps and Gregorian dates in the DB; convert at the edge.
- Mobile-first PWA (installable, works on 360px screens); desktop layouts for the service app.
- Accessibility: WCAG 2.1 AA contrast and focus states.

### 12.2 Security

- OWASP ASVS L2 as the baseline. TLS everywhere. Encryption at rest for the DB and object storage. Field-level encryption for national codes and Sheba numbers.
- Keys only in OpenBao/Web3Signer. Secrets never in code or env files in the repo.
- RBAC enforced on the server per request. Org scoping on every query (multi-org isolation tests).
- Step-up OTP for sensitive actions; device binding; rate limiting; WAF if available.
- Penetration test before pilot launch (P1).

### 12.3 Maker–checker

- The DB stores prepared_by and approved_by. The server rejects approved_by == prepared_by, except in single-user orgs (step-up OTP instead) and except for staff actions, which never allow the same person.

### 12.4 Reliability & Data

- Target availability 99.5% for the pilot. RPO ≤ 15 min, RTO ≤ 4 h.
- Daily encrypted backups + point-in-time recovery for PostgreSQL. Backups of the OpenBao key material in two offline locations.
- Idempotency keys on all money and chain operations. The response to an idempotent request is recorded in the same database transaction as the action, so a crash can neither repeat an action nor leave its key blocked. Outbox pattern for chain writes, notifications and invitation codes.

### 12.5 Performance (pilot scale)

- ≤ 1,000 orgs, ≤ 50 concurrent series, ≤ 10k subscriptions. API p95 < 300 ms for reads.
- Mint batches of up to 200 holders per run with retry.

### 12.6 Observability

- Structured logs, metrics, tracing. Alerts: reconciliation mismatch, gas low, chain tx stuck > 10 min, failed bank imports, overdue P0 tasks.

### 12.7 Privacy

- No personal data on-chain (only hashes and opaque IDs).
- Data minimisation; retention policy (to be defined with legal); a consent log for D16 sharing.

---

## 13. Technical Architecture (summary)

- Backend: modular monolith (suggested: TypeScript/NestJS, or another stack the team prefers), with modules matching §4.
- DB: PostgreSQL 16. Cache/queue: Redis + a job queue (e.g. BullMQ). Files: MinIO.
- Chain: ethers.js v6, Web3Signer, OpenBao, own Polygon node; an indexer worker for events.
- Frontend: one codebase (suggested: Next.js/React) with two surfaces: public site + investor/issuer app (PWA), and the service app (staff). A shared Farsi RTL design system.
- Infra: Docker; staging + production; CI/CD with tests (unit, integration, contract, end-to-end for the key flows F1–F6).

---

## 14. Data Model (core entities)

users, user_devices, otp_challenges, orgs, org_members, org_roles, kyb_cases, kyb_persons, documents, bank_accounts, deposit_ids, bank_statement_lines, ledger_accounts, journal_entries, journal_lines, withdrawals, issuer_profiles, initiatives, applications, screening_results, credit_assessments, credit_scorecard_versions, dd_sections, dd_reports, committee_sessions, committee_votes, guarantee_types, guarantee_policy_versions, guarantee_policy_rules, guarantees, series, series_terms_versions, payout_schedule_rows, subscriptions, consents, allocations, disbursements, payout_runs, payout_lines, distributions, monitoring_reports, material_events, fees, fee_splits, wallets, chain_txs (outbox), chain_events, reconciliation_runs, tasks, task_comments, notifications, audit_log, config_*.

(The detailed ERD and API spec are the next deliverable.)

---

## 15. Milestones (Phase 1, about 14–18 weeks after Phase 0)

| # | Milestone | Content |
|---|---|---|
| M-A | Core foundations (wk 1–3) | Auth, orgs/members/roles, tasks, audit log, documents, design system, CI/CD |
| M-B | Compliance & money in (wk 3–7) | KYB, bank accounts, ledger, deposits + reconciliation, withdrawals |
| M-C | Chain (wk 4–8, in parallel) | Contracts + tests on Amoy, signing service, outbox, indexer, reconciliation |
| M-D | Issuer pipeline (wk 6–11) | Issuer onboarding, applications, screening, credit, DD, committee, guarantees, terms + return engine |
| M-E | Offering & lifecycle (wk 10–14) | Public site, offerings, subscription, close/issue/mint, disbursement, maturity/payout/burn, default |
| M-F | Hardening & pilot (wk 14–18) | Reports, monitoring, notifications polish, security review, Amoy dry run of a full series, mainnet deploy, pilot with the fund's series |

## 16. Open Questions & Assumptions

| # | Item | Current assumption |
|---|---|---|
| Q1 | Jalali day-count & rounding | §8.3: daily weighting by Jalali year length; issue date included, maturity excluded; round down per unit |
| Q2 | Vendors: KYB, Shahkar, Sheba inquiry, SMS, collection bank | TBD in Phase 0; adapters + mocks meanwhile |
| Q3 | Global min/max subscription per org | Configurable per series; no global cap by default |
| Q4 | Tax withholding on returns | None in v1; field reserved |
| Q5 | Hosting (app + node) | TBD; node possibly outside Iran |
| Q6 | Committee makeup, quorum, majority | Configurable; default 3 members, quorum 3, simple majority |
| Q7 | Credit scorecard & grade bands; guarantee matrix values | Built with the fund in Phase 0; system makes them configurable |
| Q8 | Fee levels & fund/platform split | Configurable per series |
| Q9 | Return on idle balances | None |
| Q10 | Investor cancel during offer | Allowed by default (per-series flag) |
| Q11 | Over-subscription allocation | First come, first served |
