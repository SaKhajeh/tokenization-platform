# Case File & Credit Limit — Design Spec v1

_Date: 2026-11-15, updated 2026-11-16 · Companion to 02-prd-v1.md (M7, M8, M9), 05-ux-spec.md, 06-figma-status.md · Product language: Farsi (RTL)_

_Updated 2026-11-24: findings W13 (negative sales refused) and W14 (three-decimal coefficients), both built and tested._

_Updated 2026-11-25 (fund feedback, master plan §6 item 25): decisions D-C23–D-C33 below (§13). They supersede the earlier text on three years of figures, the signature certificate (1-6), the checklist guidance and who approves the limit._

#### Sources studied

| File | What it is |
|---|---|
| Scoring workbook (.xlsx, sheets «گزارش ارزیابی», «تحلیل مالی») | The fund's credit-limit method: 3-year financial spreading, ratios, coefficient table, ceilings, guarantee norm ledger, inquiry and report fields |
| مدارک تشکیل پرونده حد اعتباری (.rar) | Folder structure for the case (4 groups, 20 folders), one-page guide, company information form (16 numbered tables), credit-inquiry consent forms (legal + natural person), request-letter template |
| Form_info_v1405.docx | A second information form («فرم دریافت اطلاعات متقاضی») with a partly different field set |

Screens: design canvas, page «پرونده و اعتبارسنجی» → https://claude.ai/artifact/NAjFKCk236oNt6joEokLu7 Clickable simulation of the whole procedure (the most current reference where it differs from the canvas) → https://claude.ai/artifact/GWJ428qL57eNaaEjmcH5h2

---

## 0. Decisions confirmed by the owner (2026-11-15)

| # | Decision |
|---|---|
| D-C1 | The information form in the archive (16 tables) plus the three blocks taken from Form_info_v1405.docx is accepted as the in-app form. |
| D-C2 | The credit limit (حد اعتباری) is the guarantee ceiling with cheque and promissory note (چک و سفته): sales × β × Rc × Cp × Cr × 0.4 × Ra × Re. This is the figure announced to the applicant and the ceiling for a token financing. The mortgage-class and short-term-facility ceilings stay in the fund's report as supporting figures. |
| D-C3 | The applicant enters the financial figures; the analyst verifies each cell against the statements. |
| D-C4 | The fund has written guidance for Rc, Ra and Re; it will be supplied later and built in as a rubric. Until then the analyst sets them with a mandatory reason. |
| D-C5 | The final ceiling (after × Ra × Re) is the main result. In the usage ledger, a commitment uses amount ÷ (Ra × Re) of the norm ceiling (the workbook's ÷ (Ra + Re) in «کسر اعتبار نُرم شده» was a mistake; corrected 2026-11-16). |
| D-C7 | The short-term facility ceilings stay visible (fund report and applicant result screen) for possible later use. |
| D-C8 | Data declared at registration (KYB) is carried into the case, pre-filled and editable (§2a). |
| D-C9 | Articles of association and the latest official gazette are uploaded once, at registration (KYB), each with its own upload button. Jibit's registry data (incl. gazette notices) is used to cross-check, not as a replacement. Both carry into the case as items 2-1 / 2-2, already accepted. |
| D-C10 | The company representative uploads every member's personal documents in v1. Every file has its own upload button: one per person (company, CEO, each board member, each signatory) and one per fiscal year for statements. Individual OTP confirmation of consent forms by each member is a later option. |
| D-C11 | One organisation account per company (unique national ID), with personal user accounts under it (org_admin, preparer, approver, viewer). Members whose documents are needed don't need accounts. |
| D-C12 | Request letter = free text with guidance, written at the start of the case (section 1). The guidance tells the applicant what to cover (the service wanted: financing, guarantee or any other fund service; an approximate amount; the project; anything else) but the text is theirs. Amounts in it are not binding. The binding amount is entered only in the financing application, after the limit. |
| D-C13 | The assessment fee is paid at submission of the case, not at the start. All fees are editable by the fund manager in a versioned tariff screen (§6d). |
| D-C14 | Hosting is not decided yet. Whatever the host, all case data, files, comments and logs stay in the fund platform's own database and file storage (§6a). |
| D-C15 | Every document (and form section, and financial figure) has a comment thread with two kinds of comment: "message to applicant" and staff-only "internal note" (§6b). |
| D-C16 | The site visit happens only after all documents are accepted. The fund proposes a date; the applicant confirms it in the app (or asks for another date through a ticket). Visit and financial verification are independent and can happen in any order; the limit can be calculated only when both are done. |
| D-C17 | Ticketing is always available to every user and to the fund, inside and outside the case (§6c). |
| D-C18 | An internal note must name its recipients (one or more staff: analyst, technical expert, fund manager, compliance). Recipients get a notification and a task (§6b). |
| D-C19 | The analyst can request any additional document not in the checklist, with a title and a message. It becomes a new case item that the applicant uploads to; it is stored and reviewed like any other item (§3.4). |
| D-C20 | Review screen layout: the document list and the viewer sit side by side; the list stays in view while scrolling, and «مدرک قبلی / بعدی» move between items without returning to the list. |
| D-C21 | No arrangement fee. The fund earns from the assessment fee and the rate spread (master plan D26). arrangement_fee in PRD FR-FEE-1 / FR-CLS-4 is removed. |
| D-C22 | After the credit limit, the applicant submits the binding financing application. What happens after that (due diligence, committee, contracts) stays undecided and will be specified later; v1 code stops at the limit check (S-11). |
| D-C6 | The weighted scorecard with grade A–D (S-11, FR-ASM-2) and the guarantee matrix by grade (M9) are replaced by this method. S-11 is redrawn as "limit check for this application": remaining norm × Ra × Re of the project. |

## 1. Concepts

- Case (پرونده اعتباری) — one per organisation, created automatically when the org is registered. It is the container for everything the fund needs to decide a credit limit (حد اعتباری): in-app forms, uploaded documents, inquiries, site visit, scoring run, decision.
- Credit limit — the output. Not a grade: the guarantee ceiling with cheque and promissory note, in million rials (D-C2). The method also yields ceilings for the two mortgage classes and for short-term facilities; these are kept in the report as supporting figures. Valid 12 months.
- Assessment round — a case can be scored again (renewal, new statements, review request). Each round freezes its own inputs, method version and result.
- Relation to the existing pipeline — the case replaces "issuer onboarding" (FR-ISS-1) and supplies the company-level part of "credit assessment" (FR-ASM-2). A funding application (FR-APP) can be submitted only when the org has a valid credit limit, and its amount is checked against the remaining limit for the offered collateral.

An investor-only org also has a case record, but only the KYB part is active; the credit sections open when the org asks for financing.

## 2a. From registration to the case (customer journey)

#### Journey

| Step | Screen | What the customer sees |
|---|---|---|
| 1 | A-02/A-03 | Sign up with mobile or e-mail, OTP |
| 2 | A-05b (new) | "What will this organisation do here?" — invest / get financing (both allowed). Each card lists what it requires; financing says up front that a credit case follows. Choice can be added later |
| 3 | A-04, A-05, A-06–A-09 | Personal identity (Shahkar), organisation (شناسه ملی → Jibit), members and signatories, bank account, submit KYB — unchanged |
| 4 | — | When KYB is submitted with "financing" chosen, the case is opened automatically (number assigned) and pre-filled. Nothing to start by hand |
| 5 | A-0H (new variant) | After KYB approval, home shows one next action: "Complete your credit case", the 6-step financing path (account → organisation → case → fund review & limit → application → issuance) and what registration already covered |
| 6 | A-69 (new) | One-time intro: what the case and the credit limit are, what is already filled, what is left (form, financials, 15 documents, letter and fee), what to prepare, what happens after submission |
| 7 | A-70 | Case home, with a "registration and KYB — done" row on top so the link to registration is visible |
| 8 | A-71a → A-71 … | Form sections open pre-filled; the customer reviews and fills the rest |
| 9 | A-70 → A-73 | Fixes returned items only; resubmits |
| 10 | A-74 | Credit limit, usage, mortgage and facility ceilings, "apply for financing" |

The case can be filled while KYB is still in review (KYB data shows "pending"), but it can only be submitted once KYB is approved — the submit button explains this when disabled.

#### What is carried over from registration

| Registration (KYB) data | Source | Goes to | Editable in the case |
|---|---|---|---|
| Legal name, legal form, registration no., establishment date, address, postcode, activity, landline, website | KYB form + Jibit legal identity | Form §1 General, §3 Locations (head office) | Yes |
| شناسه ملی | KYB | Form §1 | No — identifies the org; to change it, a new org is registered |
| Board members, CEO, signatories, their national codes and signing rights | Jibit members / ceo / signHolders + A-08 | Form §4 people list; drives the per-person document slots | Yes (add share counts, degree, field; add non-director shareholders) |
| Representative name, role, mobile | User account (Shahkar-verified) | Form §1 representative | Yes |
| Latest gazette no. and date | Jibit news / KYB upload | Form §4 header | Yes |
| Articles of association, latest gazette upload | KYB documents | Items 2-1 and 2-2, status accepted if KYB approved them | Replaceable (new version → re-review) |
| Verified bank accounts | A-09 | Form §7 banks list | Yes (add accounts at other banks) |
| Bounced-cheque inquiry | Jibit | Fund's inquiry table (S-19), not shown to the customer | Staff only |

Field behaviour (A-71a):

- Each carried field shows an «از ثبت‌نام» tag; fixed fields show «ثابت» and are read-only.
- Once changed, the field gets a «تغییر دادید» tag, the original value and a «بازگرداندن» (restore) link. The analyst sees declared-at-registration vs. case value side by side.
- The section banner counts carried vs. still-empty fields ("8 filled from registration, 5 left").
- Changing key identity data (name, legal form, signatories) in the case marks the KYB record for update: the customer is asked to update the organisation profile, and re-KYB runs (FR-KYB-7). The case keeps working meanwhile; the fund sees a warning.
- Later changes in the organisation profile flow into fields the customer has not edited in the case; edited fields are kept and flagged.

## 2. Case lifecycle

opened (auto) → in_preparation → submitted → document_review ─┬→ returned ─→ resubmitted → document_review

```
                                                              └→ documents_complete ─┬→ visit_scheduled → visit_confirmed → visit_done ─┐
                                                                                     └→ financials_verified ───────────────────────────┴→ scoring
```

(visit and financial verification are parallel; scoring needs both)

scoring → pending_approval ─┬→ limit_issued (valid 12 months) → expired | under_review (new round)

```
                            ├→ sent_back_to_analyst
                            └→ declined
```

any state before limit_issued → withdrawn (by applicant) | closed_inactive (N days without response)

| Role | Can |
|---|---|
| Org preparer | Fill forms, upload, reply to comments |
| Org approver / org_admin | Sign the request letter and the commitment, submit / resubmit (step-up OTP) |
| analyst (fund) | Review items, return the case, enter visit result, verify financial figures, set Rc/Ra/Re, prepare the limit |
| fund_manager | Approve / send back / decline the limit (never the same person as the preparer — §12.3 of the PRD) |
| auditor | Read-only |

## 3. Case structure

Codes follow the fund's folder numbering so staff recognise them. P = one slot per person (see §3.2).

### 3.1 Items

| Code | Item | Kind | Required | Slots | Guidance shown to applicant | Review checkpoints (fund) |
|---|---|---|---|---|---|---|
| 1-1 | Company information form | In-app form (8 sections, §4) | Yes | 1 | Answer precisely; data is checked by inquiry, visit and statements | Section-by-section accept / comment |
| 1-2 | Credit-inquiry consent (اجازه‌نامه) | Generated PDF → signed scan upload | Yes | Company + P | Print the pre-filled form, sign/stamp, scan. Original must be delivered | Signature and stamp present; identity matches |
| 1-3 | Assessment fee | In-app payment at submission (receipt upload as fallback) | Yes | 1 | Amount from the fund manager's active tariff (§6d): Tehran / outside Tehran by factory location in form §3 | Payment matched |
| 1-4 | Request letter | Free text with guidance → generated letter (addressee, company, national ID, signature line added) → OTP signature. First section of the case | Yes | 1 | What to write: the service wanted (financing, guarantee or other fund services), an approximate amount, project or contract, anything else. Amounts are not binding | Read by the analyst; shown in the queue and to the fund manager |
| 1-5 | Credit report (اعتباریتو, ics24.ir) | Upload + link field | Yes | Company + P | Get a report for the company, CEO and every board member; upload each file and paste its SMS link | Readable, complete, belongs to the right person |
| 1-6 | Signature certificate (گواهی امضا) | Upload | Yes | Each signatory | From a notary, addressed to the fund. Original must be delivered | Addressed to the fund; signatory matches the gazette |
| 1-7 | Sana certificate | Upload | Yes | Company + P | — | — |
| 2-1 | Articles of association, establishment notice | From KYB (uploaded at registration) | Yes | 1 | All pages stamped and signed | All pages present and stamped |
| 2-2 | Latest registered changes (official gazette) | From KYB, cross-checked with Jibit gazette notices | Yes | 1+ | Latest notices for address and authorised signatories | Matches form section 4 |
| 2-3 | ID booklet + national card | Upload | Yes | P | All booklet pages; both sides of the card | Complete, legible |
| 2-4 | Lease or title deed of premises | Upload | Yes | Per location | — | Matches form section 3 |
| 3-1 | Financial statements / tax returns, last 4 years | Upload | Yes | Per year | Audited statements outrank tax returns; a new company supplies the years it has | Year, type, stamp; basis for §5 |
| 3-2 | Trial balance, current year | Upload | Yes | 1 | Six-column, at general / subsidiary / detail level, stamped and signed | Levels present, stamped |
| 3-3 | Bank account turnover report | Upload | Yes | Per main account | Must show total deposits, total withdrawals and average balance, with the bank's stamp | The three totals present; consistent with the trial balance |
| 3-4 | Latest insurance list | Upload | Yes | 1 | List + latest premium payment receipt | Head-count matches form section 5 |
| 4-1 | Feasibility study | Upload | If available (new/expansion projects) | 1 | — | — |
| 4-2 | Establishment / operation licence | Upload | If available | 1+ | — | — |
| 4-3 | Other licences, approvals, standards | Upload | If available | 1+ | — | — |
| 4-4 | First pages of key contracts, last 3 years | Upload | If available | 1+ | Pages with client, amount, duration; client name may be masked | Matches form section 8 |
| 4-5 | Catalogue / product introduction | Upload | Yes | 1+ | — | — |
| — | Financial summary | In-app form (§5) | Yes | 3 years | Figures exactly as in the uploaded statements, in million rials | Cell-by-cell against 3-1 |
| — | Site visit and originals delivery | Scheduling + report (after all documents are accepted) | Yes | 1 | Confirm the proposed date; hand over originals of 1-2 and 1-6 at the visit | Visit report, photos; staff marks originals "received" |

"If available" items offer a «ندارم» (not available) answer, which counts as complete. This replaces the paper checklist's «پیوست / عدم پیوست».

### 3.2 Dynamic slots

Each slot is one file with its own upload button (D-C10). The people list in form section 4 drives the checklist: for the CEO and each board member the system creates slots in 1-2, 1-5, 1-7 and 2-3; for each signatory a slot in 1-6. Shareholders who are not directors get no slots. Changing the people list adds/removes slots and re-opens the affected items.

### 3.4 Additional documents requested by the analyst

- From the review screen («درخواست مدرک اضافه»): title + message to the applicant. Several can be requested at once.
- Creates a case item of kind adhoc in a group «مدارک درخواستی کارشناس», with requested_by, the message as the first comment of its thread, and state requested.
- The applicant sees it in the case (and on the returned-items screen) with its own upload button, can upload one or more files and reply. Files are stored with versions and hashes like any other item, and the item is then reviewed (accept / needs fix / reject).
- A case returned only for additional documents follows the same return → fix → recheck path.

### 3.3 Item states

empty → uploaded/filled → in_review → accepted | needs_fix | rejected, plus not_available (optional items) and not_required. Every upload is a new version; earlier versions and the reviewer's comment stay visible to staff. Accepted items are locked for the applicant unless staff re-open them.

## 4. Company information form (1-1)

Built from the 16 numbered tables of the form in the archive (the newer of the two forms), plus three blocks that exist only in Form_info_v1405.docx (marked ★). Amounts in million rials. Pre-filled from KYB/Jibit where marked ⓙ.

| # | Section | Fields |
|---|---|---|
| 1 | General | ⓙ legal name, legal form, activity subject (latest articles), place of registration, national ID, economic code, registration no., establishment date; initial capital, current capital; representative name + role + mobile; company e-mail, website; CEO name + mobile; landline. How the company heard of the fund (SMS / e-mail / website / exhibition + title / broker or referrer + name / association + name / other) |
| 2 | Knowledge-based status | Is knowledge-based (yes/no); type (نوپا / نوآور / فناور); approval date; validity date; knowledge-based products; field (9 options) |
| 3 | Locations | For head office, workshop/factory, warehouse (repeatable): usage type, area m², staff count, owned/leased, address, postcode |
| 4 | Board, CEO, shareholders | Gazette no. + date; per person/company: name, role(s) (shareholder / board member / CEO), national ID, ID-booklet/registration no., degree level, field, share count, share %, signing right. Rule: shares total 100% |
| 4b | CVs | Per CEO/board member: position, field and degree, university, relevant experience (years), academic/professional/executive record (free text) |
| 5 | Workforce | Full-time, part-time, insured counts; key staff (repeatable): name, position, field, degree level, contract type, experience (months), on insurance list (yes/no), national ID. Full list as attachment |
| 6 | Company & products | History and introduction; process description + raw-material sourcing (text, optional diagram upload); products/services (repeatable): name, main customers, last-year sales (count + amount, currency), main competitors, knowledge-based approval (yes/no), specification and use, exports (country, year, amount) |
| 7 | Banks, facilities, guarantees | Banks/funds worked with: name, branch, account no.; facilities active or settled in the last 2 years: type, lender, amount, date received, collateral type, instalment amount, outstanding, final settlement date; guarantees (cancelled, active, called) in the last 2 years: date, issuer + branch, amount, contract subject, beneficiary, guarantee type, collateral type, fee rate, deposit rate, status, expiry. Auto totals (tables 12–13): total facilities, current facilities, undue balance; total guarantees, current guarantees. Excel import offered for both lists. ★ Returned cheques and overdue debts of the company, CEO or board members (declaration) |
| 8 | Licences, contracts, assets | Licences/approvals: description, issuer, date, expiry, note; key contracts of the last 3 years: subject, product, client, start, end, currency, amount, progress %; Excel import. Assets (optional — "to raise the limit"): company / managers and shareholders / guarantors: asset type, owner, approximate value, note (★ ignore assets under 200 million rials). ★ Collateral the company can offer |
| — | ★ Commitment (تعهدنامه) | CEO confirms correctness against the latest gazette and accepts responsibility; signed with step-up OTP at submission. Replaces "sign and stamp every page" |

Each section is saved separately, can be left and resumed, and is reviewed separately by the fund.

## 5. Financial summary (input to scoring)

Three fiscal years (latest = Y0, Y-1, Y-2), million rials, one "statement type" per year (audited / tax return / internal). These are exactly the workbook's input cells.

- Assets: cash and bank · short-term investments · notes and accounts receivable · other receivables · inventory · prepayments · other current assets → current assets · tangible fixed · intangible · long-term investments · other non-current · partners' current account → fixed assets → total assets
- Liabilities and equity: notes and accounts payable · other payables · short-term loans · advances received · other current liabilities → current liabilities · long-term loans · long-term liabilities → total liabilities · partners' current account · reserves · capital · retained earnings → equity → total
- Profit and loss: net sales and other income · cost of goods sold → gross profit · selling, general and admin · other operating expenses (net) → operating profit · financial costs · non-operating expenses · non-operating income → profit before tax → tax (25%) → net profit

Rules: totals are computed, never typed. Submission is blocked while assets ≠ liabilities + equity for any year. The applicant enters; the analyst verifies each cell against 3-1 and may change it with a mandatory reason — declared value, verified value, who and why are all kept. Scoring reads only the verified, locked version.

## 6. Review workflow (fund panel)

1. Queue (S-16): cases by stage, documents progress, owner, time in stage. Unassigned cases can be picked up.
2. Document review (S-17): folder list and built-in viewer side by side (§6a, D-C20) → per-item decision: accept / needs fix / reject, reason from a list (incomplete · illegible · no stamp or signature · outdated or invalid · belongs to someone else · other) and the item's comment thread (§6b). "Needs fix" or "reject" requires at least one message to the applicant. Per-item control points come from §3.1.
3. Return: one action sends all "needs fix" items back together; the applicant gets a notification and a task per item. The case cannot be returned with unreviewed mandatory items.
4. Applicant fixes (A-70, A-73): sees only the returned items as open, with the reviewer's message; uploads a new version, may reply; resubmits once all are fixed.
5. Documents complete: when every mandatory item is accepted, the analyst marks documents complete. Two independent tasks open, in any order:
  - Site visit: the analyst proposes date, time and visitor → the applicant confirms in the app (or asks for another date by ticket) → reminder SMS the day before → visit report (findings, photos) and originals received.
  - Financial verification: figures checked cell by cell against item 3-1 in the viewer, adjusted with reason if needed, then locked. Scoring opens only when both are done.
6. Scoring (S-18, S-19) → approval: analyst prepares; fund manager approves, sends back or declines with a reason.
7. Result (A-74): the applicant sees ceilings per product and collateral, validity, usage, and a note from the fund. Coefficients and internal notes are not shown (assumption — see Q6).

Everything is written to the audit log; documents follow the access level issuer_and_fund, internal notes internal.

## 6a. File viewer and storage

- Upload: PDF, JPG, PNG, HEIC (phone camera), and DOCX/XLSX where useful. Size limit per file (configurable, default 20 MB). Each upload stores file, SHA-256 hash, uploader, time, version.
- Viewer in the fund panel (no download needed): PDF page by page with thumbnails, zoom, rotate; images with zoom and rotate; Word/Excel converted to PDF for preview, original kept; tabs when an item has several files (one per person or year); side-by-side compare of version 1 and 2.
- Download: a button next to the viewer; every download is logged (who, which file, when) and listed in the case's access history. Viewing is logged too. Optional watermark with the reviewer's name (P1).
- Storage: files in the platform's object storage, all structured data (forms, figures, decisions, comments, tickets, logs) in the platform database, both under the fund platform's control and encrypted at rest. Files are served through short-lived signed links, never public. Nothing is sent to third parties; only document hashes go on-chain. Hosting location is open (D-C14).

## 6b. Comment threads

- Every document item, form section and financial figure has its own thread.
- Two comment types, chosen with a switch above the text box:
  - Message to the applicant — shown to the applicant next to that item; the applicant can reply. Required when the item is set to "needs fix" or "reject".
  - Internal note — staff only, shown with a distinct colour and label; never sent to the app. The writer chooses one or more recipients (technical expert, fund manager, compliance, other analysts). Each recipient gets a notification and a task in «کارهای من», and sees the note in a «یادداشت‌های داخلی برای شما» list on their screens (e.g. the visit report for the technical expert, the approval screen for the fund manager). The header shows «یادداشت داخلی به: …».
- Each comment shows author, role, time and the file version it refers to. Applicant replies appear in the same thread.
- One case-level summary comment from the analyst to the fund manager accompanies the limit.
- Later (P2): pin a comment to an area of a document page.

## 6c. Ticketing (always available)

- Where: a support icon on every app screen (with a badge for tickets waiting for the user) and a «تیکت‌ها» queue in the fund panel sidebar.
- Ticket: number, category (credit case · financing · payments and wallet · technical and login · other), optional link (case, a specific document, an application), subject, messages with attachments, status (waiting_fund → waiting_applicant → … → closed), assignee, target response time (default 1 business day).
- Who: any user of an organisation (visible to all its members with access) and any fund staff; staff can also open a ticket to an applicant.
- Notifications: in-app + SMS on each new message. Overdue tickets escalate to the fund manager.
- Links with the case: the visit-date change request opens a ticket; a ticket linked to a document opens that document for the analyst.

## 6d. Fees and tariffs (fund manager)

- Screen: پیکربندی ← کارمزدها و تعرفه‌ها, fund manager only, step-up OTP to save.
- Editable fees: assessment fee Tehran, assessment fee outside Tehran (million rials, charged at case submission), financing application fee (0 = free), annual servicing fee (%), investor fee (%, default 0), fund / platform split of fee income (%).
- Each save creates a tariff version with an effective date; history is listed on the screen and in the audit log. Every charge stores the tariff version it used, so earlier cases and applications are not affected by later changes.

## 7. Scoring method (as implemented in the workbook)

The method was re-implemented and checked against the workbook recalculated with 12 randomised cases (444 output cells, all equal).

### 7.1 Ratios (per year)

| Ratio | Formula |
|---|---|
| Profitability | profit before tax ÷ sales |
| Return on assets | profit before tax ÷ total assets |
| Interest coverage | operating profit ÷ financial costs |
| Current ratio | current assets ÷ current liabilities |
| Quick ratio | (cash + short-term investments + receivables + other receivables) ÷ current liabilities |
| Debt to assets | total liabilities ÷ total assets |
| Equity ratio | equity ÷ total assets |
| Collection period (months) | (receivables + other receivables) ÷ (sales ÷ 12) |
| Inventory period (months) | inventory × 12 ÷ cost of goods sold |
| Asset turnover | sales ÷ total assets |

- Average profit-to-sales = 50% × Y0 + 30% × Y-1 + 20% × Y-2 (of the profitability ratio)
- Average sales growth = mean of (S₋₁ − S₋₂)/S₋₂ and (S₀ − S₋₁)/S₋₁

### 7.2 Base amounts

- Guarantee base = net sales of Y0
- Facility base = max(current assets − current liabilities, 0) of Y0

### 7.3 Coefficients

| Coefficient | Guarantee | Short-term facility | Source |
|---|---|---|---|
| β | 15 / 15 / 12 / 12 / 7 | 12 / 12 / 11 / 11 / 10 | Activity type: production-contracting / production line / production-trading / services-contracting / trading-contracting |
| Rc — behavioural risk | 0–1 | same | Analyst |
| Ra — technical & operational | 0–1 | same | Analyst (per guarantee in the ledger) |
| Re — environment & market | 0–1 | same | Analyst (per guarantee in the ledger) |
| Cp — profitability & performance | matrix | same | Matrix(avg sales growth, avg profit-to-sales) |
| Cr — repayment ability | Matrix(C1, C2) | Crl = clamp(1.5 − 1.25 × debt-to-assets of Y0, 0, 1) | C1 = (current assets − current liabilities) ÷ sales; C2 = equity ÷ sales |
| Cc — collateral | 0.4 cheque with endorsement · 0.6 2nd-degree mortgage · 1.0 1st-degree mortgage | same | Fixed |

The matrix (same values for Cp and Cr; bands are upper-inclusive):

| row ↓ / column → | band 5 | band 4 | band 3 | band 2 | band 1 |
|---|---|---|---|---|---|
| band 5 | 1.0 | 0.8 | 0.6 | 0.4 | 0.2 |
| band 4 | 0.8 | 0.7 | 0.5 | 0.3 | 0.1 |
| band 3 | 0.6 | 0.5 | 0.4 | 0.2 | 0 |
| band 2 | 0.4 | 0.3 | 0.2 | 0.1 | 0 |
| band 1 | 0.2 | 0.1 | 0 | 0 | 0 |
|  | band 5 | band 4 | band 3 | band 2 | band 1 |
| Cp rows: avg sales growth | > 100% | 50–100% | 0–50% | −50–0% | ≤ −50% |
| Cp columns: avg profit-to-sales | > 20% | 10–20% | 0–10% | −10–0% | ≤ −10% |
| Cr rows C1 / columns C2 | > 0.5 | 0.25–0.5 | 0–0.25 | −0.25–0 | ≤ −0.25 |

### 7.4 Ceilings (for each collateral class k ∈ {0.4, 0.6, 1.0})

guarantee_norm[k] = sales × β_g × Rc × Cp × Cr × k

guarantee[k]      = guarantee_norm[k] × Ra × Re

facility_norm[k]  = working_capital × β_f × Rc × Ra × Re × Cp × Crl × k

facility[k]       = min(facility_norm[k], guarantee[k])

### 7.5 Guarantee norm ledger (limit usage)

```
norm_ceiling   = sales × β_g × Rc × Cp × Cr × Cc           (Cc = 0.4 in the workbook)
```

for each issued guarantee i (own Ra_i, Re_i, amount_i, active flag):

```
    ceiling_i   = remaining_norm_before_i × Ra_i × Re_i
    deduction_i = amount_i ÷ (Ra_i × Re_i)   if active, else 0      ← corrected (D-C5); the workbook divides by (Ra_i + Re_i)
    remaining   = remaining − deduction_i
```

The workbook holds up to 10 guarantees; the platform keeps an unlimited ledger and releases the deduction when a guarantee is cancelled or a financing is repaid.

### 7.6 Non-formula parts of the report

Bureau used and date, result (pass/fail), Sana (yes/no) — for the company and each board member with a description; signatories. The workbook's notes ask for a red flag on returned cheques, overdue debts, blacklist, and on a sole signatory. Free-text: technology field, products, history (year founded, customers), staff count (with the month of the insurance list), licences, current-year account turnover, statement type, proposed guarantee cheque, collateral held by the fund, the company's history with the fund, technical expert and evaluator names, addresses / area / ownership of factory and office. All of these are pre-filled from the form and items, not retyped.

### 7.7 Worked example (sample data used on the screens)

Activity: production line. Sales 310,000 / 205,000 / 138,000; working capital 56,000; equity 135,000; total liabilities 122,500; total assets 257,500; profit before tax 40,500 / 21,700 / 12,500 (million rials). Avg growth 49.9% (band 3) × avg margin 11.5% (band 4) → Cp 0.5. C1 0.18 (band 3) × C2 0.44 (band 4) → Cr 0.5. Crl = 1.5 − 1.25 × 0.476 = 0.905. With Rc 0.9, Ra 0.8, Re 0.7:

| Collateral | Guarantee | Facility |
|---|---|---|
| Cheque with endorsement | 234,360 | 61,326 |
| 2nd-degree mortgage | 351,540 | 91,988 |
| 1st-degree mortgage | 585,900 | 153,314 |

Norm ceiling 418,500; one active guarantee of 60,000 (Ra 0.8, Re 0.7) uses 60,000 ÷ 0.56 = 107,143 → remaining norm 311,357. A new project with Ra 0.8, Re 0.7 can take up to 311,357 × 0.56 = 174,360 (= credit limit 234,360 − the 60,000 already used).

## 8. Findings in the workbook to settle with the fund

| # | Finding | Proposed handling |
|---|---|---|
| W1 | Rc, Ra, Re are typed numbers (0–1) with no rubric | v1: analyst sets them with a mandatory written reason; ask the fund for a rubric (sub-factors and scores) so they become repeatable |
| W2 | Norm deduction divides by (Ra + Re) while the ceiling multiplies by Ra × Re | Fixed: divide by (Ra × Re) (D-C5). Tell the fund so the workbook is corrected too |
| W3 | Guarantee norm ceiling ignores Ra/Re (applied per guarantee); the facility ceiling includes them and is capped by the guarantee ceiling | Kept; shown as two separate steps |
| W4 | Cr matrix: C1 > 0.5 with C2 exactly −0.25 returns 0 instead of 0.2 (< instead of ≤) | Treat as a typo; use ≤ |
| W5 | Missing activity type or a year without sales gives #VALUE! / #DIV/0! | Activity type is mandatory; define a rule for companies with fewer than 3 years (Q4) |
| W6 | Tax is always 25% of profit before tax, even on a loss | Floor at 0? It does not affect the ceilings |
| W7 | The two sheets define quick ratio and return on assets differently | Use the first sheet's definitions for scoring; show the second sheet as "financial analysis" |
| W8 | Ratio columns are ordered 1402→1404 under labels, statements 1404→1402 | Screens use one order (latest first) |
| W9 | "Profit base" (سود مبنا) is computed but used nowhere | Dropped |
| W10 | The 4th year of statements and the current-year trial balance are requested but not used in any formula | Kept as supporting evidence only |
| W11 | Collateral coefficient for cheque is editable in one cell and hard-coded 0.4 in another | Single configurable table |
| W12 | Knowledge-based status and company type are selected but do not enter any formula | Stored; no effect |
| W13 | Negative net sales: the workbook computes on, reading a loss over negative sales as a positive margin, and every ceiling comes out negative | Refused like zero sales (W5): scoring stops with “sales of Y-n is negative” (2026-11-24) |
| W14 | Rc, Ra and Re are free decimals in the workbook | The platform accepts at most three decimals (stored as numeric(4,3)), so the stored coefficients and the computed limit always agree (2026-11-24) |

## 9. Effect on existing plan documents (confirmed, D-C6; applied to 02 (v1.1), 03 and 05 on 2026-11-24)

- PRD FR-ISS-1 (issuer onboarding) → replaced by the case.
- PRD FR-ASM-2 / glossary "credit grade" / S-11 — the weighted scorecard and grade A–D are removed. The case owns the company-level norm ceiling; the application's credit step is "limit check": the analyst sets Ra and Re for the project, project ceiling = remaining norm × Ra × Re, and the approved amount may not exceed it. On approval the usage ledger deducts the amount (§7.5); on repayment it is released.
- PRD M9 guarantee matrix investment_type × credit_grade → removed. Default security is cheque and promissory note; a mortgage class raises the ceiling by its coefficient (0.6 / 1.0 instead of 0.4).
- Series terms (FR-SER-1): credit_grade field → credit_limit_ref + collateral_class. Public offering page shows "credit limit checked by the fund" instead of a grade.
- FR-APP-3 application fee → the assessment fee is charged at case level (1-3).
- Config (FR-ADM-1, S-50) gains a versioned scoring method: β table, matrix values and bands, collateral coefficients, year weights, fee amounts, document checklist. Each round stores the method version it used.

## 10. Data model additions

cases (org_id, number, state, request_letter_text, letter_signed_at, assigned_analyst) · case_items (case_id, code, kind, required, subject_person_id, state) · case_item_versions (file/doc ref, uploaded_by, link_url) · case_item_reviews (decision, reason_code, message_to_applicant, internal_note, reviewer) · case_form_sections (section, data JSON, state) · case_people (role flags, share %, signing right) · financial_statements (case_id, fiscal_year, statement_type, declared JSON, verified JSON, locked_at) · financial_adjustments (field, declared, verified, reason, by) · site_visits · inquiries (subject, bureau, date, result, sana, note) · scoring_methods (version, config JSON) · assessment_rounds (case_id, method_version, inputs snapshot, Rc/Ra/Re + justification, outputs JSON, prepared_by, approved_by, state) · item_files (item_id, slot_label, version, storage_key, sha256, mime, size, uploaded_by) · file_access_log (file_id, user, action view|download, at) · comments (target_type item|form_section|fin_cell|case, target_id, type to_applicant|internal|applicant_reply, author, recipients[], file_version, body) · case_items also gets kind adhoc with requested_by and request message · visit_schedules (proposed_at, time, visitor, status proposed|confirmed|change_requested, confirmed_at) · tickets (number, org_id, category, link_type, link_id, subject, status, assignee, due_at) · ticket_messages (ticket_id, author, body, attachments) · fee_tariffs (version, effective_from, values JSON, set_by) · credit_limits (org_id, round_id, product, collateral_class, ceiling, valid_from, valid_to) · limit_usages (limit ref, source guarantee/series, amount, Ra, Re, deduction, active).

## 11. Screens (design canvas, page «پرونده و اعتبارسنجی»)

| ID | Screen | Surface |
|---|---|---|
| A-05b | Registration — purpose (invest / financing) | App |
| A-0H | Home for a financing applicant — next action and the 6-step path | App |
| A-69 | Case intro — what it is, what is pre-filled, what to prepare | App |
| A-70 | Case home — sections, status, returned items (mobile + browser) | App |
| A-71a | Information form §1 — pre-filled from registration, editable | App |
| A-71 | Information form — section 4 (board, CEO, shareholders) | App |
| A-72 | Financial summary — one year | App |
| A-73 | Document item — per-person slots, reviewer comment, re-upload | App |
| A-74 | Credit limit result (limit, usage, mortgage and short-term facility ceilings) | App |
| S-16 | Cases queue | Service app |
| S-17 | Document review (accept / needs fix / reject, comments) | Service app |
| S-18 | Verified financial figures and ratios | Service app |
| S-19 | Credit limit calculation — live (activity type, Rc, Ra, Re) | Service app |

In the simulation only (not yet on the canvas): fee and tariff settings, registration documents with per-file upload, free-text request letter, per-file document upload, document viewer with comment threads and access log, tickets (app and fund panel), visit proposal / confirmation / report, re-check of fixed items.

Not drawn (follow the same patterns): the other 6 form sections, form-section review, inquiries tab, scoring-method config.

## 12. Open questions

| # | Question | Assumption used |
|---|---|---|
| Q1 | — | Closed — D-C1 |
| Q2 | — | Closed — D-C2: guarantee ceiling with cheque and promissory note |
| Q3 | — | Closed — D-C3 |
| Q4 | Companies with fewer than 3 fiscal years | Not decided — scoring is blocked and the analyst is told |
| Q5 | Is the case needed for every registered org, or only for financing applicants? | Record for all; credit sections only for applicants |
| Q6 | What does the applicant see of the result? | Ceilings, validity, usage, a note — not the coefficients |
| Q7 | Can consent forms and signature certificates become digital (OTP per person, Jibit signature)? | v1 keeps scan + original delivery, as the fund requires today |
| Q8 | Credit report and Sana: automatic inquiry through Jibit or a bureau API instead of uploads? | Upload in v1; adapter planned |
| Q9 | Validity period and renewal rule | 12 months, new round on renewal |
| Q10 | — | Closed — D-C13: editable by the fund manager, versioned |
| Q11 | Rubric for Rc, Ra, Re | Waiting for the fund's guidance (D-C4) |
| Q12 | — | Closed — D-C5: (Ra × Re) |
| Q13 | Hosting location | Open (D-C14) |
| Q14 | — | Closed — D-C21: removed |

## 13. Fund feedback, 2026-11-25 (decisions D-C23–D-C33)

| # | Decision | Built as |
|---|---|---|
| D-C23 | The fund manager can make any fee free, e.g. the assessment | Per-company exemption in advance for the assessment or application fee (OTP); unpaid invoices waived. Tariff can still be zero for all; single invoices can be waived |
| D-C24 | ~~The lease agreement template is given to the company to download~~ — revised 2026-11-26: no lease template; the lease (or title deed) only shows the company has a real location | Template mechanism kept for the credit-inquiry form (1-2), whose template is still to be decided (it may belong to the service step after the limit) |
| D-C25 | A guide is written for getting the Etebarito report | Step-by-step guide on item 1-5 (etebarito.nics.ir / ics24.ir; company report with the company ID and the CEO's national code and mobile). Checking it against the live site is deferred (2026-11-26) |
| D-C26 | Birth certificate: all pages; national card: both sides | Guidance on 2-3; several files allowed |
| D-C27 | Financial statements for 4 years; the latest year can be a balance sheet; tax returns for the last 4 years, or a letter with the reason | Figures for 4 years; "balance sheet only" for the latest year; scoring uses the three latest full years; new item 3-5 (tax return per year) accepting a letter with a reason (newly established, inactive, exempt, other) |
| D-C28 | Six-column trial balance at the general, subsidiary and detail levels | Guidance on 3-2; several files |
| D-C29 | No payment receipt for the insurance list | Guidance on 3-4 |
| D-C30 | Contracts' first pages: several files, sales invoices accepted; catalogue required | 4-4 retitled, several files; 4-5 required |
| D-C31 | The credit manager divides cases between analysts | New role credit manager; assignment in the case workspace; "my cases" in the queue |
| D-C32 | Visit message: two assessors and one specialist; the CEO and one technical or financial person must attend. Signature: the digital signature in the system instead of the notary's signature certificate | Text in the visit SMS and in the app. Item 1-6 removed; the request letter and commitment are signed in the system with OTP; multi-signatory signing through Jibit (D21) when integrated |
| D-C33 | The applicant is told the assessment does not mean financing will be granted. The credit manager (not only the fund manager) approves; the fund manager can raise or lower limits by changing coefficients and collateral | Disclaimer at the purpose choice, on the case and on the limit screen. Limit rounds approved by the credit manager or the fund manager — **confirmed 2026-11-26**: this approval lets the company go on to request services (to be specified); limit adjustment by the fund manager |

### 13.1 Four years of statements and the trial balance (2026-11-26)

The fund's answer on how the four years are used:

- The company provides **financial statements for the past 4 years** and a **six-column trial balance of the current year up to the end of the last completed season** (D-C34, built): in summer → to the end of spring; in the middle of fall → to the end of summer; in spring → the whole previous year. The period is shown with item 3-2 to the applicant and to staff.
- The limit is calculated **twice** (D-C35, **not built yet**): (A) on the 4 years of statements; (B) on 3 years of statements plus the trial balance. If A ≥ B, A is the limit. If B > A, the analyst compares the trial balance with the tax returns and other documents and confirms it before B can be used.
- This replaces the "balance sheet only" option for the latest year (D-C27), which was a stand-in for the trial balance.

### 13.2 The two calculations and the decision chain (fund answers 2026-11-26, built)

| # | Decision | Built as |
|---|---|---|
| D-C35 | (A) on the 4 years of statements; (B) on the current-year trial balance + the statements of the 3 latest years. Margin weighted 0.4 / 0.3 / 0.2 / 0.1 (latest first); growth averaged over the three year-to-year changes. The trial balance is **not** annualised | Scoring method **version 2** (built in; rounds keep the version they used). Both calculations every time; A is the limit unless B is higher **and** the analyst confirms the trial balance against the tax returns and other documents (with a note). The trial balance is the latest period of B, so its sales and working capital are B's base |
| D-C36 | The committee sees each period separately, the last one being the trial balance | Per-period table (sales, margin, growth) for A and B, the trial balance highlighted with the months it covers and "not annualised", on every approval screen |
| D-C37 (revised by D-C38) | After the calculation: compliance officer → CEO with a comment; the CEO confirms the committee meeting was held, sees the guarantee and facility ceilings separately, may edit the numbers, accepts or declines with a comment, back to the compliance officer, who releases the result to the company with explanations; then the company can request services (to be defined) | Round states: preparing → pending_approval (credit approval by the credit manager or fund manager) → credit_approved → ceo_review → ceo_accepted / ceo_declined → approved / declined. New role **ceo** (مدیرعامل صندوق). The CEO's step needs OTP, the meeting confirmation and its date. The limit is issued only at the release; the company sees "awaiting the fund's decision" until then. CEO edits are kept with the round |

| D-C38 (2026-11-27) | The fund manager **is** the CEO; there is **no separate credit approval** — the compliance officer takes the analyst's round to the fund manager | Chain: analyst sends → compliance officer sends to the fund manager with a comment, or back to the analyst → fund manager (meeting confirmed, ceilings editable, accept/decline, OTP) → compliance officer releases to the company. Round states: preparing → pending_approval (with compliance) → ceo_review → ceo_accepted / ceo_declined → approved / declined. The CEO role and the credit approval are removed (migration 015); the credit manager assigns cases. Nobody moves a round they prepared |

Still to confirm: in spring the trial balance covers the whole previous year.
