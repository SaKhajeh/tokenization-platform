# PRD v1 — Tokenization Platform (Phase 1 Pilot)

_Version 1.1 · 2026-11-24 (v1.0 draft 2026-11-04) · Owner: Salman Khajeh · Language: English spec, Farsi product UI · Source of decisions: 01-master-plan.md (D1–D27) and 07-case-file-and-credit-scoring.md (D-C1–D-C22)_

_Changes in v1.1 (2026-11-24): aligned with the decisions made since v1.0. **D14** — the fund is the only issuer; companies are **applicants** (project companies) that request financing. **Doc 07** — the credit case and the fund's credit-limit method replace issuer onboarding, the A–D credit grade and the grade-based guarantee matrix; an application's credit step is the **limit check**. **D25–D27, D-C13, D-C21** — fees come from a versioned tariff (assessment fee at case submission, application fee after screening); two rates per series and the fund's spread; repayment waterfall; no arrangement fee. **D16** — project companies see only the amount raised. **D20, D6** — Jibit and RPC providers. **D23** — pre-assessed projects. Also FR-ORG-3 (invitation codes through an outbox) and §12.4 (idempotency recorded with the action). Requirements marked **(built)** exist in the code; see 01 §6 for the log. What follows the limit check (due diligence, committee, contracts) is not decided yet (D-C22) and is kept here as the v1.0 draft, marked as such._

---

## 1. Overview

### 1.1 Product

A Farsi, mobile-first (responsive web/PWA) platform where:

- **Applicants** (project companies; legal entities in v1) request financing for initiatives that have already started and have a guaranteed return (D10). Each applicant first gets a **credit limit** from the fund through its credit case (doc 07).
- The fund assesses each financing request (screening, limit check against the credit limit, and the later steps still to be specified — D-C22) and approves it.
- **The fund is the only issuer (D14):** it issues a series for each approved project, and the platform tokenises it on Polygon PoS on the fund's instruction (D3). Each token is one unit of a fixed-return note against the fund (D2).
- Projects the fund assessed before the platform existed can be imported at the terms stage (D23).
- Investors (legal entities in v1) complete KYB, fund their balance from their own verified bank account, subscribe, hold tokens in a custodial wallet (their on-chain digital ID), and receive principal + return at maturity.

### 1.2 Goals (Phase 1)

- G1. Run 1–3 series for projects the fund has already assessed (D23 import path) end to end: terms → tokenisation → subscription → issuance → disbursement → repayment → payout → redemption.
- G2. Then take new financing requests from invited companies through the full pipeline: registration → credit case → credit limit → application → limit check → … → series.
- G3. A complete, auditable money trail: every rial is reconciled between bank statement, ledger and chain.
- G4. Investors pay zero fees for blockchain actions; every holding can be verified on Polygonscan.

### 1.3 Non-goals (Phase 1)

- Individual (natural person) investors or applicants.
- Issuers other than the fund (D14).
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
| Organisation (Org) | A legal entity on the platform. Every approved org can invest; an org with an approved credit limit is also an **applicant** (`is_applicant`). Exactly one org is **the fund** (`org_kind = fund`, the only issuer, D14). |
| Member | A user linked to an org, with org roles. |
| Initiative | The real-world project an applicant requests financing for. |
| Applicant / project company | A company that requests financing from the fund for its initiative. It receives the money raised and repays the fund (D9). |
| Issuer | The fund. It issues every series to investors (D14). |
| Application | An applicant's binding financing request for an initiative, made after it has a credit limit (D-C22); goes through the assessment pipeline. |
| Credit case (پرونده اعتباری) | One per organisation: forms, documents, financial figures, site visit, scoring rounds and the decision (doc 07). |
| Credit limit (حد اعتباری) | The case's output: the guarantee ceiling with cheque and promissory note, valid 12 months (D-C2). Financings use it up through the usage ledger (doc 07 §7.5). |
| Series | One tokenised issuance for an initiative, with frozen terms. One initiative may have several series over time. |
| Unit / Token | One unit of a series = one token (0 decimals). Face value is set per series (e.g. 10,000,000 IRR). |
| Balance | An org's rial balance in the platform ledger (held legally in the fund's collection account). |
| Digital ID | The org's custodial Polygon address, registered in IdentityRegistry. |
| Sponsor / Assessor | The fund: assesses and approves initiatives. |
| Tokenisation operator | The platform company: configures, deploys and mints tokens and runs the registry. |
| Applicant rate / investor rate | Each series has two rates: what the applicant pays and what investors earn. The difference (spread) is the fund's income (D26). |
| Pre-assessed project | A project the fund assessed and approved outside the platform within the last 12 months; it enters at the terms stage and is labelled as such (D23). |

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
| analyst | Fund | Credit case review, financial verification, site visit, scoring rounds; screening and limit checks of applications; DD coordination; monitoring. |
| technical_expert | Fund | Site visits and technical review of credit cases; receives internal notes (doc 07 §6b). |
| external_expert | Fund (guest) | Access only to the applications assigned to them by task; submits evaluation reports. |
| committee_member | Fund | Votes on applications. |
| fund_manager | Fund | Approves credit limits (never the analyst who prepared the round); sets the fee tariff, rate policy and scoring method; final approval of terms and listing; approves withdrawals at or above the threshold, disbursements and payout runs; waives fees; calls guarantees. |
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
| M7 Credit case & applications (doc 07 replaces issuer onboarding) | ✅ |
| M8 Assessment (screening, limit check; DD and committee to be specified, D-C22) | ✅ |
| M9 Guarantees and collateral | ✅ |
| M10 Series terms & return engine | ✅ |
| M11 Tokenisation & chain | ✅ |
| M12 Offering & subscription | ✅ |
| M13 Close, issuance, disbursement | ✅ |
| M14 Maturity, payout, redemption, default | ✅ |
| M15 Monitoring & disclosures | ✅ |
| M16 Documents & access control | ✅ |
| M17 Notifications | ✅ |
| M18 Fees, rates and spread (D25–D27) | ✅ |
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
- FR-ORG-2 (P0) At registration the org says what it will do here: invest, get financing, or both (doc 07 §2a); it can add a purpose later. Every KYB-approved org can invest. An approved credit limit makes it an applicant. Only the fund org is the issuer (D14), enforced by the database. (built)
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
- FR-KYB-3 (P0) Automatic checks through Jibit (D20): the company's official record (state, CEO, board, signatories), name and postcode match, bounced cheques. Risk flags go to the reviewer; nothing is auto-rejected. Results are stored with the raw response. (built)
- FR-KYB-4 (P0) Compliance review queue: approve / reject / request more information (this creates a task for the org). The reason is mandatory.
- FR-KYB-5 (P0) KYB states: not_started → submitted → in_review → (approved | rejected | info_requested). approved has an expiry date (default 12 months) and goes to expired when it passes.
- FR-KYB-6 (P0) KYB must be approved before the org can deposit, subscribe or submit its credit case. (built)
- FR-KYB-7 (P1) Re-KYB is triggered by changes to signatories or key fields (including key identity changes made in the credit case), or by expiry. Registration changes flow into case fields the applicant has not edited (doc 07 §2a). (built)
- FR-KYB-8 (P0) Articles of association and the latest official gazette are uploaded once at KYB and carry into the credit case as accepted items (D-C9). (built)

### M4 — Bank Accounts

- FR-BANK-1 (P0) The org adds a Sheba (IR + 24 digits), validated by checksum.
- FR-BANK-2 (P0) Jibit checks that the IBAN is active and that its owner matches the org's شناسه ملی. On a match the account is verified; otherwise it goes to compliance review (never auto-verified). An IBAN can be live in one org only. (built)
- FR-BANK-3 (P0) Multiple verified accounts are allowed. One is the default for withdrawals.
- FR-BANK-4 (P0) Adding or removing an account needs org_admin + step-up OTP. A newly verified account is locked for withdrawals for 24 h (cool-down).
- FR-BANK-5 (P0) Disbursements of raised money go only to a verified account of the project company (D9).

### M5 — Digital ID & Custodial Wallets

- FR-WAL-1 (P0) When KYB is approved, the system derives a custodial address for the org from an extended public key (D5: the API holds no org private keys) and registers it in IdentityRegistry with {flags, kybHash, expiry} through the chain outbox. Flags: every org = investor; the fund = investor + issuer + fund (D14). (built)
- FR-WAL-2 (P0) Org wallet private keys stay with custody (offline / vault) and are not needed in v1 (D5). The operator key that pays gas and signs registry and token calls lives in Web3Signer + OpenBao in production.
- FR-WAL-3 (P0) The org's "Digital ID" screen shows its address, verification status, holdings per series on-chain, and links to Polygonscan.
- FR-WAL-4 (P0) If KYB expires, is rejected or the org is frozen, the registry entry is revoked; re-approval reinstates and updates it. Tokens stay, but the org can't receive new mints. Every expiry / re-approval cycle is applied on-chain, including repeated ones. (built)
- FR-WAL-5 (P1) Option to generate a fresh address per series for privacy. Default: one address per org.

### M6 — Ledger, Deposits, Withdrawals

- FR-LED-1 (P0) Double-entry ledger. All amounts are integer rials (BIGINT); toman is a display option only.
- FR-LED-2 (P0) Accounts per org: available, reserved, withdrawal hold, invested (investor side); applicant payable and collected per series (project-company side). Platform accounts: collection_bank, suspense, fund_revenue_services, platform_revenue_services, vat_payable, fund_revenue_spread (D25–D26). The database enforces balanced entries and no negative balances. (built except the series accounts)
- FR-LED-3 (P0) Every movement is an immutable journal entry with a reference to its source (deposit, subscription, series, payout…). There are no edits; corrections are reversal entries.
- FR-DEP-1 (P0) Each approved org gets a Jibit Cobank payment ID (شناسه پرداخت) shown in the app, with the collection account's IBAN and instructions (D20). (built)
- FR-DEP-2 (P0) Deposits are read from Cobank's "waiting for verify" list. Accept only if the payment ID is known, KYB is valid, the source IBAN is one of the org's verified accounts and Jibit's KYT check matches the payer. (built)
- FR-DEP-3 (P0) Accepted → verify at Jibit, credit available and notify. Known payment ID but a failed check → hold (suspense) with a compliance task. Unknown payment ID → refund. The decision is stored before Jibit is called, and posting is idempotent per Jibit reference. (built)
- FR-DEP-4 (P1) Card payment gateway (IPG) top-up for small amounts, behind a feature flag.
- FR-WDR-1 (P0) Withdrawal request (D24): amount ≤ available, destination = a verified account of the org after its 24 h cooling-off. Flow: preparer → approver (or single-user step-up) → finance queues (or rejects) → fund manager also approves at or above the threshold (default 10 billion rials; never the same person as finance) → finance sends through Jibit Cobank after checking the collection account's daily/monthly limit. The withdrawal ID is Jibit's track ID, so a lost response never causes a second transfer. Off in production until tested in Jibit's sandbox. (built)
- FR-WDR-2 (P0) Withdrawal states: requested → org_approved → finance_queued → (internal_approved) → sent → completed | failed (funds return to available); completed → reverted when the bank returns a transfer. (built)
- FR-WDR-3 (P0) On request, the amount moves from available to a withdrawal_hold, so it can't be double-spent.

### M7 — Credit Case & Applications

- FR-ISS-1 (P0) **Replaced by the credit case (doc 07).** When an org that chose "financing" submits KYB, its credit case opens automatically, pre-filled from registration. The applicant completes the form, the 3-year financial summary, the documents and the request letter, pays the assessment fee and submits; the fund reviews, verifies the figures, visits the site, scores and approves a **credit limit** valid 12 months. Details, states and rules: doc 07. (built)
- FR-ISS-2 (P0) The fund org is the only issuer (D14). It is marked once (`seed:fund`) and the database allows no other issuer. (built)
- FR-ISS-3 (P0) Pre-assessed projects (D23): a fund staff member authorised by the fund manager uploads the earlier assessment (grade or limit, approval date and reference, reviewed documents, guarantees held); the fund manager confirms the import; the project enters at the terms stage. Valid for 12 months from the earlier approval; older ones go through the normal pipeline. Every such series is labelled "assessed by the fund before onboarding" with the date, in the records, the offering page, the series terms and the investor's consent. How it meets the credit limit is still open (01 §6 item 23).
- FR-APP-1 (P0) Application form:
  - Initiative: title, description, sector, location, start date, current progress, evidence that it has started (contracts, invoices, progress reports).
  - Financing: amount requested (binding, D-C12), proposed duration, use of funds. Rates come from the fund's rate policy and are set at the terms stage (D26).
  - Repayment source.
  - Proposed guarantees.
  - Documents.
- FR-APP-2 (P0) Save drafts; submit needs preparer + approver (or a single-user step-up). An application needs a valid credit limit (`CREDIT_LIMIT_REQUIRED`), approved KYB and an initiative that has already started with evidence (D10). (built)
- FR-APP-3 (P0) Application fee from the fee tariff (M18): when screening passes, an invoice is issued and the application waits in awaiting_payment until it is paid from the company's balance or waived by the fund manager with a reason. A zero fee goes straight on. (built)
- FR-APP-4 (P0) The applicant sees the application status, open tasks/questions from the fund, and the history; not the fund's internal checklist. (built)
- FR-APP-5 (P0) Application states: draft → submitted → screening → (returned ↔ resubmitted) → [awaiting_payment] → credit_assessment (the limit check) → due_diligence → committee → (approved | approved_with_conditions | rejected) → terms_negotiation → terms_signed → handed_to_tokenisation. Also withdrawn (by the applicant) and expired (60 days without activity). The code is built up to due_diligence; the steps after it are to be specified (D-C22).

### M8 — Assessment (Fund side)

- FR-ASM-1 (P0) Screening: a completeness checklist and eligibility rules (e.g. initiative started = yes; amount within [min, max]; applicant not blocked; sector allowed). The analyst (never a member of the applicant) marks it pass / return / reject; return creates a task per item for the applicant, and resubmission waits until all are done. (built)
- FR-ASM-2 (P0) **Credit step = limit check (doc 07 §9, D-C6).** The company-level assessment is the credit case (FR-ISS-1), which yields the norm ceiling and the credit limit with the fund's method (doc 07 §7). For each application the analyst sets the project's Ra and Re with a written reason; project ceiling = remaining norm × Ra × Re; the amount must fit. Nothing is held at the check: the amount is deducted from the usage ledger when the financing is approved, so approval checks the limit again; a financing that ends after approval gives its deduction back. The A–D scorecard and grades are removed. (built)
- FR-ASM-3 (P0) _To be specified (D-C22); v1.0 draft kept:_ Due diligence: a DD workspace with sections (financial, legal/contract, technical, guarantee verification). The analyst assigns sections to external_experts through tasks. Experts see only the assigned application and upload their reports and findings. Guarantee verification: record the confirmation from the guarantor (a letter or inquiry reference).
- FR-ASM-4 (P0) _To be specified (D-C22); v1.0 draft kept:_ DD report: a summary, a recommendation (approve / with conditions / reject), recommended terms (amount, rates, duration) and the required guarantees and collateral class (M9).
- FR-ASM-5 (P0) _To be specified (D-C22); v1.0 draft kept:_ Committee: the analyst schedules a committee session with one or more applications. Members see the DD pack and vote approve | approve_with_conditions | reject | abstain, with comments. Quorum and the majority rule are configurable. Minutes are generated automatically (who, when, votes, conditions) and stored as a PDF.
- FR-ASM-6 (P0) The decision is sent to the applicant. If conditions are attached, they become tasks for the applicant.
- FR-ASM-7 (P0) Conflict of interest: staff linked to the applicant org cannot review, score, vote or approve its case or applications (blocked if they are a member of that org; otherwise self-declared). (built for review, scoring and approval)

### M9 — Guarantees and Collateral

- FR-GUA-1 (P0) A configurable list of guarantee types: e.g. bank guarantee (ضمانت‌نامه بانکی), insurance policy, fund guarantee, collateral (property or securities), corporate guarantee, promissory note (سفته) or cheque.
- FR-GUA-2 (P0) **The grade-based policy matrix is removed (doc 07 §9).** The default security is cheque and promissory note (coefficient 0.4); a second- or first-degree mortgage raises the ceiling (0.6 / 1.0). The coefficients are part of the versioned scoring method. Coverage is measured against what the applicant owes: principal + applicant-rate return (D15, D26). Guarantees the company already holds with the fund draw on its norm through the usage ledger. (collateral classes and usage ledger built)
- FR-GUA-3 (P0) Each guarantee record holds: type, guarantor, reference no., amount, issue date, expiry date, document, verification status and verification evidence.
- FR-GUA-4 (P0) Listing is blocked unless the guarantees for the financing's collateral class are lodged and verified and every guarantee expires ≥ N days (configurable, default 30) after maturity. For pre-assessed projects (D23) the imported guarantees are not re-checked.
- FR-GUA-5 (P0) Daily job: alert analyst + fund manager when a guarantee will expire within X days, and when coverage falls below the requirement.

### M10 — Series Terms & Return Engine

- FR-SER-1 (P0) Series terms (frozen at terms_signed): series_code, initiative_id, issuer_org_id (= the fund), applicant_org_id (the project company), financing_contract_doc, investment_type, **credit_limit_ref + collateral_class** (doc 07 §9, instead of a grade), pre_assessed (+ assessment date, D23), face_value_per_unit, target_amount, min_amount (nullable), under_subscription_rule (all_or_nothing | keep_raised), **rate_basis (annual | monthly), applicant_rate, investor_rate** (D11, D26; investor rate ≤ applicant rate − minimum spread), return_model = simple, subscription_open_at, subscription_close_at, issue_date, maturity_date, payout_type = bullet, waterfall order (D27), min_subscription_per_org, max_subscription_per_org, disclosure_docs[], guarantees[]. Defaults come from the fund's versioned rate policy and can be overridden per series.
- FR-SER-2 (P0) target_amount and min_amount must be multiples of face_value_per_unit. Subscriptions are in whole units.
- FR-SER-3 (P0) The return engine computes the per-unit schedule for both rates (§8.3) and the series economics (applicant due, investors due, fund spread) and shows them for review before terms are signed. Signing freezes them. The terms JSON (canonical form, both rates included) + schedule are hashed with SHA-256 → termsHash. (engine and hash built; series terms not yet)
- FR-SER-6 (P0) Two contracts per project, signed digitally through Jibit (D21): the financing contract between the project company and the fund (amount, applicant rate, repayment, guarantees, fees), and the series terms issued by the fund to investors (investor rate). Each side sees only its own rate; the fund sees both (01 Q14d, assumed).
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

- FR-OFF-1 (P0) Public offering page (on the public site): title, the fund as issuer, the project and project company, summary, **investor rate**, duration, face value, target, min, rule, Jalali dates, "credit limit checked by the fund" (instead of a grade, doc 07 §9), collateral summary, the "assessed by the fund before onboarding" label where it applies (D23), public documents, progress bar (raised / target), countdown.
- FR-OFF-2 (P0) Documents tagged verified_investors or higher are visible only to logged-in orgs with approved KYB (M16).
- FR-SUB-1 (P0) Subscribe: choose the number of units; the system checks per-org min/max, remaining capacity, KYB valid, and that available ≥ amount (+ fees if any are charged to investors — default none).
- FR-SUB-2 (P0) Before confirming, the investor must accept: the series terms document, the risk disclosure (including the repayment waterfall, D27, and the pre-assessment label where it applies, D23), and the consent to share the org's identity and subscription amount with the fund (D16). The accepted versions are recorded with a timestamp, user and IP. OTP acceptance by default; a digital signature above a threshold is P1 (D21).
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
- FR-CLS-4 (P0) Disbursement to the project company (D9): the amount raised (no arrangement fee, D-C21) → finance prepares the transfer to the company's verified IBAN → fund manager approves → sent through Cobank → confirmed. On approval of the financing, the amount is deducted from the company's credit limit (FR-ASM-2).
- FR-CLS-5 (P0) Visibility (D16): the fund sees every series' investors (org name, شناسه ملی, units, amount); the project company sees only the amount raised. Export is P1.

### M14 — Maturity, Payout, Redemption, Default

- FR-PAY-1 (P0) Payment notices to the project company at T-30, T-7 and T-1 days before maturity: the amount due = principal + return at the **applicant rate** over all units, plus a payment ID for the repayment (D20). Direct debit is P1.
- FR-PAY-2 (P0) The project company pays into the collection account → matched by payment ID → collected for that series.
- FR-PAY-3 (P0) Payout run (on or after maturity, once collected ≥ due): the collection is split by the waterfall (D27, default fund_first: the fund's spread first, then investors) → finance prepares → fund manager approves → the spread is posted to fund_revenue_spread → each holder is credited principal + return at the **investor rate** × units (rounding §8.3) → burn the tokens → series paid_out → redeemed → closed. The repaid amount is released from the company's credit-limit usage.
- FR-PAY-4 (P0) Partial collection: the payout run is blocked. The fund manager can either (a) wait (grace period, configurable, default 5 business days) or (b) declare default.
- FR-PAY-5 (P0) Default: series defaulted → tasks to call the project company's guarantees → as recoveries are collected, they are split by the waterfall (D27) and the investors' share is distributed pro-rata by units (several runs allowed) → tokens are burned at the final distribution. Every step is notified to holders. Whether the fund, as issuer, covers investors' shortfall from its own resources is a legal-track item (01 §4).
- FR-PAY-6 (P1) Late-payment penalty terms (if the contract has them) are recorded and distributed.

### M15 — Monitoring & Disclosures

- FR-MON-1 (P0) Each series has a reporting schedule (e.g. quarterly). The system creates "Submit progress report" tasks for the project company.
- FR-MON-2 (P0) The project company can file a material event report at any time (delay, change, risk). The analyst reviews it and publishes it to holders (and to the public, if marked so).
- FR-MON-3 (P0) The analyst can update the series' risk status (normal | watch | at_risk); holders are notified on changes.
- FR-MON-4 (P1) Overdue reports escalate to the fund manager.

### M16 — Documents & Access Control

- FR-DOC-1 (P0) Every file carries: owner entity, category, access level, version, uploader, SHA-256 hash and timestamps.
- FR-DOC-2 (P0) Access levels: public, verified_investors (any org with approved KYB), series_holders (orgs holding or subscribed to that series), applicant_and_fund, internal (fund + platform staff), committee, regulator_auditor. Every staff view or download of a credit-case file is logged and listed in the case's access history (doc 07 §6a). (built for owner-org documents and case files)
- FR-DOC-3 (P0) Downloads of non-public documents are logged (who, when). An optional watermark with the org name is P1.
- FR-DOC-4 (P0) Files are stored in MinIO (S3-compatible), encrypted at rest. Signed short-lived URLs. PDF, JPEG, PNG, HEIC/HEIF, DOCX and XLSX up to 20 MB. (built)

### M17 — Notifications

- FR-NOT-1 (P0) Channels: in-app, SMS (Jibit), email. Per-event templates in Farsi. Notifications are written in the same transaction as their event; SMS go out through a queue the worker sends. (built; email delivery not yet)
- FR-NOT-2 (P0) Mandatory events include: OTP, KYB result, bank verified/rejected, deposit credited/suspended, subscription confirmed/released, series issued/cancelled, payout credited, withdrawal status, task assigned or overdue, application status change, material events, default.
- FR-NOT-3 (P1) User preferences for non-mandatory events.
- FR-TKT-1 (P0) Tickets for every org user and every staff member, linked to the org's case, item, application or withdrawal; a one-business-day response target; escalation of overdue tickets to the fund manager. Comment threads with messages to the applicant and staff-only internal notes on every case item, section and figure (doc 07 §6b–c). (built)

### M18 — Fees

- FR-FEE-1 (P0) **Fee tariff** (D25, D-C13): one versioned tariff edited by the fund manager with step-up, with before/after in the audit log: assessment fee (Tehran / outside Tehran, by where the company works), application fee, servicing fee (P1), investor fee (default 0), and the platform's share. The tariff is public (`GET pricing/fees`). There is **no arrangement fee** (D-C21). (built)
- FR-FEE-2 (P0) The assessment fee is invoiced on request and must be paid (from the company's balance) or waived by the fund manager with a reason before the credit case can be submitted; the application fee likewise after screening (FR-APP-3). Each invoice records the tariff version and splits into the fund's share, the platform's share and VAT (default 0%). Fees are not refunded on rejection (01 Q14a, assumed). (built)
- FR-FEE-3 (P0) **Two rates and the spread** (D26): a versioned rate policy (rate basis, default applicant and investor rates, minimum spread) set by the fund manager; each series can override it at the terms stage. The spread is the fund's income, taken at payout by the waterfall (D27). Pilot example: applicant 5.6% a month, investors 4% a month, 12 months → the fund keeps 19.2% of principal. (policy, quote and engine built; posting at payout not yet)
- FR-FEE-4 (P1) Fee invoices (PDF) for applicants.

### M19 — Admin, Config, Audit, Reports

- FR-ADM-1 (P0) Config screens: eligibility rules, the scoring method (β table, matrix and bands, collateral coefficients, year weights — versioned, validated, fund manager only), the fee tariff, the rate policy, guarantee types, approval thresholds, KYB expiry, grace periods, notification templates, feature flags. Each scoring round and invoice stores the version it used. (scoring method, tariff and rate policy built)
- FR-ADM-2 (P0) Staff user management with role assignment (super_admin only), with step-up.
- FR-AUD-1 (P0) An append-only audit log for every state change and sensitive read: actor, org, action, entity, before/after, IP, device, timestamp. A hash chain (each entry includes the hash of the previous one) makes tampering detectable.
- FR-REP-1 (P0) Reports:
  - Daily reconciliation (bank ↔ ledger ↔ chain).
  - Series book (subscriptions, holders, units).
  - Investor statement per org (Jalali period).
  - Project-company obligations calendar.
  - Fee report.
  - KYB/compliance queue metrics.
  - Export to Excel.

#### Public site (the fund website)

- FR-WEB-1 (P0) Home: about the fund, how it works, open/upcoming/completed offerings, stats (total raised, number of series).
- FR-WEB-2 (P0) Offering list and detail (FR-OFF-1), "how to invest", FAQ, contact, legal pages (terms, privacy, risk).
- FR-WEB-3 (P0) "Apply for financing" page for prospective applicants: what the credit case involves, the public fee tariff → sign up → registration with the financing purpose → credit case.
- FR-WEB-4 (P1) Basic CMS for news and pages.

---

## 6. Key User Flows (summary)

F1 Investor onboarding: Sign up (OTP) → Shahkar → create org (شناسه ملی) → KYB form + uploads → submitted → compliance approves → digital ID created + registered on-chain → add Sheba → verified → see deposit ID.

F2 Fund & subscribe: Bank transfer with the payment ID → Cobank deposit verified → available credited → browse offering → choose units → accept terms, risk disclosure and the consent to share with the fund → preparer submits → approver OTP → reserved.

F3 Financing (doc 07, D-C22): Sign up → registration with the financing purpose → KYB (the credit case opens automatically) → KYB approved → complete the case (form, financials, documents, request letter) → pay the assessment fee → submit → document review (maybe returned) → documents complete → figures verified and locked + site visit → scoring round → fund manager approves → **credit limit** → financing application (draft → preparer → approver) → screening → application fee → limit check → [due diligence → committee → contracts: to be specified] → financing contract signed with the fund + series terms issued by the fund → tokenisation review → deploy → open. Pre-assessed projects (D23) start at the terms.

F4 Close & issue: Close → apply rule → issue (mint) or cancel (release) → the amount is deducted from the company's credit limit → disburse the amount raised to the project company.

F5 Maturity: Notices to the project company (applicant rate) → it pays with its payment ID → matched → payout run: waterfall (fund's spread, then investors at the investor rate) → holders credited → burn → closed → credit-limit usage released. Or: partial/no payment → grace period → default → guarantees called → distributions by the waterfall.

F6 Withdraw: Request → approve (OTP) → finance → (fund manager above threshold) → bank transfer → completed.

---

## 7. State Machines

### 7.1 Application

```
draft → submitted → screening ─┬→ returned → resubmitted → screening
                               ├→ awaiting_payment (application fee, D25) → credit_assessment
                               └→ credit_assessment (limit check) → due_diligence → committee        [after due_diligence: D-C22]
committee → approved | approved_with_conditions | rejected
approved* → terms_negotiation → terms_signed → handed_to_tokenisation
draft | submitted | screening | returned | resubmitted | awaiting_payment | credit_assessment | due_diligence | terms_negotiation → withdrawn
draft | returned | awaiting_payment → expired (60 days without activity)
```

As built: `APPLICATION` in `packages/domain/src/stateMachines.ts`.

### 7.1a Credit case and scoring round

See doc 07 §2 (case lifecycle) and `CASE` / `ROUND` / `VISIT` in `packages/domain/src/caseFile.ts`. A round is prepared by an analyst and approved, sent back or declined by the fund manager, never by its preparer.

### 7.2 Series

draft → terms_signed → tokenisation_review → deployed → subscription_open

subscription_open → subscription_closed → issued | cancelled

issued → active → matured → paid_out → redeemed → closed

matured → defaulted → (distributions…) → redeemed → closed

### 7.3 Subscription

draft → pending_approval → reserved → allocated | released | cancelled

### 7.4 KYB

not_started → submitted → in_review → approved | rejected | info_requested

info_requested → submitted ; approved → expired → submitted ; approved → submitted (re-KYB) ; rejected → submitted

### 7.5 Deposit line (Cobank, as built)

received → credited (accept: verify at Jibit) | suspense (hold: to-be-decided at Jibit, compliance task) | refunded (unknown payment ID) | failed

suspense → credited (resolved to the org, or to another org with a reason) | refunded

### 7.6 Withdrawal

requested → org_approved → finance_queued → [internal_approved] → sent → completed | failed ; requested | org_approved → cancelled ; completed → reverted

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
- return_per_unit = face_value × annual_rate × year_fraction, computed exactly (integers and fractions, no floating point) and rounded down to the nearest rial per unit.
- Monthly basis (D11): return_per_unit = face_value × monthly_rate × whole Jalali months, rounded down; the maturity falls on the same Jalali day of the month as the issue date.
- Both rates (D26) use the same engine: the applicant rate gives what the project company owes, the investor rate what holders receive; spread_per_unit = the difference.
- payout_per_unit = face_value + return_per_unit (bullet, paid at maturity).
- Holder payout = payout_per_unit × units, so there are no fractional rials.
- Confirmed (D19): the day-weighting method; the issue date counts and the maturity date doesn't; rounding down per unit. (built in `packages/domain`)
- The schedule is persisted as rows: (series_id, due_date, principal_per_unit, return_per_unit, total_per_unit). This allows periodic payouts later.

### 8.4 Under-subscription

See FR-CLS-2.

### 8.5 Maker–checker thresholds (configurable defaults)

- Withdrawal ≥ 10 billion rials (configurable) → fund manager approval as well as finance, never the same person (D24).
- Credit limit → fund manager, never the analyst who prepared the round.
- Disbursement and payout runs → always fund manager.
- Series listing → fund manager + tokenisation officer + a second platform approver.

### 8.6 Visibility (D16)

The fund sees each series' investors: org legal name, شناسه ملی, units and amount, subscription date. The project company sees only the amount raised for its project. Nobody outside the fund sees an investor's members, bank accounts or other holdings. The applicant sees its credit limit, validity, usage and the fund's note — never the scoring coefficients (doc 07 Q6).

### 8.7 Repayment waterfall (D27)

At maturity the collected repayment is split by the order in the rate policy: fund_first (default: the fund's spread, then investors' principal + return), investors_first, or pro_rata. On a full repayment the order makes no difference; on a shortfall it decides who carries it, which must be disclosed in the series terms and risk statement.

---

## 9. Permissions Matrix (summary)

| Action | Investor org | Applicant org | Analyst | Expert | Committee | Fund mgr | Compliance | Finance | Tokenisation | Super admin | Auditor |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Submit KYB | admin | admin |  |  |  |  |  |  |  |  | R |
| Approve KYB |  |  |  |  |  |  | ✅ |  |  |  | R |
| Verify bank exception |  |  |  |  |  |  | ✅ |  |  |  | R |
| Subscribe | prep/appr |  |  |  |  |  |  |  |  |  | R |
| Submit credit case |  | admin (step-up) |  |  |  |  |  |  |  |  | R |
| Review case, verify figures, score |  |  | ✅ |  |  |  |  |  |  |  | R |
| Approve credit limit |  |  |  |  |  | ✅ |  |  |  |  | R |
| Submit application |  | prep/appr |  |  |  |  |  |  |  |  | R |
| Screening / limit check / DD |  |  | ✅ | assigned |  |  |  |  |  |  | R |
| Vote |  |  |  |  | ✅ | ✅ |  |  |  |  | R |
| Sign financing contract / issue series terms |  | appr (contract) |  |  |  | ✅ |  |  |  |  | R |
| Deploy / mint / burn |  |  |  |  |  |  |  |  | ✅ (+2nd) |  | R |
| Approve listing |  |  |  |  |  | ✅ |  |  | ✅ |  | R |
| Reconcile deposits |  |  |  |  |  |  |  | ✅ |  |  | R |
| Withdrawal / disbursement / payout | prep/appr (own) |  |  |  |  | ✅ approve |  | ✅ prepare |  |  | R |
| Declare default |  |  |  |  |  | ✅ |  |  |  |  | R |
| Freeze org / address |  |  |  |  |  |  | ✅ |  | ✅ execute | ✅ | R |
| Config & policy (tariff, rate policy, scoring method) |  |  |  |  |  | ✅ policy |  |  |  | ✅ system | R |

(R = read-only. "assigned" = only through an assigned task. Full matrix to be maintained in a separate doc.)

---

## 10. Smart Contracts (Polygon PoS)

### 10.1 Contracts

- IdentityRegistry
  - register(address wallet, bytes32 orgIdHash, uint8 flags, bytes32 kybHash, uint64 expiry), update(...), revoke(address), reinstate(address), isVerified(address) → bool. Flags: investor 1, issuer 2, fund 4.
  - Roles: DEFAULT_ADMIN_ROLE (Safe multisig), REGISTRAR_ROLE (operator key).
- SeriesFactory
  - createSeries(string name, string symbol, bytes32 seriesIdHash, bytes32 termsHash, uint64 maturity, uint256 maxSupply) → address; one token per seriesIdHash. Emits SeriesCreated.
  - Roles: admin (multisig), DEPLOYER_ROLE (operator).
- SeriesToken (one per series)
  - ERC-20, decimals() = 0, termsHash (immutable), maturity, maxSupply, link to the registry.
  - mint / mintBatch and burn / burnBatch (operator only, ≤ 200 holders per batch, D22); mint requires registry.isVerified(to) and never exceeds maxSupply.
  - Holder-to-holder transfer/transferFrom revert while transfersEnabled = false (Phase 3 switch, admin only).
  - forcedTransfer(from, to, amount, reasonHash) for legal corrections (admin multisig only).
  - freeze(address) / unfreeze; pause() / unpause() (Pausable).
  - Events for everything; reasonHash points to an off-chain document.

### 10.2 Keys

- operator (hot key, in Web3Signer/OpenBao): pays gas; holds the REGISTRAR, DEPLOYER and MINTER/BURNER roles.
- admin = Safe 2-of-3 multisig (keys held by platform officers, on hardware wallets): role grants, pause, forcedTransfer, enabling transfers.
- Org custodial addresses: hold tokens only; they never need to sign in v1.

### 10.3 Testing & release

- Hardhat, OpenZeppelin 5.6, solc-js 0.8.24; 100% line / 99% branch coverage, randomised invariant tests (supply ≤ maxSupply; no transfers while locked). (built)
- Deployed on Amoy on 2026-11-08 with a full lifecycle dry run (01 §3).
- Deploy to Amoy → pilot dry run → mainnet. An external audit is recommended before mainnet with real money (P1, at least a peer review).
- Contracts are verified on Polygonscan.

---

## 11. Integrations

| Integration | Purpose | v1 approach |
|---|---|---|
| SMS | OTP, notifications | Jibit SMS (D20) |
| Email | OTP, notifications | SMTP / transactional email (not built yet) |
| Shahkar | mobile ↔ national code | Jibit inquiry (D20) |
| Company registry / KYB | Legal identity, signatories, board, CEO, postcode, bounced cheques | Jibit inquiry (D20) + compliance review |
| IBAN ownership | IBAN active, IBAN ↔ شناسه ملی | Jibit inquiry (D20) |
| Collection account | Deposits by payment ID with KYT, verify / hold / refund, statement, balance, transfers | Jibit Cobank on the fund's collection account (D20) |
| Digital contracts | Financing contract, series terms | Jibit digital signature (D21) |
| Direct debit (P1), card gateway (P2) | Repayments, small top-ups | Jibit (D20) |
| Credit bureau / Sana | Inquiries for the company and directors | Uploaded results in v1; adapter planned (doc 07 Q8) |
| Polygon PoS | Registry, tokens | Several RPC providers with failover, no own node for now (D6); ethers.js; Web3Signer |
| Polygonscan | Public verification | Links only |

All integrations sit behind adapter interfaces with mock implementations, for development and tests; tests never call Jibit. Details per flow: doc 04.

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

- Structured logs, metrics, tracing. Alerts: reconciliation mismatch, gas low, chain tx stuck (the outbox re-queues a sent tx with no confirmed receipt after 30 min; failed txs become P0 tasks), failed bank imports, overdue P0 tasks.

### 12.7 Privacy

- No personal data on-chain (only hashes and opaque IDs).
- Data minimisation; retention policy (to be defined with legal); a consent log for D16 sharing.

---

## 13. Technical Architecture (summary)

- Backend: modular monolith (suggested: TypeScript/NestJS, or another stack the team prefers), with modules matching §4.
- DB: PostgreSQL 16, raw SQL with hand-written migrations (tests on in-memory PGlite). Background jobs: a worker process (same codebase) with database leases, so several workers are safe; Redis is not needed yet. Files: MinIO.
- Chain: ethers.js v6, Web3Signer, OpenBao, several RPC providers with failover (D6); an indexer worker for events (not built yet).
- Frontend: one codebase (suggested: Next.js/React) with two surfaces: public site + investor/applicant app (PWA), and the service app (staff). A shared Farsi RTL design system.
- Infra: Docker; staging + production; CI/CD with tests (unit, integration, contract, end-to-end for the key flows F1–F6).

---

## 14. Data Model (core entities)

users, user_devices, otp_challenges, orgs, org_members, org_roles, kyb_cases, kyb_persons, documents, bank_accounts, deposit_ids, bank_statement_lines, ledger_accounts, journal_entries, journal_lines, withdrawals, issuer_profiles, initiatives, applications, screening_results, credit_assessments, credit_scorecard_versions, dd_sections, dd_reports, committee_sessions, committee_votes, guarantee_types, guarantee_policy_versions, guarantee_policy_rules, guarantees, series, series_terms_versions, payout_schedule_rows, subscriptions, consents, allocations, disbursements, payout_runs, payout_lines, distributions, monitoring_reports, material_events, fees, fee_splits, wallets, chain_txs (outbox), chain_events, reconciliation_runs, tasks, task_comments, notifications, audit_log, config_*.

The grade-based tables (credit_assessments, credit_scorecard_versions, guarantee_policy_versions, guarantee_policy_rules) are replaced by the credit-case tables of doc 07 §10 (cases, case items and files, financials, visits, inquiries, scoring_methods, assessment_rounds, credit_limits, limit_usages, application_limit_checks, comments, tickets, fee_tariffs). As built: `apps/api/src/db/migrations`; the detailed model and API: doc 03.

---

## 15. Milestones (Phase 1, about 14–18 weeks after Phase 0)

The code milestones were cut differently from this plan; what is built is logged in 01 §6. Status on 2026-11-24:

| # | Milestone (plan) | Content | Status |
|---|---|---|---|
| M-A | Core foundations (wk 1–3) | Auth, orgs/members/roles, tasks, audit log, documents, design system, CI/CD | Built (no design system / frontend yet) |
| M-B | Compliance & money in (wk 3–7) | KYB, bank accounts, ledger, deposits + reconciliation, withdrawals | Built (Jibit mocks; sandbox pending) |
| M-C | Chain (wk 4–8, in parallel) | Contracts + tests on Amoy, signing service, outbox, indexer, reconciliation | Contracts, Amoy and the identity outbox built; indexer and reconciliation not yet |
| M-D | Applicant pipeline (wk 6–11) | Credit case and credit limit (doc 07), applications, screening, limit check, fees and rates; DD, committee, contracts (D-C22); guarantees, terms + return engine | Credit case to limit check, fees and rate policy, return engine built; the rest open |
| M-E | Offering & lifecycle (wk 10–14) | Public site, offerings, subscription, close/issue/mint, disbursement, maturity/payout (waterfall)/burn, default | Not started |
| M-F | Hardening & pilot (wk 14–18) | Reports, monitoring, notifications polish, security review, Amoy dry run of a full series, mainnet deploy, pilot with the fund's series | Not started |

## 16. Open Questions & Assumptions

| # | Item | Current assumption |
|---|---|---|
| Q1 | Jalali day-count & rounding | §8.3: daily weighting by Jalali year length; issue date included, maturity excluded; round down per unit |
| Q2 | Vendors: KYB, Shahkar, Sheba inquiry, SMS, collection bank | Settled: Jibit (D20). Open: which bank holds the collection account, and Jibit's answers (01 §5 items 1–2) |
| Q3 | Global min/max subscription per org | Configurable per series; no global cap by default |
| Q4 | Tax withholding on returns | None in v1; field reserved |
| Q5 | Hosting (app + chain worker) | Open (doc 07 D-C14, 01 §5 item 3); RPC providers instead of an own node (D6) |
| Q6 | Committee makeup, quorum, majority | Configurable; default 3 members, quorum 3, simple majority |
| Q7 | Credit scorecard & grade bands; guarantee matrix values | Replaced by the fund's credit-limit method (doc 07). Still open there: the Rc/Ra/Re rubric (Q11) and companies with fewer than 3 years (Q4) |
| Q8 | Fee levels & fund/platform split | Fee tariff and rate policy (D25–D27); actual amounts still to come from the fund (01 §5 item 14) |
| Q9 | Return on idle balances | None |
| Q10 | Investor cancel during offer | Allowed by default (per-series flag) |
| Q11 | Over-subscription allocation | First come, first served |
