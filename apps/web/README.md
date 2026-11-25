# apps/web — applicant and investor app (PWA)

Next.js 16 (app router), Farsi RTL, Vazirmatn, Persian digits, Jalali dates; mobile-first (390 px) with a side rail
from 1024 px. Screens follow UX spec §4 (A-*); the credit-case screens follow doc 07 §11. Design system: `packages/ui`;
API client and hooks: `packages/client`. The browser only talks to this app's origin: `/api/v1/*` is proxied to the
API (`API_URL`, default `http://localhost:3000`).

| Route | Screen |
|---|---|
| `/login` | OTP login / sign-up (A-02, A-03) |
| `/onboarding` | National code (Shahkar), create the company, purpose: invest / financing (A-04, A-05, A-05b) |
| `/kyb` | Company verification: registry record, contact details, documents, submit with OTP (A-07 … A-08) |
| `/` | Home: one next action, balance, credit limit, the 6-step financing path (A-0H) |
| `/bank` | Bank accounts: add with OTP, default, remove (A-09) |
| `/wallet` | Balances, deposit by payment ID, withdrawals (prepare → approve with OTP), statement (A-20 … A-26) |
| `/financing` | Credit case and applications hub (A-40) |
| `/case` | Credit case home: progress, blockers in plain Farsi, letter, fee, submit, site visit (A-70) |
| `/case/form/[section]` | The 9 sections of the information form, live completeness check (A-71) |
| `/case/financials` | Three years of figures in million rials, automatic totals and balance check (A-72) |
| `/case/documents` | The checklist: one slot per person / year / location / bank account; review notes (A-73) |
| `/limit` | Credit limit, validity, usage, ceilings with other collateral, the fund's note (A-74) |
| `/applications/new`, `/applications/[id]` | Financing application wizard (5 steps) and tracker (A-42 … A-44) |
| `/more`, `/notifications` | Organisation, members and invitations, account, sign out; notifications |

Not built yet (no backend): offerings, subscriptions, portfolio, the public fund site (W-*).

```bash
npm run dev -w @tp/web      # :3001 (the API on :3000)
npm run build -w @tp/web && npm run start -w @tp/web
```
