# Tokenization Platform (پلتفرم توکن‌سازی)

A Farsi, mobile-first platform where the **research & technology fund** assesses initiatives that have already started and have a guaranteed return. The **platform** then tokenises each approved series on **Polygon PoS**, and **legal entities** invest from their verified bank accounts and receive principal + a predefined simple return at maturity.

> Specs: `docs/plan/` (master plan, PRD, data model & API, Jibit, UX, design status, credit case). They are the living plan and are updated with the code — see `docs/plan/README.md`.

## Repository layout

```
apps/
  api/        NestJS modular monolith (PRD modules M1–M19)            ← M-A … M-D (credit case) done; series terms next
  worker/     job runners (bank sync, chain outbox, payouts)            ← same codebase, other entrypoint
  web/        ✅ Next.js: applicant and investor app (PWA, fa, RTL)    ← onboarding, KYB, wallet, credit case, limit, applications
  admin/      ✅ Next.js: service app for fund and platform staff      ← KYB, queues, credit-case workspace, applications, config
packages/
  contracts/  ✅ Solidity: IdentityRegistry, SeriesFactory, SeriesToken (+ tests, deploy script)
  domain/     ✅ money (bigint rials), Jalali calendar, return engine, close rules, state machines, termsHash
  ui/         ✅ RTL design system: tokens (from the Figma file), CSS, React components, Farsi status vocabulary
  client/     ✅ browser API client: session, org scope, idempotency keys, uploads, step-up OTP sheet
e2e/          browser walk-through of both apps (Playwright), see e2e/README.md
infra/        docker-compose for local dev (Postgres, Redis, MinIO, OpenBao, Web3Signer)
docs/         living plan documents (docs/plan), updated with the code
```

## Status

| Part | State | Tests |
|---|---|---|
| `packages/contracts` | done | 46 passing · 100% lines · 99% branches |
| `packages/domain` | done | 119 passing · typecheck clean |
| `apps/api` — M-A (auth, orgs, roles, tasks, audit, documents) + M-B (KYB, bank accounts, wallets/digital ID, ledger, deposits) + M-C (applications through screening, notifications, KYB expiry, withdrawals; the fund as the only issuer) + pricing (D25–D27) + M-D parts 1–5 (credit case, scoring, credit limit, limit check) | done | 101 e2e passing (PGlite) + 2 real-EVM chain tests · typecheck clean |
| `apps/web`, `apps/admin`, `packages/ui`, `packages/client` | the credit path end to end (see each README); offerings, subscriptions, payouts not yet | build + typecheck clean · browser walk-through `e2e/` passing (5 parts) |

## Run everything locally (no Docker)

The API can run on an in-memory database with mock providers (SMS codes are printed to its log), so the two apps can be
used end to end without Postgres, MinIO or Jibit:

```bash
npm install
cd apps/api && APP_ENV=development DATABASE_URL=pglite: \
  DEV_STAFF="09350000001:analyst,finance_officer;09350000002:fund_manager,technical_expert;09350000003:compliance_officer,super_admin;09350000004:credit_manager" \
  npm run dev                       # :3000 — OTP codes appear in this log as [mock-sms]
npm run dev -w @tp/web              # :3001 applicant / investor app
npm run dev -w @tp/admin            # :3002 staff app (log in with a DEV_STAFF mobile)
```

`DATABASE_URL=pglite:./.pgdata` keeps the data between restarts. In development, uploads go to in-memory storage served by
dev-only API routes, and any well-formed IBAN is accepted as the company's (never in staging or production).

## Quick start

```bash
npm install                 # installs all workspaces
npm test                    # domain + contracts + api
npm run coverage:contracts
npm run infra:up            # local Postgres/Redis/MinIO/OpenBao/Web3Signer
npm run node -w @tp/contracts         # local chain (Hardhat) on :8545
npm run deploy:local -w @tp/contracts # deploy registry + factory to it
```

Requirements: Node ≥ 20, Docker.

## Key decisions (from the master plan)
- **Money is integer rials (`bigint`)**, never floats. Toman is display only.
- **Jalali calendar** in the UI and the return engine; ISO Gregorian dates in storage and the API.
- **Simple return, bullet at maturity**; each day weighted by its Jalali year length; rounded down per unit.
- **Off-chain double-entry ledger = source of truth for money.** The chain is the public record of units and terms.
- **Custodial wallets**; the platform operator key pays all gas; admin = Safe 2-of-3 multisig.
- **Jibit** for inquiries/KYB, Cobank deposits (payment ID) and transfers, SMS, digital contracts.
- Maker–checker on every money and issuance action; single-user organisations use an OTP step-up instead of a second approver.
