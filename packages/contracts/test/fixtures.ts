import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

export const DAY = 24 * 60 * 60;
export const YEAR = 365 * DAY;

export const id = (s: string) => ethers.keccak256(ethers.toUtf8Bytes(s));

/**
 * Deploys the full system the way production does:
 *   admin    = platform Safe multisig (simulated by one signer)
 *   operator = platform hot key (registrar, deployer, minter, burner, freezer)
 *   alice/bob/carol = custodial org wallets
 *   outsider = random account with no roles
 */
export async function deploySystem() {
  const [admin, operator, alice, bob, carol, outsider] = await ethers.getSigners();

  const registry = await ethers.deployContract("IdentityRegistry", [admin.address, operator.address]);
  const factory = await ethers.deployContract("SeriesFactory", [
    await registry.getAddress(),
    admin.address,
    operator.address,
    admin.address,
    operator.address,
  ]);

  const now = await time.latest();
  const expiry = BigInt(now + YEAR);
  const FLAG_INVESTOR = 1;

  for (const [i, w] of [alice, bob].entries()) {
    await registry.connect(operator).register(w.address, id(`org-${i}`), FLAG_INVESTOR, id(`kyb-${i}`), expiry);
  }

  return { admin, operator, alice, bob, carol, outsider, registry, factory, expiry };
}

/** deploySystem + one series (BAT-1405-01, 5,000 units, matures in one year). */
export async function deployWithSeries() {
  const sys = await deploySystem();
  const { operator, factory } = sys;
  const maturity = BigInt((await time.latest()) + YEAR);
  const seriesIdHash = id("series:BAT-1405-01");
  const termsHash = id("terms:BAT-1405-01:v1");

  const tx = await factory
    .connect(operator)
    .createSeries("Battery Line BAT-1405-01", "BAT0501", seriesIdHash, termsHash, maturity, 5_000n);
  await tx.wait();
  const tokenAddr = await factory.seriesOf(seriesIdHash);
  const token = await ethers.getContractAt("SeriesToken", tokenAddr);
  return { ...sys, token, maturity, seriesIdHash, termsHash };
}
