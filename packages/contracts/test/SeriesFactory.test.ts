import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { deploySystem, deployWithSeries, id, YEAR } from "./fixtures";

describe("SeriesFactory", () => {
  it("deploys a series token with the agreed parameters", async () => {
    const { token, registry, factory, maturity, seriesIdHash, termsHash } = await loadFixture(deployWithSeries);
    expect(await token.name()).to.equal("Battery Line BAT-1405-01");
    expect(await token.symbol()).to.equal("BAT0501");
    expect(await token.decimals()).to.equal(0);
    expect(await token.maxSupply()).to.equal(5_000n);
    expect(await token.maturity()).to.equal(maturity);
    expect(await token.termsHash()).to.equal(termsHash);
    expect(await token.seriesIdHash()).to.equal(seriesIdHash);
    expect(await token.registry()).to.equal(await registry.getAddress());
    expect(await token.transfersEnabled()).to.equal(false);
    expect(await factory.seriesCount()).to.equal(1n);
    expect(await factory.seriesAt(0)).to.equal(await token.getAddress());
  });

  it("assigns token roles to the multisig and the operator only", async () => {
    const { token, admin, operator, factory } = await loadFixture(deployWithSeries);
    const factoryAddr = await factory.getAddress();
    expect(await token.hasRole(await token.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
    for (const r of [await token.MINTER_ROLE(), await token.BURNER_ROLE(), await token.FREEZER_ROLE()]) {
      expect(await token.hasRole(r, operator.address)).to.equal(true);
      expect(await token.hasRole(r, factoryAddr)).to.equal(false);
    }
    expect(await token.hasRole(await token.DEFAULT_ADMIN_ROLE(), operator.address)).to.equal(false);
    expect(await token.hasRole(await token.DEFAULT_ADMIN_ROLE(), factoryAddr)).to.equal(false);
  });

  it("emits SeriesCreated", async () => {
    const { factory, operator } = await loadFixture(deploySystem);
    const maturity = BigInt((await time.latest()) + YEAR);
    await expect(factory.connect(operator).createSeries("S", "S1", id("s1"), id("t1"), maturity, 100n))
      .to.emit(factory, "SeriesCreated")
      .withArgs(ethers.isAddress, id("s1"), id("t1"), maturity, 100n);
  });

  it("refuses a second token for the same series", async () => {
    const { factory, operator, token, seriesIdHash, maturity } = await loadFixture(deployWithSeries);
    await expect(factory.connect(operator).createSeries("X", "X", seriesIdHash, id("t2"), maturity, 10n))
      .to.be.revertedWithCustomError(factory, "SeriesExists")
      .withArgs(seriesIdHash, await token.getAddress());
  });

  it("only the deployer role can create series", async () => {
    const { factory, outsider, admin } = await loadFixture(deploySystem);
    const maturity = BigInt((await time.latest()) + YEAR);
    for (const s of [outsider, admin]) {
      await expect(
        factory.connect(s).createSeries("S", "S", id("s"), id("t"), maturity, 1n),
      ).to.be.revertedWithCustomError(factory, "AccessControlUnauthorizedAccount");
    }
  });

  it("rejects invalid series parameters", async () => {
    const { factory, operator } = await loadFixture(deploySystem);
    const token = await ethers.getContractFactory("SeriesToken");
    const now = BigInt(await time.latest());
    const future = now + BigInt(YEAR);
    await expect(
      factory.connect(operator).createSeries("S", "S", id("a"), ethers.ZeroHash, future, 1n),
    ).to.be.revertedWithCustomError(token, "InvalidParams");
    await expect(
      factory.connect(operator).createSeries("S", "S", ethers.ZeroHash, id("t"), future, 1n),
    ).to.be.revertedWithCustomError(token, "InvalidParams");
    await expect(
      factory.connect(operator).createSeries("S", "S", id("b"), id("t"), future, 0n),
    ).to.be.revertedWithCustomError(token, "InvalidParams");
    await expect(
      factory.connect(operator).createSeries("S", "S", id("c"), id("t"), now, 1n),
    ).to.be.revertedWithCustomError(token, "InvalidParams");
  });

  it("multisig can rotate token roles for future series", async () => {
    const { factory, admin, operator, outsider, carol } = await loadFixture(deploySystem);
    await expect(factory.connect(admin).setTokenRoles(carol.address, outsider.address))
      .to.emit(factory, "TokenRolesSet")
      .withArgs(carol.address, outsider.address);
    const maturity = BigInt((await time.latest()) + YEAR);
    await factory.connect(operator).createSeries("S", "S", id("new"), id("t"), maturity, 1n);
    const t = await ethers.getContractAt("SeriesToken", await factory.seriesOf(id("new")));
    expect(await t.hasRole(await t.MINTER_ROLE(), outsider.address)).to.equal(true);
    expect(await t.hasRole(await t.DEFAULT_ADMIN_ROLE(), carol.address)).to.equal(true);
    await expect(factory.connect(operator).setTokenRoles(carol.address, carol.address)).to.be.revertedWithCustomError(
      factory,
      "AccessControlUnauthorizedAccount",
    );
    await expect(
      factory.connect(admin).setTokenRoles(ethers.ZeroAddress, carol.address),
    ).to.be.revertedWithCustomError(factory, "ZeroAddress");
  });

  it("constructor rejects zero addresses", async () => {
    const { registry } = await loadFixture(deploySystem);
    const [a] = await ethers.getSigners();
    const F = await ethers.getContractFactory("SeriesFactory");
    const r = await registry.getAddress();
    const Z = ethers.ZeroAddress;
    for (const args of [
      [Z, a.address, a.address, a.address, a.address],
      [r, Z, a.address, a.address, a.address],
      [r, a.address, Z, a.address, a.address],
      [r, a.address, a.address, Z, a.address],
      [r, a.address, a.address, a.address, Z],
    ]) {
      await expect(F.deploy(...(args as [string, string, string, string, string]))).to.be.revertedWithCustomError(
        F,
        "ZeroAddress",
      );
    }
  });
});
