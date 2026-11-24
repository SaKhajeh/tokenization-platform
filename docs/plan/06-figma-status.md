# Design Status — Figma + Claude design canvas

_Updated 2026-11-16 · Complements 05-ux-spec.md §4 (screen inventory)._

#### Where the screens live

- Figma (Starter plan, MCP limit reached, so no further edits from Claude): https://www.figma.com/design/9pHyREdF55vvZKEEUHN1wE
- Claude design canvas (continuation, same tokens: deep blue/grey, Vazirmatn, chips, cards, buttons): https://claude.ai/artifact/NAjFKCk236oNt6joEokLu7
  - Page «نسخه ۱»: the v1 screens listed below.
  - Page «پرونده و اعتبارسنجی» (added 2026-11-15): case file and credit limit, spec in 07-case-file-and-credit-scoring.md.
- Clickable simulation — registration to credit limit (added 2026-11-16): https://claude.ai/artifact/GWJ428qL57eNaaEjmcH5h2 27 steps across 6 stages, customer phone and fund panel side by side. Live parts: purpose choice, Jibit company prefill, pre-filled/editable case fields with "changed" tag and restore, share total check, balance check on the financial summary, per-item document review with a branch (no fixes → fix step skipped), live credit-limit calculation (activity type, Rc/Ra/Re), manager send-back, application amount against the limit, project limit check with usage ÷ (Ra × Re).

#### Drawn

Figma — components: colour tokens, 10 text styles, 22 icons, Button, Status Chip, Bottom Nav, App Header, Offering Card, Input Field, Service Sidebar.

Figma — mobile (18): A-03 OTP · A-06 Onboarding checklist · A-08 Signatories & members · A-09 Add bank account · A-0H Home · A-10 Offerings · A-11 Offering detail · A-12 Choose units · A-13 Review & consents · A-14 OTP confirm sheet · A-21 Deposit (payment ID) · A-22 Withdraw · A-25 Withdraw tracker · A-31 Holding detail · A-42 Application wizard (step 2) · A-44 Issuer application tracker · A-45 Issuer series dashboard · A-50 Tasks.

Figma — desktop (2): S-10 Applications pipeline · S-02 KYB case review. (Page 03 may contain partial frames from an interrupted call for S-11/S-12/S-14; delete them. Those screens are now on the Claude canvas.)

Claude canvas — staff app (6): S-01 Operations dashboard · S-11 Application workspace — limit check (redrawn 2026-11-15) · S-12 Committee session & voting · S-14 Tokenisation queue (two-party approval) · S-22 Maturity payout run · S-23 Treasury & reconciliation.

Claude canvas — other (2 + 2 shared components): W-01 Fund website home · A-30 Portfolio (mobile) · Sidebar · TopBar.

Claude canvas — case file & credit limit (14):

- Applicant: A-05b Registration purpose · A-0H Home for a financing applicant · A-69 Case intro · A-70 Case home (mobile + browser) · A-71a Information form §1, pre-filled from registration · A-71 Information form §4 · A-72 Financial summary · A-73 Document item with reviewer comment and re-upload · A-74 Credit limit result.
- Fund: S-16 Cases queue · S-17 Document review · S-18 Verified financial figures and ratios · S-19 Credit limit calculation (interactive).

Not drawn (by decision: low design risk, built straight from the design system)

A-01/02 welcome and phone entry · A-04/05/07 identity, create org, org details · A-15 receipt · A-20/26 wallet and statement · A-32 digital ID · A-41/43/46/47 issuer profile, review, obligations, report form · A-51 task detail · A-60–64 settings · S-03, S-13, S-15, S-20, S-21, S-24, S-30, S-40, S-50, S-60 (tables and forms that follow S-02/S-10/S-23 patterns) · W-02–W-07. Case module on the canvas: the other 6 information-form sections, form-section review, inquiries tab, scoring-method config. (Request letter, fee, site visit and manager approval are shown in the simulation.)

#### Known polish items

- A-42 (Figma): align the side-by-side inputs to the same top edge.
- Success/warning chip text colours were darkened on the canvas (#166534 / #92400E) to meet WCAG AA at 12 px; apply the same to the Figma tokens before handoff.
- PRD (02) and UX spec (05) still mention the A–D credit grade; 07 §9 supersedes them.
