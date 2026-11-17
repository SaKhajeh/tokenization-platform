/**
 * End-to-end on a real EVM: starts a local Hardhat node, deploys the real IdentityRegistry, and lets the API's chain
 * worker register an org's digital ID through EvmChain (multi-RPC failover, with a dead endpoint listed first).
 * Run with: CHAIN_IT=1 npx vitest run test/chain-evm.test.ts  (needs packages/contracts compiled)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ContractFactory, JsonRpcProvider, Wallet, Contract } from "ethers";
import { makeApp, TestApp, approvedOrg, staff, stepUp, idem, KYB_FIELDS } from "./helpers.js";
import { EvmChain, REGISTRY_ABI } from "../src/chain/gateway.js";

const run = !!process.env.CHAIN_IT;
const here = path.dirname(fileURLToPath(import.meta.url));
const contractsDir = path.resolve(here, "../../../packages/contracts");
const PORT = 8547;
const RPC = `http://127.0.0.1:${PORT}`;
const OPERATOR_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // hardhat #0 (public test key)

describe.skipIf(!run)("EVM chain worker (local node)", () => {
  let node: ChildProcess;
  let t: TestApp;
  let chain: EvmChain;
  let registryAddress: string;

  beforeAll(async () => {
    node = spawn("npx", ["hardhat", "node", "--port", String(PORT)], { cwd: contractsDir, stdio: "ignore" });
    const probe = new JsonRpcProvider(RPC);
    for (let i = 0; i < 60; i++) {
      try {
        await probe.getBlockNumber();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    const art = JSON.parse(readFileSync(path.join(contractsDir, "artifacts/contracts/IdentityRegistry.sol/IdentityRegistry.json"), "utf8"));
    const deployer = new Wallet(OPERATOR_KEY, probe);
    const reg = await new ContractFactory(art.abi, art.bytecode, deployer).deploy(deployer.address, deployer.address);
    await reg.waitForDeployment();
    registryAddress = await reg.getAddress();
    probe.destroy();

    chain = new EvmChain({
      chainId: 31337,
      rpcUrls: ["http://127.0.0.1:9", RPC], // first endpoint is dead: failover must carry the work
      registryAddress,
      operatorPrivateKey: OPERATOR_KEY,
      confirmations: 1,
      minPriorityFeeGwei: "1",
      explorer: null,
    });
    t = await makeApp({}, chain);
  }, 60_000);

  afterAll(async () => {
    await t?.close();
    chain?.destroy();
    node?.kill();
  });

  it("registers an approved org's wallet in the real IdentityRegistry", async () => {
    const { admin, org } = await approvedOrg(t, 41);
    const officer = await staff(t, "09354440001", "tokenisation_officer");
    const p1 = await t.http.post("/api/v1/admin/chain/process").set(officer.auth).expect(200);
    expect(p1.body.sent).toBe(1);
    // hardhat automines; one more pass reads the receipt
    const p2 = await t.http.post("/api/v1/admin/chain/process").set(officer.auth).expect(200);
    expect(p2.body.confirmed).toBe(1);

    const w = await t.http.get("/api/v1/wallet").set(admin.auth).set(org).expect(200);
    expect(w.body.registry_status).toBe("registered");
    expect(w.body.registration_tx.tx_hash).toMatch(/^0x[0-9a-f]{64}$/);

    const reader = new JsonRpcProvider(RPC);
    const registry = new Contract(registryAddress, REGISTRY_ABI, reader);
    expect(await registry.isVerified(w.body.address)).toBe(true);
    const id = await registry.identityOf(w.body.address);
    expect(Number(id.flags)).toBe(1);
    expect(Number(id.expiry)).toBeGreaterThan(Date.now() / 1000 + 360 * 86400);
    reader.destroy();

    // A re-queued registration for an already registered wallet is recognised, not re-sent (which would revert).
    await t.db.query(`update chain_txs set status='queued', next_attempt_at=now()`);
    const p3 = await t.http.post("/api/v1/admin/chain/process").set(officer.auth).expect(200);
    expect(p3.body).toMatchObject({ sent: 0, confirmed: 1, failed: 0 });
  }, 60_000);

  it("revokes on KYB expiry, then reinstates and updates on re-approval — on the real contract", async () => {
    const { admin, org, orgId, reviewer } = await approvedOrg(t, 42);
    const ops = await staff(t, "09354440002", "tokenisation_officer", "super_admin");
    const drain = async () => {
      for (let i = 0; i < 4; i++) await t.http.post("/api/v1/admin/chain/process").set(ops.auth).expect(200);
    };
    await drain();
    const w = (await t.http.get("/api/v1/wallet").set(admin.auth).set(org).expect(200)).body;
    const reader = new JsonRpcProvider(RPC);
    const registry = new Contract(registryAddress, REGISTRY_ABI, reader);
    expect(await registry.isVerified(w.address)).toBe(true);

    await t.db.query(`update orgs set kyb_expires_at = now() - interval '1 minute' where id = $1`, [orgId]);
    await t.http.post("/api/v1/admin/jobs/kyb-expiry/run").set(ops.auth).expect(200);
    await drain();
    expect((await registry.identityOf(w.address)).revoked).toBe(true);
    expect(await registry.isVerified(w.address)).toBe(false);

    const reg = await t.http.post("/api/v1/kyb/registry").set(admin.auth).set(org).expect(200);
    const body = { snapshot_id: reg.body.snapshot.id, fields: KYB_FIELDS };
    const su = await stepUp(t, admin, "POST", "/api/v1/kyb/submit", body);
    const sub = await t.http.post("/api/v1/kyb/submit").set(admin.auth).set({ ...org, "x-step-up-token": su }).set(idem()).send(body).expect(201);
    await t.http.post(`/api/v1/admin/kyb/${sub.body.id}/decision`).set(reviewer.auth).send({ decision: "approve", expires_at: "2027-12-31" }).expect(200);
    await drain();
    const id = await registry.identityOf(w.address);
    expect(id.revoked).toBe(false);
    expect(Number(id.expiry)).toBe(Math.floor(new Date("2027-12-31").getTime() / 1000));
    expect(await registry.isVerified(w.address)).toBe(true);
    const txs = await t.http.get("/api/v1/admin/chain/txs").set(ops.auth).expect(200);
    const mine = txs.body.filter((x: any) => x.ref_id === txs.body.find((y: any) => y.purpose === "reinstate_identity")?.ref_id);
    expect(mine.map((x: any) => x.purpose).sort()).toEqual(["register_identity", "reinstate_identity", "revoke_identity", "update_identity"]);
    expect(mine.every((x: any) => x.status === "confirmed")).toBe(true);
    reader.destroy();
  }, 90_000);
});
