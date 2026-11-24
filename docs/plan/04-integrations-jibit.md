# Integrations Spec — Jibit (v0.2)

_Date: 2026-11-04 · Source: Jibit OpenAPI 3 spec "مستندات فنی جیبیت" v1.0.0 (146 endpoints, base https://napi.jibit.ir), provided by Salman · Replaces v0.1 (which was based on public listings). This doc overrides PRD §11 and the money-out postings in 03-data-model-and-api.md §1.6._

---

## 1. Jibit products we use

| Jibit product | Base path | Auth | Our use | Priority |
|---|---|---|---|---|
| Inquiry (استعلامی) | /ide/v1, /ide/v2 | POST /ide/v1/tokens/generate (apiKey + secret) → JWT, refresh | Shahkar, legal-entity identity + signatories, IBAN checks, postal, bounced cheques | P0 |
| Cobank (کوبانک — our connected bank accounts) | /cobank/v1, /cobank/v2 | POST /cobank/v1/tokens/generate with scopes (ACCOUNTS, AUG_STATEMENT, AUG_STATEMENT_VARIZ, VARIZ_PID, SETTLEMENT, AUGMENTED_TRANSFER, BALANCE, COLLECT, REPORT) | Identified deposits (payment ID), deposit verify/refund, full statement, balance, outgoing transfers (Paya/Satna/internal) | P0 |
| SMS (پیامک) | /pulse/api/v1 | POST /pulse/api/v1/auth/authenticate | OTP SMS + template (pattern) notifications | P0 |
| Digital contract & signature | /mzahub | POST /mzahub/v1/auth/login | Legally signed contracts (issuer–sponsor contract, series terms) | P1 (pilot: P0 for the issuer contract) |
| Payment gateway (درگاه پرداخت) | /ppg/v3 | POST /ppg/v3/tokens | Optional card top-up | P2 (feature flag) |
| Direct debit (دایرکت دبیت) | /directdebit/api/v1 | POST /directdebit/api/v1/auth | Automatic collection of issuer repayments at maturity | P1 (confirm it works for legal entities) |
| Biometric KYC | /alpha/api | — | Video/photo KYC, national-card OCR | Phase 2 (individuals) |

All products: the server's IP must be registered (allowlisted) with Jibit (e.g. untrusted_client_ip.no_whitelist, ip.not_trusted errors). Each product has its own token; we cache tokens per product in Redis and refresh them before expiry.

---

## 2. Endpoint mapping by platform flow

### 2.1 KYB — legal entity and representatives (FR-KYB-1..3, FR-ORG-6)

| Step | Jibit endpoint | What we do with it |
|---|---|---|
| Legal entity record | GET /ide/v1/services/identity/legal?nationalCode={11-digit} + flags signHolders=true&members=true&ceo=true&news=true | Auto-fill name, registration no., registration/establishment date, last change date, company type, status, address, postal code, signature authority, board members, CEO, gazette news. Check state, bankruptcyState, suspensionState. Each flag is billed separately. v1 default: base + signHolders + members + ceo; news on demand. |
| Representative is a signatory | Compare the representative's national code with members / ceo / sign-holder data | Automatic authority check. If they're not listed → an introduction letter (معرفی‌نامه) / power of attorney is required + compliance review. |
| Representative mobile ↔ national code (Shahkar) | GET /ide/v1/services/matching?nationalCode=&mobileNumber= | Required for every user acting for an org (FR-AUTH-6). |
| Registered company mobile (optional) | GET /ide/v1/services/matching?legalNationalCode=&mobileNumber= | Extra signal for the org contact mobile. |
| Address | GET /ide/v1/services/postal?code= | Validate / pre-fill the KYB address. |
| Bounced cheques (risk signal) | GET /ide/v1/services/cheque/bounced-cheque/count?nationalCode= (10- or 11-digit) | Stored in the KYB record. Also an input to the credit assessment for issuers and their CEO/signatories. |
| Guild / business licence (optional) | GET /ide/v2/services/corporation/identity?code= | Only for issuers that hold guild licences. Not needed for standard KYB. |

### 2.2 Bank account verification (FR-BANK-1..2)

| Step | Endpoint | Rule |
|---|---|---|
| 1. IBAN info | GET /ide/v1/ibans?value={IR…} | status must be ACTIVE. Store bank, deposit number and owners. |
| 2. IBAN ↔ legal entity | GET /ide/v1/services/matching?iban=&legalNationalCode= | matched=true → verified. (Jibit compares the IBAN owner's name with the legal entity's registered name.) |
| 3. Fallback | matched=false | → compliance review task (e.g. a name variant). Never auto-verify. |

Individuals (Phase 2): matching?iban=&nationalCode=.

### 2.3 Deposits with payment ID (شناسه پرداخت) — replaces statement-file import (FR-DEP-1..3)

Setup: the fund's collection account is connected to Jibit Cobank (GET /cobank/v1/accounts/ lists the connected accounts).

Per org: generate a payment ID on the collection IBAN: POST /cobank/v1/accounts/{collectionIban}/pay-id/random → {iban, paymentId} → stored as orgs.deposit_id and shown to the investor ("transfer with this شناسه پرداخت").

Per issuer obligation (repayment): a separate payment ID per series, so repayments are never mixed up with ordinary deposits from the same org (issuer_obligations.pay_id).

Processing loop (job cobank.deposits.poll, every 2 min; there are no webhooks in the spec):

1. GET /cobank/v1/orders/aug-statement/{iban}/variz-pid/waitingForVerify (paged).
2. For each record (AugmentedStatementRecordDTO): look up payId → org or obligation.
3. Accept if all of these hold: the payId is known, and sourceIban ∈ the org's verified bank accounts, and kytStatus = MATCH_IBAN_AND_NATIONAL_ID (Jibit's own check that the source account belongs to the payer's national ID). → GET …/variz-pid/{referenceNumber}/verify → post the journal (collection_bank Dr / org_available Cr, or series_repayment for obligations) → notify.
4. Park for review if the payId is known but the source IBAN isn't verified, or KYT doesn't match: → GET …/variz-pid/{referenceNumber}/to-be-decided → suspense + compliance task (SLA 1 business day).
5. Refund: unknown payId, or compliance rejects: → POST …/variz-pid/{referenceNumber}/full-refund (or partial-refund) → the money goes back to the sender.
6. Deposits without a payment ID come through …/variz/waitingForVerify and follow the same verify / to-be-decided / refund flow (manual matching only).

Jibit's merchantVerificationStatus values (SYSTEM_REVIEW, HOLDING_FOR_SYSTEM_CHECK, TO_BE_DECIDED, VERIFIED, AUTO_VERIFIED, REJECTED, NO_ACTION, SYSTEM_NO_ACTION) are stored on bank_statement_lines. ⚠️ There is a failure reason JIBIT_FAILED_BY_SYSTEM_ON_WAITING_FOR_VERIFY, which suggests a verify deadline. Confirm the timeout with Jibit; the polling interval must be well inside it.

### 2.4 Statement & balance (reconciliation) — FR-REP-1, recon.ledger_bank

- Full statement: GET /cobank/v1/orders/aug-statement/{iban}/list?fromDate&toDate → ingested into bank_statement_lines, credits and debits. This replaces manual file upload; upload stays as a fallback.
- Balance: POST /cobank/v1/orders/balance/{iban}/submit-balance-order, then GET /cobank/v1/orders/balance/{iban}/aug-balance.
- Daily invariant: ledger collection_bank == Jibit balance; each debit line maps to one of our settlements (or is flagged).

### 2.5 Money out: withdrawals, issuer disbursements, refunds (FR-WDR, FR-CLS-4)

Money goes directly from the collection account. There is no intermediary wallet.

1. Pre-check: GET /cobank/v1/orders/augmented-transfer/limitation/{iban} → dailyLimitation/monthlyLimitation.remainingAmount. If an amount exceeds the remaining limit, it is queued for the next day + the treasury is alerted.
2. Create: POST /cobank/v1/orders/settlement

```json
{ "recordTrackId": "<our withdrawal/disbursement id>",   // idempotency
  "transferType": "NORMAL | ACH | RTGS",                  // internal (same bank) | Paya | Satna
  "transferReason": "MODIRIAT_NAGHDINEGI | TADIE_DOYOUN | ...", // per the purpose table below
  "sourceIban": "<collection IBAN>",
  "destinationIban": "<verified org IBAN>",
  "amount": 1250000000,
  "paymentId": "<optional>",
  "requestDescription": "WDR-…" }
```

transferType rule: destination at the same bank → NORMAL; otherwise amount ≥ the Satna threshold (config) → RTGS, else ACH. transferReason (⚠️ confirm with Jibit/bank): withdrawal → MODIRIAT_NAGHDINEGI; issuer disbursement → MOAMELAT_GHEIR_MANGHOUL/KHARID_KHADAMAT, depending on the contract type; returning funds → TADIE_DOYOUN. Configurable mapping. 3. Track: GET /cobank/v1/orders/settlement/{trackId} (or batch-inquiry), job cobank.settlements.poll every 2 min. Record states map as follows:

| Jibit record state | Our payout_transfers.status |
|---|---|
| RECEIVED, SOURCE_PROCESSING, DESTINATION_PROCESSING | in_progress |
| WAITING_FOR_FEE, WAITING_FOR_BALANCE, WAITING_FOR_AUTO_RENEW | blocked (treasury alert) |
| TRANSFERRED | succeeded → post the final journal |
| FAILED, FAILED_WRONG, CANCELLED | failed → reverse the hold, notify |
| TRANSFERRED_REVERTED | reversed → reverse the journal, compliance task |

Store failReason (e.g. JIBIT_DAILY_TRANSFER_LIMIT_EXCEEDED, BANK_DESTINATION_ACCOUNT_DORMANT, JIBIT_INSUFFICIENT_FEE_BALANCE) and estimatedSettleAt. Receipts: GET /cobank/v1/orders/aug-transfer/record/receipt/{receiptToken} → attached to the withdrawal or disbursement. 4. Jibit fees are charged from a separate Jibit fee balance (WAITING_FOR_FEE, JIBIT_INSUFFICIENT_FEE_BALANCE). We monitor it and alert the treasury.

### 2.6 SMS — OTP & notifications (FR-AUTH-1, FR-NOT)

- OTP: our backend generates and verifies the code; Jibit only delivers it: POST /pulse/api/v1/message/sms/otp/send {receptor, sender, template, params:{code}, client_message_id}.
- Notifications: POST /pulse/api/v1/message/sms/pattern/send, with pre-approved Farsi templates (one per notification_templates.event_key).
- Delivery status: GET /pulse/api/v1/message/sms/status/client-message-id/{id}.
- client_message_id = our notifications.id (idempotent and traceable).

### 2.7 Digital contracts & signatures (new: replaces "OTP acceptance" for key contracts)

Flow (mzahub):

1. POST /mzahub/v2/contracts (multipart: PDF files, signers, trackId, expireAt, redirectUrl, sendSmsToSigners) → signing link + receiptCode.
2. The signer submits their identity (/contract-sign/user-identity), records a liveness video with challenge words (/verify-kyc), gets a signing certificate and an OTP (/confirm-sign). The state goes … → SIGNED.
3. GET /mzahub/v1/contracts?trackId= → SIGNED_BY_ALL_SIGNERS. Then GET /mzahub/v1/contracts/download-signed?trackId= → stored in documents (sha256 hashed; the hash goes into the series terms).
4. Header X-REAL-IP = the end user's IP (required).

Use in v1:

| Contract | Signers | Method |
|---|---|---|
| Issuer–sponsor (fund) financing contract | Issuer signatories + fund manager | Jibit digital signature (P0) |
| Series terms sign-off (FR-SER-3, terms_signed) | Issuer approver + fund manager | Jibit digital signature (P0) |
| Investor subscription consent | Investor approver | OTP acceptance (v1 default). Jibit signature above a threshold amount (P1, configurable). |
| Platform terms / privacy | Every user | Click-through + log |

Signed PDFs are evidence for the legal track and for guarantee calls.

### 2.8 Direct debit — issuer repayments (P1)

- At terms signing, the issuer authorises a time-frame mandate: POST /directdebit/api/v1/mandate/time-frame {creditor_mandate_reference=series_code, maximum_amount=issuerDue, start_date=maturity−N, expire_date=maturity+grace, debtor_iban, …} → the user is redirected to the bank to approve.
- At maturity: POST /directdebit/api/v1/transaction/collect {creditor_transaction_no, mandate_reference, amount}. The money lands in the collection account (statement type VARIZ_DIRECT_DEBIT) → series_repayment.
- If collection fails → the normal payment-ID repayment flow, then default (FR-PAY-4).
- ⚠️ The debtor fields are person-based (debtor_national_code, debtor_birthdate). Confirm that legal-entity accounts are supported (GET /directdebit/api/v1/creditor/active-banks lists the banks).

### 2.9 Card gateway (optional top-up, P2)

```
POST /ppg/v3/purchases (amount, clientReferenceNumber, payerNationalCode, payerMobileNumber, checkPayerMobileNumber=true, callbackUrl) → redirect to pspSwitchingUrl → POST /ppg/v3/purchases/{id}/verify within 15 min. Minimum 5,000 IRR; the default maximum is 2,000,000,000 IRR per purchase (raisable per client). The callback domain must be allowlisted. Refunds via POST /ppg/v3/purchases/refund. Settlement arrives in the collection account as VARIZ_SHAPARAK_IPG_SETTLEMENT.
```

### 2.10 Credit assessment and guarantee inputs (M8, M9)

- Bounced cheque count for the issuer + CEO + signatories (§2.1) → a scorecard factor.
- Cheque guarantees: GET /ide/v1/services/cheque/inquiry and POST /ide/v1/services/ocr/cheque (extracts the cheque number from a photo) → verify cheque/Sayad guarantees.
- The legal record's bankruptcyState, suspensionState, lastChangeDate and totalStock → scorecard and screening rules.

### 2.11 Monitoring

- GET /ide/v1/services/availability, GET /ppg/v3/app/health, GET /ide/ready → health dashboard and circuit breakers.
- GET /ide/v1/reports/daily → daily usage and cost report (each inquiry variant is billed separately).

---

## 3. Data model changes (vs 03-data-model-and-api.md)

Remove: platform:jibit_transfer_wallet (from v0.1). Transfers leave the collection account directly.

Add / change:

orgs.deposit_id                 := Jibit paymentId (generated per org on the collection IBAN)

issuer_obligations.pay_id       Jibit paymentId per series repayment

bank_statement_lines            + jibit_reference_number, bank_reference_number, bank_tracking_code,

```
                                  record_type, merchant_verification_status, kyt_status, pay_id,
                                  source_iban, source_name, refund_type, refund_track_id, fee_amount
```

payout_transfers                + jibit_track_id, jibit_reference_number, transfer_type[NORMAL|ACH|RTGS],

```
                                  transfer_reason, jibit_state, fail_reason, estimated_settle_at, receipt_doc_id
```

kyb_checks.check_type           + legal_identity | sign_holders | legal_mobile_match | bounced_cheque

```
legal_identity_snapshots(id, org_id, provider_call_id, data jsonb, fetched_at)   -- members, CEO, sign holders
e_contracts(id, provider['jibit_mzahub'], track_id UNIQUE, purpose[issuer_contract|series_terms|subscription],
            ref_id, status[NOT_SIGNED|SIGNED_BY_ALL_SIGNERS|CANCELLED|EXPIRED|REJECTED|SUSPENDED_WAITING_FOR_BALANCE],
            link, expire_at, signed_doc_id NULL, signed_sha256 NULL)
e_contract_signers(id, e_contract_id, user_id, national_code_hash, receipt_code, state, signed_at)
dd_mandates(id, series_id, issuer_org_id, mandate_reference, creditor_mandate_reference, max_amount,
            start_date, expire_date, status[initiated|active|disabled|revoked|expired])
dd_collections(id, mandate_id, creditor_transaction_no UNIQUE, amount, status, jibit_transaction_no, collected_at)
sms_messages(id, notification_id, client_message_id UNIQUE, jibit_message_id, template, status, segment_count)
```

jibit_tokens (in Redis only, not the DB)

Ledger accounts: add platform:jibit_fee_prepaid (asset) and platform:fees_expense (expense); keep jibit_ipg_settlement (only if the IPG is on).

Posting changes:

| Event | Debit | Credit |
|---|---|---|
| Withdrawal transferred | org_withdrawal_hold | collection_bank |
| Disbursement transferred | series_escrow | collection_bank |
| Suspense refund (Jibit full-refund) | suspense | collection_bank |
| Jibit transfer/inquiry fee | fees_expense | jibit_fee_prepaid |
| Top-up of the Jibit fee balance | jibit_fee_prepaid | collection_bank (or the operator's own account) |
| Direct-debit repayment collected | collection_bank | series_repayment[series] |

## 4. Jobs (additions / replacements)

| Job | Interval | Endpoint(s) |
|---|---|---|
| cobank.deposits.poll | 2 min | variz-pid + variz waitingForVerify → verify / to-be-decided / refund |
| cobank.statement.sync | 15 min + end of day | aug-statement list (all records) |
| cobank.balance.check | hourly + end of day | submit-balance-order → aug-balance |
| cobank.settlements.poll | 2 min | settlement/{trackId}, batch-inquiry |
| cobank.limits.check | before each settlement + daily | augmented-transfer/limitation |
| mzahub.contracts.poll | 5 min | contracts?trackId → download-signed |
| dd.collect | on the maturity date | transaction/collect (P1) |
| jibit.health | 1 min | availability / health endpoints → circuit breaker |
| jibit.usage.report | daily | ide reports/daily → cost dashboard |

## 5. Configuration

```
JIBIT_BASE_URL=https://napi.jibit.ir
JIBIT_IDE_API_KEY / _SECRET          (OpenBao)
JIBIT_COBANK_API_KEY / _SECRET       scopes: ACCOUNTS,AUG_STATEMENT,AUG_STATEMENT_VARIZ,VARIZ_PID,SETTLEMENT,AUGMENTED_TRANSFER,BALANCE,REPORT
JIBIT_PULSE_API_KEY / _SECRET, JIBIT_SMS_SENDER, JIBIT_SMS_OTP_TEMPLATE
JIBIT_MZAHUB_USERNAME / _PASSWORD
JIBIT_PPG_API_KEY / _SECRET          (only if the IPG is on)
JIBIT_DD_*                           (P1)
COLLECTION_IBAN, SATNA_THRESHOLD_IRR, TRANSFER_REASON_MAP, DEPOSIT_SUSPENSE_SLA_HOURS
EGRESS: static Iranian IP, registered with Jibit (staging and production separately)
```

---

## 6. Risks

- Vendor concentration: identity checks, money in, money out, SMS and signatures all depend on one provider. Mitigations: an adapter layer for each capability; manual fallbacks (statement upload, manual bank transfer with a reference entry, compliance manual review); a P1 backup SMS provider.
- No webhooks in the Cobank spec, so we rely on polling. Keep intervals inside any verify deadline.
- Per-call billing (each inquiry variant and each legal-identity flag is billed): cache results (legal identity for 30 days unless re-KYB; IBAN results kept with the account) and use the cost dashboard.
- Treasury limits: daily/monthly transfer limits can delay withdrawals and disbursements; payout days must be planned against remainingAmount.

---

## 7. Remaining questions for Jibit

1. Is a Cobank paymentId permanent and reusable for one payer? Is there a limit on how many per IBAN? Can we set our own payment IDs (not random)?
2. Is there a verify deadline for waitingForVerify records, and what happens on timeout (auto-refund?)?
3. Are webhooks available for Cobank deposits and settlements?
4. Which banks are supported for the collection account? Satna/Paya thresholds and cut-off times? Default daily and monthly limits, and how to raise them?
5. The correct transferReason codes for investor withdrawals and issuer disbursements.
6. Direct debit for legal-entity debtors: supported? Which banks?
7. Does legal identity with signHolders always return the current signatories? How fresh is the data?
8. Fee schedule per product and variant; how the fee balance is topped up.
9. Sandbox or test credentials for each product; separate keys and IPs for staging.
10. Is the mzahub digital signature accepted for legal-entity signatories (signing on behalf of a company)? Can the certificate show the company?
