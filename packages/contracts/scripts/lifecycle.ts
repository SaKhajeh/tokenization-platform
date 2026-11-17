/**
 * Dry run of one series' whole life on a real network (Amoy), using the contracts from deployments/<network>.json:
 *
 *   1. register 3 investor wallets in the IdentityRegistry (their "digital IDs")
 *   2. create a series through the factory (1,000 units, matures tomorrow)
 *   3. issue: mintBatch 100 / 200 / 300 units
 *   4. compliance: freeze investor C, check a further issuance to C is refused, unfreeze
 *   5. checks: holder transfers are locked; an unregistered wallet cannot receive tokens
 *   6. redeem: burnBatch everyone back to zero
 *
 * Every write is confirmed on two endpoints (when two are configured). Prints explorer links.
 * The deployer key must hold the operator role (testnet mode of deploy.ts).
 *
 *   npm run lifecycle:amoy -w @tp/contracts
 */
import { artifacts, network } from "hardhat";
import { Contract, Wallet, formatEther, id } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { addrLink, chainSpec, confirmed, feeOverrides, makeEndpoints, makeProvider, signerFromEnv, txLink } from "./lib/rpc";

async function main() {
  const c = chainSpec(network.name === "hardhat" ? "localhost" : network.name);
  if (c.name === "polygon") throw new Error("The lifecycle dry run is for testnets only.");
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `${c.name}.json`), "utf8"));
  const endpoints = makeEndpoints(c);
  const provider = makeProvider(c, endpoints);
  const signer = signerFromEnv(provider);
  const me = await signer.getAddress();
  const confs = c.name === "localhost" ? 1 : 2;

  const abi = async (n: string) => (await artifacts.readArtifact(n)).abi;
  const registry = new Contract(dep.contracts.IdentityRegistry.address, await abi("IdentityRegistry"), signer);
  const factory = new Contract(dep.contracts.SeriesFactory.address, await abi("SeriesFactory"), signer);
  const tokenAbi = await abi("SeriesToken");

  if (!(await registry.hasRole(await registry.REGISTRAR_ROLE(), me)) || !(await factory.hasRole(await factory.DEPLOYER_ROLE(), me)))
    throw new Error(`${me} does not hold the operator roles. Deploy in testnet mode (ADMIN_ADDRESS/OPERATOR_ADDRESS empty).`);

  let step = 0;
  let fees = 0n;
  let gas = 0n;
  const send = async (label: string, fn: (o: object) => Promise<any>) => {
    const tx = await fn(await feeOverrides(provider, c, endpoints));
    const r = await confirmed(tx, endpoints, confs);
    fees += r.fee;
    gas += r.gasUsed;
    console.log(`  ${++step}. ${label}\n     ${txLink(c, r.hash)}  (gas ${r.gasUsed})`);
    return r;
  };
  const expectRevert = async (label: string, call: () => Promise<unknown>, errorName: string) => {
    try {
      await call();
      throw new Error(`expected ${errorName}, but the call succeeded`);
    } catch (e: any) {
      const name = e?.revert?.name ?? e?.shortMessage ?? String(e);
      if (!String(name).includes(errorName)) throw new Error(`${label}: expected ${errorName}, got ${name}`);
      console.log(`  ✓ ${label} → refused (${errorName})`);
    }
  };

  // Custodial wallets for three test organisations (keys are throwaway; custody would hold them in production).
  const [A, B, C] = [0, 1, 2].map(() => Wallet.createRandom().address);
  const outsider = Wallet.createRandom().address;
  const now = (await provider.getBlock("latest"))!.timestamp;
  const run = `dryrun-${new Date().toISOString().replace(/[:.]/g, "")}`;

  console.log(`\nLifecycle dry run on ${c.name} · run id ${run}\nOperator ${me}\n`);
  console.log("Digital IDs");
  for (const [n, w] of [["A", A], ["B", B], ["C", C]] as const)
    await send(`register investor ${n} ${w}`, (o) => registry.register(w, id(`org:${run}:${n}`), 1, id(`kyb:${run}:${n}`), now + 365 * 86400, o));

  console.log("\nSeries");
  const seriesIdHash = id(`series:${run}`);
  await send("createSeries (1,000 units, matures in 1 day)", (o) => factory.createSeries(`Dry Run ${run.slice(7, 15)}`, "DRY", seriesIdHash, id(`terms:${run}:v1`), now + 86400, 1000, o));
  const tokenAddr: string = await factory.seriesOf(seriesIdHash);
  const token = new Contract(tokenAddr, tokenAbi, signer);
  console.log(`     token ${addrLink(c, tokenAddr)}`);

  console.log("\nIssuance");
  await send("mintBatch A=100, B=200, C=300", (o) => token.mintBatch([A, B, C], [100, 200, 300], o));
  const supply1 = await token.totalSupply();
  if (supply1 !== 600n) throw new Error(`totalSupply ${supply1}, expected 600`);
  console.log(`     totalSupply 600 ✓  balances ${await token.balanceOf(A)}/${await token.balanceOf(B)}/${await token.balanceOf(C)}`);

  console.log("\nCompliance");
  await send("freeze C", (o) => token.freeze(C, o));
  await expectRevert("mint 10 more to frozen C", () => token.mint.staticCall(C, 10), "AccountFrozen");
  await send("unfreeze C", (o) => token.unfreeze(C, o));
  await expectRevert("mint to unregistered wallet", () => token.mint.staticCall(outsider, 10), "RecipientNotVerified");
  await expectRevert("mint beyond maxSupply (401 more)", () => token.mint.staticCall(A, 401), "MaxSupplyExceeded");
  await expectRevert("holder transfer (transfers locked)", () => (token.connect(provider) as Contract).transfer.staticCall(B, 1, { from: A }), "TransfersDisabled");

  console.log("\nRedemption");
  await send("burnBatch A, B, C back to zero", (o) => token.burnBatch([A, B, C], [100, 200, 300], o));
  const supply2 = await token.totalSupply();
  if (supply2 !== 0n) throw new Error(`totalSupply ${supply2}, expected 0`);
  console.log("     totalSupply 0 ✓");

  console.log(`\nAll steps passed. ${step} transactions, ${gas} gas, ${formatEther(fees)} POL. Series token: ${addrLink(c, tokenAddr)}`);
}

main()
  .catch((e) => {
    console.error("\nFAILED:", e?.shortMessage ?? e?.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(), 100));
