# Tokenization Platform (پلتفرم توکن‌سازی)

A Farsi, mobile-first platform where the **research & technology fund** assesses initiatives that have already started and have a guaranteed return. The **platform** then tokenises each approved series on **Polygon PoS**, and **legal entities** invest from their verified bank accounts and receive principal + a predefined simple return at maturity.

> Specs: `docs/plan/` (master plan, PRD, data model & API, Jibit, UX, design status, credit case). They are the living plan and are updated with the code — see `docs/plan/README.md`.

## Repository layout

```
apps/
  api/        NestJS modular monolith (PRD modules M1–M19)            ← M-A … M-D (credit case) done; series terms next
  worker/     job runners (bank sync, chain outbox, payouts)            ← same codebase, other entrypoint
  web/        Next.js: public fund site + investor/issuer PWA (fa, RTL)
  admin/      Next.js: service app for fund and platform staff
packages/
  contracts/  ✅ Solidity: IdentityRegistry, SeriesFactory, SeriesToken (+ tests, deploy script)
  domain/     ✅ money (bigint rials), Jalali calendar, return engine, close rules, state machines, termsHash
  ui/         RTL design system (tokens from the Figma file)
infra/        docker-compose for local dev (Postgres, Redis, MinIO, OpenBao, Web3Signer)
docs/         living plan documents (docs/plan), updated with the code
```

## Status

| Part | State | Tests |
|---|---|---|
| `packages/contracts` | done | 46 passing · 100% lines · 99% branches |
| `packages/domain` | done | 119 passing · typecheck clean |
| `apps/api` — M-A (auth, orgs, roles, tasks, audit, documents) + M-B (KYB, bank accounts, wallets/digital ID, ledger, deposits) + M-C (applications through screening, notifications, KYB expiry, withdrawals; the fund as the only issuer) + pricing (D25–D27) + M-D parts 1–5 (credit case, scoring, credit limit, limit check) | done | 100 e2e passing (PGlite) + 2 real-EVM chain tests · typecheck clean |
| other `apps/*`, `packages/ui` | scaffold only (see each README) | — |

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
