import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { deploySystem, id, YEAR, DAY } from "./fixtures";

describe("IdentityRegistry", () => {
  it("registers an identity and reports it verified", async () => {
    const { registry, alice } = await loadFixture(deploySystem);
    expect(await registry.isVerified(alice.address)).to.equal(true);
    const rec = await registry.identityOf(alice.address);
    expect(rec.exists).to.equal(true);
    expect(rec.revoked).to.equal(false);
    expect(rec.flags).to.equal(1);
    expect(rec.orgIdHash).to.equal(id("org-0"));
  });

  it("unknown wallets are not verified", async () => {
    const { registry, carol } = await loadFixture(deploySystem);
    expect(await registry.isVerified(carol.address)).to.equal(false);
  });

  it("emits IdentityRegistered", async () => {
    const { registry, operator, carol, expiry } = await loadFixture(deploySystem);
    await expect(registry.connect(operator).register(carol.address, id("org-c"), 3, id("kyb-c"), expiry))
      .to.emit(registry, "IdentityRegistered")
      .withArgs(carol.address, id("org-c"), 3, id("kyb-c"), expiry);
  });

  it("only the registrar can register, update, revoke or reinstate", async () => {
    const { registry, outsider, admin, carol, alice, expiry } = await loadFixture(deploySystem);
    const role = await registry.REGISTRAR_ROLE();
    for (const signer of [outsider, admin]) {
      await expect(registry.connect(signer).register(carol.address, id("x"), 1, id("k"), expiry))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(signer.address, role);
      await expect(registry.connect(signer).update(alice.address, 1, id("k"), expiry)).to.be.revertedWithCustomError(
        registry,
        "AccessControlUnauthorizedAccount",
      );
      await expect(registry.connect(signer).revoke(alice.address)).to.be.revertedWithCustomError(
        registry,
        "AccessControlUnauthorizedAccount",
      );
      await expect(registry.connect(signer).reinstate(alice.address)).to.be.revertedWithCustomError(
        registry,
        "AccessControlUnauthorizedAccount",
      );
    }
  });

  it("rejects duplicates, zero address, empty hashes and past expiry", async () => {
    const { registry, operator, alice, carol, expiry } = await loadFixture(deploySystem);
    await expect(registry.connect(operator).register(alice.address, id("o"), 1, id("k"), expiry))
      .to.be.revertedWithCustomError(registry, "AlreadyRegistered")
      .withArgs(alice.address);
    await expect(
      registry.connect(operator).register(ethers.ZeroAddress, id("o"), 1, id("k"), expiry),
    ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    await expect(
      registry.connect(operator).register(carol.address, ethers.ZeroHash, 1, id("k"), expiry),
    ).to.be.revertedWithCustomError(registry, "EmptyHash");
    await expect(
      registry.connect(operator).register(carol.address, id("o"), 1, ethers.ZeroHash, expiry),
    ).to.be.revertedWithCustomError(registry, "EmptyHash");
    const past = BigInt(await time.latest());
    await expect(registry.connect(operator).register(carol.address, id("o"), 1, id("k"), past))
      .to.be.revertedWithCustomError(registry, "ExpiryInPast")
      .withArgs(past);
  });

  it("identity stops being verified after expiry and can be renewed with update", async () => {
    const { registry, operator, alice } = await loadFixture(deploySystem);
    await time.increase(YEAR + DAY);
    expect(await registry.isVerified(alice.address)).to.equal(false);
    const newExpiry = BigInt((await time.latest()) + YEAR);
    await expect(registry.connect(operator).update(alice.address, 3, id("kyb-renewed"), newExpiry))
      .to.emit(registry, "IdentityUpdated")
      .withArgs(alice.address, 3, id("kyb-renewed"), newExpiry);
    expect(await registry.isVerified(alice.address)).to.equal(true);
  });

  it("update requires an existing identity and valid inputs", async () => {
    const { registry, operator, alice, carol, expiry } = await loadFixture(deploySystem);
    await expect(registry.connect(operator).update(carol.address, 1, id("k"), expiry))
      .to.be.revertedWithCustomError(registry, "NotRegistered")
      .withArgs(carol.address);
    await expect(
      registry.connect(operator).update(alice.address, 1, ethers.ZeroHash, expiry),
    ).to.be.revertedWithCustomError(registry, "EmptyHash");
    await expect(
      registry.connect(operator).update(alice.address, 1, id("k"), BigInt(await time.latest())),
    ).to.be.revertedWithCustomError(registry, "ExpiryInPast");
  });

  it("revoke blocks verification; update does not lift it; reinstate does", async () => {
    const { registry, operator, alice, expiry } = await loadFixture(deploySystem);
    await expect(registry.connect(operator).revoke(alice.address)).to.emit(registry, "IdentityRevoked");
    expect(await registry.isVerified(alice.address)).to.equal(false);
    await registry.connect(operator).update(alice.address, 1, id("k2"), expiry);
    expect(await registry.isVerified(alice.address)).to.equal(false);
    await expect(registry.connect(operator).reinstate(alice.address)).to.emit(registry, "IdentityReinstated");
    expect(await registry.isVerified(alice.address)).to.equal(true);
  });

  it("revoke/reinstate validate state", async () => {
    const { registry, operator, alice, carol } = await loadFixture(deploySystem);
    await expect(registry.connect(operator).revoke(carol.address)).to.be.revertedWithCustomError(registry, "NotRegistered");
    await expect(registry.connect(operator).reinstate(carol.address)).to.be.revertedWithCustomError(
      registry,
      "NotRegistered",
    );
    await expect(registry.connect(operator).reinstate(alice.address))
      .to.be.revertedWithCustomError(registry, "NotRevoked")
      .withArgs(alice.address);
  });

  it("constructor rejects zero addresses", async () => {
    const [a] = await ethers.getSigners();
    const F = await ethers.getContractFactory("IdentityRegistry");
    await expect(F.deploy(ethers.ZeroAddress, a.address)).to.be.revertedWithCustomError(F, "ZeroAddress");
    await expect(F.deploy(a.address, ethers.ZeroAddress)).to.be.revertedWithCustomError(F, "ZeroAddress");
  });

  it("admin can grant the registrar role to a new operator key (key rotation)", async () => {
    const { registry, admin, outsider, carol, expiry } = await loadFixture(deploySystem);
    await registry.connect(admin).grantRole(await registry.REGISTRAR_ROLE(), outsider.address);
    await expect(registry.connect(outsider).register(carol.address, id("o"), 1, id("k"), expiry)).to.not.be.reverted;
  });
});
