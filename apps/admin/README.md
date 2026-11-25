# apps/admin — service app for fund and platform staff

Next.js 16, Farsi RTL, desktop-first (1440 px) with a right sidebar filtered by the staff member's roles (UX spec §2.3).
Same design system and client as `apps/web`; sessions are separate. `/api/v1/*` is proxied to the API (`API_URL`).

| Route | Screen | Roles |
|---|---|---|
| `/` | Dashboard: task queue for my roles, internal notes for me (S-01) | all staff |
| `/kyb`, `/kyb/[id]` | KYB queue and review: registry next to the declared details, risk flags, the introduction letter, decision (S-02) | compliance |
| `/bank` | Bank accounts that did not match automatically (S-03) | compliance |
| `/withdrawals` | Queue → fund manager approval above the threshold (OTP) → send (OTP) (S-21) | finance, fund manager |
| `/cases`, `/cases/[id]` | Credit cases by stage, with the owning analyst and "my cases"; the credit manager assigns cases; the fund manager grants fee exemptions and adjusts issued limits (live preview, OTP); workspace: overview and access log, documents with a viewer (accept / needs fix / reject, originals), form review, verified figures (each change with a reason) and lock, site visit, live credit-limit calculation, approval by a second person with OTP (S-16 … S-19) | analyst, credit manager, technical expert, fund manager |
| `/applications`, `/applications/[id]` | Pipeline; screening (checklist, items returned to the applicant) and the limit check with a live project ceiling (S-10, S-11) | analyst |
| `/invoices` | Fee invoices; waive with a reason (OTP) | fund manager, finance |
| `/config` | Fee tariff (new version with OTP), rate policy, scoring method (read-only), templates for checklist items (lease, credit-inquiry form) | fund manager and others (read) |

Not built yet: committee, terms and tokenisation queue, series control, payout runs, reconciliation, reports.

```bash
npm run dev -w @tp/admin    # :3002
```

Staff roles are granted with `npm run seed:staff -w @tp/api -- <mobile> <role…>` (after the user has logged in once),
or in local development with `DEV_STAFF` when the API starts (see the root README).
