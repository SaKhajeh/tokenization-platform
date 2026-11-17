/**
 * Deploys IdentityRegistry + SeriesFactory through the multi-provider RPC client (scripts/lib/rpc.ts).
 *
 *   ADMIN_ADDRESS     Safe multisig (2-of-3) — DEFAULT_ADMIN on registry, factory and every series token
 *   OPERATOR_ADDRESS  platform hot key behind Web3Signer — REGISTRAR, DEPLOYER, MINTER/BURNER/FREEZER
 *   (testnet: leave both empty and the deployer key takes both roles, so the lifecycle test can run)
 *
 *   npm run deploy:amoy -w @tp/contracts
 *
 * Checks the balance against an estimate before sending anything.
 * Writes deployments/<network>.json for the backend chain module and the lifecycle test.
 */
import { artifacts, network } from "hardhat";
import { ContractFactory, formatEther } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { addrLink, chainSpec, confirmed, feeOverrides, makeEndpoints, makeProvider, redact, rpcUrls, signerFromEnv, txLink } from "./lib/rpc";

async function main() {
  const c = chainSpec(network.name === "hardhat" ? "localhost" : network.name);
  const endpoints = makeEndpoints(c);
  const provider = makeProvider(c, endpoints);
  const signer = signerFromEnv(provider);
  const deployer = await signer.getAddress();
  const admin = process.env.ADMIN_ADDRESS || deployer;
  const operator = process.env.OPERATOR_ADDRESS || deployer;

  if (c.name === "polygon") {
    if (admin === operator) throw new Error("On mainnet the admin (multisig) and the operator (hot key) must be different addresses.");
    if (admin === deployer) throw new Error("On mainnet ADMIN_ADDRESS must be the Safe multisig, not the deployer key.");
  } else if (admin === deployer && operator === deployer) {
    console.log("Testnet mode: the deployer key gets both the admin and the operator roles.\n");
  }

  console.log(`network   ${c.name} (chain ${c.chainId})`);
  console.log(`endpoints ${rpcUrls(c).map(redact).join("  |  ")}`);
  console.log(`deployer  ${deployer}\nadmin     ${admin}\noperator  ${operator}\n`);

  const reg = await artifacts.readArtifact("IdentityRegistry");
  const fac = await artifacts.readArtifact("SeriesFactory");
  const RegF = new ContractFactory(reg.abi, reg.bytecode, signer);
  const FacF = new ContractFactory(fac.abi, fac.bytecode, signer);

  // Cost check before spending anything.
  const fees = await feeOverrides(provider, c, endpoints);
  const gasReg = await provider.estimateGas({ ...(await RegF.getDeployTransaction(admin, operator)), from: deployer });
  const gasFacGuess = gasReg * 6n; // the factory embeds the token bytecode; exact estimate needs the registry address
  const price = (fees as any).maxFeePerGas ?? (await provider.getFeeData()).gasPrice ?? 0n;
  const need = (gasReg + gasFacGuess) * price;
  const balance = await provider.getBalance(deployer);
  console.log(`balance   ${formatEther(balance)} POL · estimated max cost ${formatEther(need)} POL`);
  if (balance < need) {
    console.error(`\nNot enough POL. Send at least ${formatEther(need - balance)} more to ${deployer} (faucet for Amoy) and run again.`);
    process.exitCode = 1;
    return;
  }

  const registry = await RegF.deploy(admin, operator, fees);
  const rReg = await confirmed(registry.deploymentTransaction()!, endpoints, c.name === "localhost" ? 1 : 3);
  const registryAddr = await registry.getAddress();
  console.log(`IdentityRegistry ${registryAddr}\n  ${txLink(c, rReg.hash)}`);

  const factory = await FacF.deploy(registryAddr, admin, operator, admin, operator, await feeOverrides(provider, c, endpoints));
  const rFac = await confirmed(factory.deploymentTransaction()!, endpoints, c.name === "localhost" ? 1 : 3);
  const factoryAddr = await factory.getAddress();
  console.log(`SeriesFactory    ${factoryAddr}\n  ${txLink(c, rFac.hash)}`);

  const out = {
    network: c.name,
    chainId: c.chainId,
    deployedAt: new Date().toISOString(),
    deployer,
    admin,
    operator,
    contracts: {
      IdentityRegistry: { address: registryAddr, block: rReg.blockNumber, tx: rReg.hash },
      SeriesFactory: { address: factoryAddr, block: rFac.blockNumber, tx: rFac.hash },
    },
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${c.name}.json`), JSON.stringify(out, null, 2) + "\n");
  console.log(`\nsaved deployments/${c.name}.json · ${rReg.gasUsed + rFac.gasUsed} gas · ${formatEther(rReg.fee + rFac.fee)} POL`);
  if (c.explorer) console.log(`registry on explorer: ${addrLink(c, registryAddr)}`);
}

main()
  .catch((e) => {
    console.error(e?.shortMessage ?? e?.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(), 100)); // the provider keeps polling timers alive
