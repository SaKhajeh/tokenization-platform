/**
 * Creates a new deployer wallet ON THIS MACHINE and stores its private key in packages/contracts/.env.
 * Prints only the public address (safe to share). Refuses to overwrite an existing key.
 *
 *   npm run wallet:new -w @tp/contracts
 */
import { Wallet } from "ethers";
import * as fs from "fs";
import * as path from "path";

const envPath = path.join(__dirname, "..", ".env");
const examplePath = path.join(__dirname, "..", ".env.example");

let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : fs.readFileSync(examplePath, "utf8");
const existing = env.match(/^DEPLOYER_PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m);
if (existing) {
  console.log("A deployer key already exists in .env — not replacing it.");
  console.log("Address:", new Wallet(existing[1]).address);
  process.exit(0);
}

const w = Wallet.createRandom();
if (/^DEPLOYER_PRIVATE_KEY=.*$/m.test(env)) env = env.replace(/^DEPLOYER_PRIVATE_KEY=.*$/m, `DEPLOYER_PRIVATE_KEY=${w.privateKey}`);
else env += `\nDEPLOYER_PRIVATE_KEY=${w.privateKey}\n`;
fs.writeFileSync(envPath, env, { mode: 0o600 });

console.log("New deployer wallet created. Private key saved to packages/contracts/.env (never share it).");
console.log("");
console.log("Address (public, safe to share):", w.address);
console.log("Fund it with test POL from a faucet, e.g. https://faucet.polygon.technology (network: Amoy).");
console.log("Testnet only: for mainnet the roles go to the Safe multisig and the Web3Signer operator key.");
