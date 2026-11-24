# apps/api — NestJS modular monolith

Modules mirror PRD M1–M19. **Done:** M-A (auth, orgs/members/roles, tasks, audit log, documents),
M-B (KYB, bank accounts, custodial wallet + on-chain digital ID, double-entry ledger, Cobank deposits) and
M-C (initiatives + funding applications through screening, notifications, KYB expiry, withdrawals) and
M-D parts 1–5 (the credit case, scoring, credit limit and limit check; see `docs/plan/01-master-plan.md` §6 items 15–19).
The M-C applicant onboarding below was replaced by the credit case in M-D part 4: an approved credit limit now makes an org an applicant.
**D14:** the fund is the only issuer; companies are *applicants* that request financing.
Next: series terms with both rates, the pre-assessed import path (D23), and the steps after the limit check (D-C22). Shared logic comes from `@tp/domain`
(state machines, Jalali dates), built automatically before tests and builds.

## Run

```bash
cp .env.example .env              # dev defaults work as-is with infra/docker-compose
npm run infra:up                  # from the repo root: Postgres, MinIO, …
npm run migrate -w @tp/api        # applies src/db/migrations/*.sql
npm run dev -w @tp/api            # http://localhost:3000/api/v1
npm run seed:staff -w @tp/api -- 09121234567 super_admin   # make a staff user (after they log in once)
npm run worker -w @tp/api         # background jobs: chain outbox (10 s), Cobank deposit poll (2 min)
npm run seed:fund -w @tp/api -- <شناسه ملی> "<name>" <admin mobile>   # mark the fund org: the single issuer (D14)
npm test -w @tp/api               # 92 e2e tests on in-memory Postgres (PGlite) — no Docker needed
npm run test:chain -w @tp/api     # + the chain worker against a local node with the real IdentityRegistry
```

In dev the SMS provider is `mock`: OTP codes are printed to the console. Set `SMS_PROVIDER=jibit` and the
`JIBIT_*` keys to send real SMS; `IDENTITY_PROVIDER=jibit` for real Shahkar checks.

## Design

| Concern | How |
|---|---|
| Data access | Raw SQL through `Db`/`Queryable` (node-postgres in prod, PGlite in tests). Hand-written migrations. |
| Errors | `{ error: { code, message, message_fa, details, request_id } }` — `message_fa` is shown in the app. |
| Login | OTP by SMS/email: 6 digits, stored as HMAC, 120 s TTL, 5 attempts, resend cooldown + hourly cap, same answer whether or not the account exists. |
| Sessions | 15-min JWT access token + 30-day refresh token that rotates; reusing an old refresh token revokes the session. Bound to a device; devices can be listed and revoked. |
| Step-up | `POST /auth/step-up {method,path,body}` → OTP → single-use token valid only for that exact request (sent as `X-Step-Up-Token`). Used for member/role changes, invitations, org settings; money actions next. |
| Org scoping | Org routes take `X-Org-Id`; the guard checks active membership and role. Non-members get **404**, not 403. |
| Idempotency | Creates require `Idempotency-Key`. A replay returns the stored response with `Idempotent-Replay: true`; the same key with a different body → 422. The response is stored **inside the handler's transaction** (`Db.tx` writes it before COMMIT), so a crash can't leave a committed action without a response; a key with no response older than `IDEMPOTENCY_STALE_SEC` (default 300) died before committing and is taken over. Handlers must do all writes in one `db.tx` and return its result. |
| Audit | Append-only `audit_log`; each row hashes the previous one (SHA-256). DB triggers block UPDATE/DELETE/TRUNCATE. `GET /admin/audit/verify` re-checks the chain. |
| Personal data | National code stored AES-256-GCM encrypted plus an HMAC for lookups. Mobiles masked in member lists. |
| Documents | Presigned S3/MinIO upload → `complete` checks the object exists and the size matches. PDF/JPEG/PNG ≤ 20 MB. Downloads are logged. |
| Single-user orgs (D17) | New orgs start in single-user mode; it switches off automatically when a second member joins and cannot be turned back on while there are two. |

## M-B: how money and identity work

| Step | What happens |
|---|---|
| KYB | `POST /kyb/registry` pulls the company's official record from Jibit (name, state, CEO, board, signature rules; billed, so reused for a day). `POST /kyb/submit` (org_admin, step-up): if the submitter's verified national code is the CEO or a board member, authority comes from the registry; otherwise an introduction letter is required. Risk flags (inactive, bankrupt, suspended, name or postal code differs, bounced cheques) go to the reviewer; nothing is auto-rejected. |
| Review | A compliance officer who is not a member of the org approves, rejects (ends any running approval) or asks for more information (org resubmits as a new version). |
| Wallet + digital ID | Approval creates the org's custodial address, derived from an extended **public** key (`CUSTODY_XPUB`): the API holds no private keys for org wallets. A `chain_txs` row is written in the same transaction; the worker registers the wallet in `IdentityRegistry` through several RPC endpoints with failover. Retries back off; a wallet already on-chain is never sent twice. |
| Bank accounts | IBAN checksum → Jibit IBAN must be ACTIVE → Jibit IBAN ↔ شناسه ملی match → verified (withdrawals allowed after 24 h). No match → compliance review. An IBAN can be live in one org only. |
| Deposits | Each approved org gets a Cobank payment ID. The poll job reads Jibit's "waiting for verify" list. **Accept** only if the payment ID is known, KYB is valid, the source IBAN is one of the org's verified accounts and Jibit's KYT matches the payer; **hold** (suspense + compliance task) if anything else fails; **refund** unknown payment IDs. The decision is stored before Jibit is called, so an outage only delays it; posting is idempotent per Jibit reference. |
| Ledger | Double entry in rials (bigint). Postgres enforces: every entry sums to zero, no account goes below zero on its normal side, history cannot be edited or deleted. `GET /admin/ledger/trial-balance` re-checks everything. |

## M-C: applicants, applications, notifications, withdrawals

| Step | What happens |
|---|---|
| The fund (D14) | One org is the fund: `org_kind = 'fund'`, the only `is_issuer` org (enforced by the database). Set with `seed:fund`. It passes KYB like anyone; its digital ID carries the investor + issuer + fund flags. |
| Applicant request | A KYB-approved company (org_admin, step-up) sends tax ID, sector, activity, management, existing debts and financial statements. An **analyst** records a recommendation, then a **compliance officer** decides — never the same person, never a member of the org. Approval sets `is_applicant`; nothing changes on-chain. |
| Initiative | What is being funded: description, sector, location, start date, progress and evidence documents. Locked while an application for it is with the fund. |
| Application | Draft → a **preparer** sends it for approval → an **approver** submits (step-up). The same person can do both only in single-user mode. Checks at both steps: KYB valid, approved applicant, initiative already started (D10), evidence attached. Every status change goes through the `@tp/domain` state machine and is logged in `application_events`. |
| Screening | An analyst (not a member of the applicant) starts screening, fills a checklist, and passes (→ credit assessment), returns (each item becomes a task in the applicant's inbox; resubmission waits until all are done) or rejects (reason required). The applicant sees the outcome and items to fix, not the fund's internal checklist. |
| Expiry | Drafts and returned applications with no activity for 60 days expire. |
| Notifications | Written in the same transaction as the event. In-app for all recipients; important events also queue an SMS, sent by the worker. |
| Withdrawals | Org preparer requests (the amount moves to a hold, so it can't be spent twice) → approver confirms with step-up (same person only in single-user mode) → finance officer queues (or rejects) → **fund manager** also approves at or above `WITHDRAWAL_FUND_APPROVAL_THRESHOLD` (never the same person as finance) → finance sends to Jibit with step-up, after checking the collection account's daily/monthly transfer limit. The worker tracks Jibit: TRANSFERRED → completed (hold leaves the books), FAILED → money back to available, WAITING_FOR_FEE/BALANCE → task for finance, TRANSFERRED_REVERTED → money back + compliance task. The withdrawal id is Jibit's track id: a lost response is resolved by asking Jibit, never by sending twice. Destination: only the org's verified accounts, after their 24 h cooling-off. **Off in production** (`WITHDRAWALS_ENABLED`) until tested in Jibit's sandbox. |
| KYB expiry | Hourly job: reminders 30 and 7 days before (once each), then KYB → expired, deposits held, digital ID **revoked on-chain**. Re-approval **reinstates** it and **updates** expiry, KYB hash and flags. Tested against the real contract. |

## Endpoints (M-A)

```
POST   /auth/otp/request | /auth/otp/verify | /auth/refresh | /auth/logout
POST   /auth/step-up | /auth/step-up/verify
GET    /me    PATCH /me    POST /me/national-code    GET /me/devices    DELETE /me/devices/:id
POST   /orgs                          GET|PATCH /orgs/current
GET    /orgs/current/members          PATCH /orgs/current/members/:id
GET|POST /orgs/current/invitations    DELETE /orgs/current/invitations/:id    POST /invitations/accept
GET|POST /tasks   GET|PATCH /tasks/:id   GET|POST /tasks/:id/comments
GET    /documents   POST /documents/upload-url   POST /documents/:id/complete   GET /documents/:id[/download]
GET    /admin/audit   GET /admin/audit/verify     GET /health
```

## Endpoints (M-B)

```
GET  /kyb      POST /kyb/registry      POST /kyb/submit [org_admin, step-up]
GET  /admin/kyb?status=   GET /admin/kyb/:id   POST /admin/kyb/:id/decision [compliance_officer]
GET  /bank-accounts   POST /bank-accounts [org_admin, step-up]   DELETE /bank-accounts/:id [step-up]   PATCH /bank-accounts/:id {is_default}
GET  /admin/bank-accounts/pending   POST /admin/bank-accounts/:id/review [compliance_officer]
GET  /wallet   GET /balances   GET /ledger/statement   GET /deposit-instructions   GET /deposits
POST /admin/deposits/poll [finance]   GET /admin/deposits/lines?status=   POST /admin/deposits/lines/:id/resolve [compliance]
GET  /admin/ledger/trial-balance   POST /admin/chain/process   GET /admin/chain/txs   POST /admin/chain/txs/:id/retry
GET  /admin/tasks        (staff work queue: KYB reviews, held deposits, IBAN reviews, failed chain txs)
```

## Endpoints (M-C)

```
GET  /applicant-profile   POST /applicant-profile [org_admin, step-up]
GET  /admin/applicant-profiles?status=   GET /admin/applicant-profiles/:org_id
POST /admin/applicant-profiles/:org_id/analyst-review [analyst]   POST /admin/applicant-profiles/:org_id/decision [compliance]
GET|POST /initiatives   PATCH /initiatives/:id
GET|POST /applications  GET|PATCH /applications/:id
POST /applications/:id/request-approval [preparer]   POST /applications/:id/submit [approver, step-up]   POST /applications/:id/withdraw
GET  /admin/applications?status=   GET /admin/applications/:id
POST /admin/applications/:id/start-screening [analyst]   POST /admin/applications/:id/screening [analyst]
GET  /notifications?unread=   POST /notifications/:id/read   POST /notifications/read-all
POST /admin/jobs/{kyb-expiry|application-expiry|sms}/run [super_admin]
GET  /withdrawals   GET /withdrawals/:id   POST /withdrawals [preparer]   POST /withdrawals/:id/approve [approver, step-up]
POST /withdrawals/:id/cancel
GET  /admin/withdrawals?status=   POST /admin/withdrawals/:id/queue [finance]   POST /admin/withdrawals/:id/reject [finance|compliance]
POST /admin/withdrawals/:id/fund-approve [fund_manager, step-up]   POST /admin/withdrawals/:id/send [finance, step-up]
POST /admin/withdrawals/poll
```

## Known limits / to check

- **Jibit assumptions to confirm** (built from their OpenAPI spec, not yet run against their sandbox): Cobank amounts
  are rials; `verify` / `to-be-decided` / `full-refund` can be repeated safely; the legal-identity `members` + `ceo`
  lists are current (used for the automatic authority check).
- **SMS templates:** production needs one pre-approved Jibit pattern per notification event; until then SMS go through
  a generic pattern (`generic_notice`). Email delivery is not built yet.
- **Application fee** (FR-APP-3, P1) is not charged yet (configurable fee, default 0).
- **Withdrawal settings to confirm with Jibit/bank:** the Satna threshold (`SATNA_THRESHOLD`, default 1.5 billion rials), the
  transfer reason code (`WITHDRAWAL_TRANSFER_REASON`, default `MODIRIAT_NAGHDINEGI`), and that amounts are rials.
- **Suspense credit to another org** is a single compliance decision (audited). Consider a second approver.
- Notifications to the org (deposit credited, KYB decided) are logged but not yet sent (notification module, M-C).

- **Step-up + idempotency:** the step-up guard runs before the idempotency check, so a client retrying a
  step-up-protected create (e.g. an invitation) needs a fresh step-up token. Acceptable for now.
- **Legal national ID checksum** (`isValidLegalNationalId`) follows the published algorithm but must be checked
  against real شناسه ملی values before production; `VALIDATE_LEGAL_ID_CHECKSUM=false` turns it off.
- Rate limiting by IP (in front of OTP) belongs in the gateway/nginx; the app limits per destination.
- **Chain outbox, stuck transactions:** a sent tx with no confirmed receipt after `CHAIN_TX_STALE_SEC` (default 30 min)
  is re-queued; the pre-send check confirms it if it landed. A tx stuck in the mempool for low gas still blocks later
  nonces; replacing it with a higher fee is not automated yet.
