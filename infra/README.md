# Local infrastructure

| Service | Port | Purpose |
|---|---|---|
| Postgres 16 | 5432 | main database (`tp` / `tp_dev_password`) |
| Redis 7 | 6379 | cache, job queue |
| MinIO | 9000 / 9001 console | document storage (S3-compatible) |
| OpenBao (dev) | 8200 | secrets + operator key material (root token `dev-root-token`) |
| Web3Signer | 9002 | signs operator transactions, proxies to the chain on :8545 |
| Hardhat node | 8545 (host) | local chain: `npm run node -w @tp/contracts` |

## Web3Signer dev key
Create `infra/web3signer/keys/operator.yaml` pointing at a raw dev key (use Hardhat's account #1, never a real key):

```yaml
type: "file-raw"
keyType: "SECP256K1"
privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
```

In staging and production, the key lives in OpenBao (not a file), Web3Signer reads it from there, and Polygon is reached through several RPC providers with failover (`packages/contracts/scripts/lib/rpc.ts`, decision D6); our own node can be added later as one more endpoint.
