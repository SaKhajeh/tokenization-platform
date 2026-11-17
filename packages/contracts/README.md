# @tp/contracts — Polygon PoS smart contracts

Spec: `plan/02-prd-v1.md` §10 and `plan/03-data-model-and-api.md` §5.

| Contract | Purpose |
|---|---|
| `IdentityRegistry` | The on-chain "digital ID" for each organisation's custodial wallet. Stores only hashes + expiry; no personal data. |
| `SeriesFactory` | Deploys one `SeriesToken` per approved series from a single template; one token per `seriesIdHash`. |
| `SeriesToken` | ERC-20, **0 decimals** (1 token = 1 unit). Mint only to verified, non-frozen wallets; `maxSupply` cap; holder transfers locked until the Phase 3 switch; batch mint/burn (≤200); compliance freeze; admin `forcedTransfer` for legal corrections; pause. |

**Money never moves on-chain.** The off-chain ledger is the source of truth for money. These contracts are the public, verifiable record of who holds how many units of which series, and of each series' terms (`termsHash`).

## Roles

| Role | Holder | Can |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | **Safe 2-of-3 multisig** (hardware keys) | grant/revoke roles, pause, `forcedTransfer`, enable transfers, rotate factory token roles |
| `REGISTRAR_ROLE` (registry) | operator hot key (Web3Signer + OpenBao) | register / update / revoke / reinstate identities |
| `DEPLOYER_ROLE` (factory) | operator | `createSeries`, after the fund + two platform approvals off-chain |
| `MINTER_ROLE` / `BURNER_ROLE` / `FREEZER_ROLE` (token) | operator | issue, redeem, freeze |

The factory itself keeps **no** roles on the tokens it creates (tested).

## Commands

```bash
npm install
npx hardhat compile        # uses solc-js 0.8.24 from npm (no download from binaries.soliditylang.org)
npx hardhat test           # unit, access-control and randomised invariant tests
npx hardhat coverage       # 100% lines, ~99% branches
REPORT_GAS=true npx hardhat test

# Testnet (Amoy): see "Testnet dry run" below
```

## Gas (measured, Hardhat)

| Action | Gas |
|---|---|
| Deploy IdentityRegistry | ~824k |
| Deploy SeriesFactory | ~2.16M |
| `createSeries` (one new token) | ~1.30M |
| `register` identity | ~96k |
| `mint` one holder | ~47–81k |
| `mintBatch` 200 holders | ~6.34M (one tx; well under Polygon's block gas limit) |
| `burn` | ~31k |
| `freeze` | ~48k |

The platform operator pays all gas in POL. Investors pay nothing.

## Before mainnet
- An external audit, or at minimum an independent review.
- An Amoy dry run of a full series lifecycle (register → create → mintBatch → burnBatch).
- Admin = a Safe multisig, never an EOA. Admin and operator must be different (the deploy script enforces this on `polygon`).
- Verify the contracts on Polygonscan.

## RPC endpoints (decision D6)

No own node for now. `scripts/lib/rpc.ts` connects through several RPC providers listed in `.env`
(`AMOY_RPC_URLS`, `POLYGON_RPC_URLS`, comma-separated, in priority order):

- each request fails over to the next endpoint on timeouts, no connection, HTTP 5xx/429 or rate-limit errors, and
  the failing endpoint is benched for 60 s; contract reverts are the chain's answer and are returned, not retried
  (`RPC_DEBUG=1` prints every failover);
- signed transactions are broadcast to every endpoint (same signed bytes, so never a duplicate);
- a transaction counts as done only when two different endpoints return the same receipt;
- the priority fee never goes below Polygon's floor (`MIN_PRIORITY_FEE_GWEI`, default 30);
- API keys are hidden in all output. Keys never leave the machine: providers only see signed transactions.

## Testnet dry run (run on your own computer)

The build workspace cannot reach Polygon, so these steps run on a machine with internet access.

```bash
# once, from the repo root
npm install

cd packages/contracts
cp .env.example .env                     # then put your dRPC key into AMOY_RPC_URLS (and POLYGON_RPC_URLS)
npm run rpc:check                        # every endpoint: OK/FAIL, block height, latency
npm run wallet:new                       # creates the deployer key in .env, prints the public address
#   → get test POL for that address from a faucet (Amoy), about 0.5 POL is plenty
npm run deploy:amoy                      # checks the balance first; writes deployments/amoy.json
npm run lifecycle:amoy                   # one series end to end; prints explorer links
```

Measured on a local chain: deployment 3.16M gas, lifecycle 2.01M gas (8 transactions).
At 30–60 gwei that is roughly 0.15–0.3 POL in total.

`deployments/amoy.json` holds only public addresses and transaction hashes; it is safe to share and commit.

## Amoy deployment (testnet, 2026-11-08)

| Contract | Address |
|---|---|
| IdentityRegistry | [0x7d72E78c129B7BF82Ef78F9327Daf5c3E279fbDC](https://amoy.polygonscan.com/address/0x7d72E78c129B7BF82Ef78F9327Daf5c3E279fbDC) |
| SeriesFactory | [0x0a2e368D6132aD43aB0e6b5F10c66B316112FeF4](https://amoy.polygonscan.com/address/0x0a2e368D6132aD43aB0e6b5F10c66B316112FeF4) |

Testnet mode: one key holds admin and operator (its private key was exposed in chat — testnet only, never reuse).
Lifecycle dry run passed on Amoy: 8 transactions, 2.15M gas, 0.064 POL; first dry-run series token
[0x4bc3E6C54C0d842dDef66334D5A9e4b242B15Fdf](https://amoy.polygonscan.com/address/0x4bc3E6C54C0d842dDef66334D5A9e4b242B15Fdf).
Failover was exercised live (the keyed dRPC endpoint timed out once; the next endpoint answered).
