/**
 * Tests every configured RPC endpoint: chain id, latest block, latency. Keys are hidden in the output.
 *
 *   npm run rpc:check -w @tp/contracts               # Amoy
 *   npm run rpc:check:polygon -w @tp/contracts       # mainnet (read-only)
 */
import { network } from "hardhat";
import { chainSpec, checkEndpoints } from "./lib/rpc";

async function main() {
  const c = chainSpec(network.name === "hardhat" ? "amoy" : network.name);
  console.log(`Checking ${c.envVar} (expected chain id ${c.chainId})\n`);
  const rows = await checkEndpoints(c);
  for (const r of rows) {
    console.log(`${r.ok ? "OK  " : "FAIL"}  ${r.url}`);
    console.log(`      ${r.ok ? `block ${r.block} · ${r.ms} ms` : r.error}`);
  }
  const ok = rows.filter((r) => r.ok);
  const blocks = ok.map((r) => r.block as number);
  if (blocks.length > 1 && Math.max(...blocks) - Math.min(...blocks) > 20)
    console.log(`\nWARNING: endpoints are ${Math.max(...blocks) - Math.min(...blocks)} blocks apart; one may be lagging.`);
  console.log(`\n${ok.length}/${rows.length} endpoints usable.${ok.length < 2 ? " Add at least two for failover and cross-checks." : ""}`);
  if (!ok.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exitCode = 1;
});
