# Plan documents

These are the **living plan documents** of the project. They are kept in the repository and updated in the same
change as the code, so the plan always says what has been decided and what has been built.

| Doc | Content | Last updated |
|---|---|---|
| `01-master-plan.md` | Decisions (D1–D27), roadmap, legal track, open questions, **deliverables log** (what was built, with test counts) | 2026-11-25 (v0.24) |
| `02-prd-v1.md` | Phase 1 requirements (FR IDs; **(built)** marks what exists), state machines, business rules, permissions | 2026-11-25 (v1.1) |
| `03-data-model-and-api.md` | Tables, ledger posting map, jobs, REST API, contract interfaces | 2026-11-25 |
| `04-integrations-jibit.md` | Jibit endpoints per flow, data model additions, jobs, open questions | 2026-11-04 (v0.2) |
| `05-ux-spec.md` | IA, flows, screen inventory, design tokens, glossary | 2026-11-25 |
| `06-figma-status.md` | Where every screen is designed (Figma + Claude canvas) | 2026-11-24 |
| `07-case-file-and-credit-scoring.md` | Credit case and the fund's credit-limit method (D-C1–D-C22, workbook findings W1–W14) | 2026-11-24 |

**Precedence:** where an older document disagrees with a newer one, the newer one wins. On 2026-11-24 the PRD (v1.1),
the data model (03) and the UX spec (05) were aligned with D14 (the fund is the only issuer; companies are applicants),
doc 07 (credit case and credit limit instead of issuer onboarding, the A–D grade and the grade-based guarantee matrix),
D16, D20, D23 and D25–D27. Still open and marked as such: everything after the limit check (due diligence, committee,
contracts — D-C22) is the v1.0 draft. Doc 04 (Jibit) predates D14 and still says "issuer" for the project company in
places; read it as "project company / applicant".

**How to update:** see `01-master-plan.md` §7. In short: decisions and the deliverables log go in 01; requirements in
02; tables, jobs, endpoints and config in 03; Jibit in 04; screens in 05/06; the credit case and scoring in 07. Each
changed document gets a dated `_Updated …_` line under its title.

The documents 02–07 were imported on 2026-11-24 from a text export of the claude.ai project "Tokenization Platform";
tables, code blocks and headings were rebuilt as Markdown.
