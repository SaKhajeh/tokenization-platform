# Guidance for Claude Code sessions in this repo

Read `docs/plan/` first (master plan, PRD, data model & API, Jibit integration, UX spec). If it is empty, ask Salman to add the plan docs from the claude.ai project "Tokenization Platform".

## Non-negotiables
1. **Money = `bigint` rials** end to end (`@tp/domain/money`). The API sends money as decimal strings. Never `number`, never floats, never toman in storage.
2. **Dates:** store ISO `YYYY-MM-DD` (calendar) or UTC timestamps; convert to Jalali only in the UI and in `@tp/domain/returnEngine`.
3. **Status changes go through `@tp/domain/stateMachines.transition()`**, never a raw `UPDATE … SET status`.
4. **Ledger:** append-only double-entry; every entry sums to 0; corrections are reversals. Posting map: data-model doc §1.6 + Jibit doc §3.
5. **Org scoping:** every org-owned query filters by the active org. Add an isolation test for each new repository.
6. **Maker–checker:** `prepared_by ≠ approved_by`, except a single-user org (OTP step-up). Staff actions never allow self-approval.
7. **Idempotency:** every POST that moves money, units or state requires an `Idempotency-Key`. Chain writes go through the outbox.
8. **No personal data on-chain.** Only hashes (`orgIdHash`, `kybHash`, `termsHash`).
9. **Farsi RTL UI:** Vazirmatn font, Persian digits, design tokens from `packages/ui` (mirrors the Figma file).
10. **Jibit:** all calls go through adapters with mock implementations. Never call Jibit from tests.

## Commands
- `npm test` · `npm run test -w @tp/contracts` · `npm run test -w @tp/domain`
- Contracts compile with solc-js 0.8.24 from npm (see `packages/contracts/hardhat.config.ts`); don't switch to downloaded compilers.

## Commits
Small, focused commits; tests must pass. Never commit `.env` files or keys.
