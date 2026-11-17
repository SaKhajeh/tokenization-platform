import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { deployWithSeries, id, YEAR, DAY } from "./fixtures";

describe("SeriesToken", () => {
  describe("mint (issuance)", () => {
    it("mints whole units to a verified holder", async () => {
      const { token, operator, alice } = await loadFixture(deployWithSeries);
      await expect(token.connect(operator).mint(alice.address, 10n))
        .to.emit(token, "Transfer")
        .withArgs(ethers.ZeroAddress, alice.address, 10n);
      expect(await token.balanceOf(alice.address)).to.equal(10n);
      expect(await token.totalSupply()).to.equal(10n);
    });

    it("refuses unverified, revoked or expired recipients", async () => {
      const { token, operator, registry, alice, carol } = await loadFixture(deployWithSeries);
      await expect(token.connect(operator).mint(carol.address, 1n))
        .to.be.revertedWithCustomError(token, "RecipientNotVerified")
        .withArgs(carol.address);
      await registry.connect(operator).revoke(alice.address);
      await expect(token.connect(operator).mint(alice.address, 1n)).to.be.revertedWithCustomError(
        token,
        "RecipientNotVerified",
      );
      await registry.connect(operator).reinstate(alice.address);
      await time.increase(YEAR + DAY);
      await expect(token.connect(operator).mint(alice.address, 1n)).to.be.revertedWithCustomError(
        token,
        "RecipientNotVerified",
      );
    });

    it("never exceeds maxSupply", async () => {
      const { token, operator, alice, bob } = await loadFixture(deployWithSeries);
      await token.connect(operator).mint(alice.address, 4_000n);
      await expect(token.connect(operator).mint(bob.address, 1_001n))
        .to.be.revertedWithCustomError(token, "MaxSupplyExceeded")
        .withArgs(1_001n, 1_000n);
      await token.connect(operator).mint(bob.address, 1_000n);
      expect(await token.totalSupply()).to.equal(5_000n);
    });

    it("refuses frozen recipients", async () => {
      const { token, operator, alice } = await loadFixture(deployWithSeries);
      await token.connect(operator).freeze(alice.address);
      await expect(token.connect(operator).mint(alice.address, 1n))
        .to.be.revertedWithCustomError(token, "AccountFrozen")
        .withArgs(alice.address);
    });

    it("only the minter can mint", async () => {
      const { token, admin, outsider, alice } = await loadFixture(deployWithSeries);
      for (const s of [admin, outsider, alice]) {
        await expect(token.connect(s).mint(alice.address, 1n)).to.be.revertedWithCustomError(
          token,
          "AccessControlUnauthorizedAccount",
        );
      }
    });
  });

  describe("batch mint / burn", () => {
    it("mints and burns many holders in one transaction", async () => {
      const { token, operator, alice, bob } = await loadFixture(deployWithSeries);
      await token.connect(operator).mintBatch([alice.address, bob.address], [600n, 400n]);
      expect(await token.balanceOf(alice.address)).to.equal(600n);
      expect(await token.balanceOf(bob.address)).to.equal(400n);
      await token.connect(operator).burnBatch([alice.address, bob.address], [600n, 400n]);
      expect(await token.totalSupply()).to.equal(0n);
    });

    it("checks the whole batch against maxSupply before minting anything", async () => {
      const { token, operator, alice, bob } = await loadFixture(deployWithSeries);
      await expect(token.connect(operator).mintBatch([alice.address, bob.address], [4_000n, 1_001n]))
        .to.be.revertedWithCustomError(token, "MaxSupplyExceeded")
        .withArgs(5_001n, 5_000n);
      expect(await token.totalSupply()).to.equal(0n);
    });

    it("is atomic: one unverified recipient reverts the whole batch", async () => {
      const { token, operator, alice, carol } = await loadFixture(deployWithSeries);
      await expect(
        token.connect(operator).mintBatch([alice.address, carol.address], [1n, 1n]),
      ).to.be.revertedWithCustomError(token, "RecipientNotVerified");
      expect(await token.balanceOf(alice.address)).to.equal(0n);
    });

    it("rejects malformed batches and non-operators", async () => {
      const { token, operator, outsider, alice } = await loadFixture(deployWithSeries);
      await expect(token.connect(operator).mintBatch([alice.address], [1n, 2n])).to.be.revertedWithCustomError(token, "BadBatch");
      await expect(token.connect(operator).mintBatch([], [])).to.be.revertedWithCustomError(token, "BadBatch");
      await expect(token.connect(operator).burnBatch([alice.address], [])).to.be.revertedWithCustomError(token, "BadBatch");
      await expect(token.connect(operator).burnBatch([], [])).to.be.revertedWithCustomError(token, "BadBatch");
      const tooMany = Array(201).fill(alice.address);
      await expect(token.connect(operator).mintBatch(tooMany, Array(201).fill(1n))).to.be.revertedWithCustomError(token, "BadBatch");
      await expect(token.connect(operator).burnBatch(tooMany, Array(201).fill(1n))).to.be.revertedWithCustomError(token, "BadBatch");
      await expect(token.connect(outsider).mintBatch([alice.address], [1n])).to.be.revertedWithCustomError(
        token,
        "AccessControlUnauthorizedAccount",
      );
      await expect(token.connect(outsider).burnBatch([alice.address], [1n])).to.be.revertedWithCustomError(
        token,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("200 holders fit in one transaction", async () => {
      const { token, operator, registry, expiry } = await loadFixture(deployWithSeries);
      const wallets = Array.from({ length: 200 }, () => ethers.Wallet.createRandom().address);
      for (const [i, w] of wallets.entries()) await registry.connect(operator).register(w, id(`o${i}`), 1, id(`k${i}`), expiry);
      const tx = await token.connect(operator).mintBatch(wallets, Array(200).fill(25n));
      const rcpt = await tx.wait();
      expect(await token.totalSupply()).to.equal(5_000n);
      expect(rcpt!.gasUsed < 15_000_000n).to.equal(true);
    });
  });

  describe("transfers (secondary market switch)", () => {
    it("holder-to-holder transfers are locked by default", async () => {
      const { token, operator, alice, bob } = await loadFixture(deployWithSeries);
      await token.connect(operator).mint(alice.address, 10n);
      await expect(token.connect(alice).transfer(bob.address, 1n)).to.be.revertedWithCustomError(
        token,
        "TransfersDisabled",
      );
      await token.connect(alice).approve(bob.address, 5n);
      await expect(token.connect(bob).transferFrom(alice.address, bob.address, 1n)).to.be.revertedWithCustomError(
        token,
        "TransfersDisabled",
      );
    });

    it("when enabled, transfers go only to verified, non-frozen accounts", async () => {
      const { token, admin, operator, alice, bob, carol } = await loadFixture(deployWithSeries);
      await token.connect(operator).mint(alice.address, 10n);
      await expect(token.connect(admin).setTransfersEnabled(true))
        .to.emit(token, "TransfersEnabledSet")
        .withArgs(true);
      await token.connect(alice).transfer(bob.address, 3n);
      expect(await token.balanceOf(bob.address)).to.equal(3n);
      await expect(token.connect(alice).transfer(carol.address, 1n)).to.be.revertedWithCustomError(
        token,
        "RecipientNotVerified",
      );
      await token.connect(operator).freeze(alice.address);
      await expect(token.connect(alice).transfer(bob.address, 1n))
        .to.be.revertedWithCustomError(token, "AccountFrozen")
        .withArgs(alice.address);
      await token.connect(operator).unfreeze(alice.address);
      await token.connect(operator).freeze(bob.address);
      await expect(token.connect(alice).transfer(bob.address, 1n))
        .to.be.revertedWithCustomError(token, "AccountFrozen")
        .withArgs(bob.address);
    });

    it("only the multisig can switch transfers", async () => {
      const { token, operator, outsider } = await loadFixture(deployWithSeries);
      for (const s of [operator, outsider]) {
        await expect(token.connect(s).setTransfersEnabled(true)).to.be.revertedWithCustomError(
          token,
          "AccessControlUnauthorizedAccount",
        );
      }
    });
  });

  describe("burn (redemption)", () => {
    it("burner redeems units, including from a frozen holder", async () => {
      const { token, operator, alice } = await loadFixture(deployWithSeries);
      await token.connect(operator).mint(alice.address, 10n);
      await token.connect(operator).freeze(alice.address);
      await expect(token.connect(operator).burn(alice.address, 10n))
        .to.emit(token, "Transfer")
        .withArgs(alice.address, ethers.ZeroAddress, 10n);
      expect(await token.totalSupply()).to.equal(0n);
    });

    it("cannot burn more than the balance; only the burner may burn", async () => {
      const { token, operator, admin, alice } = await loadFixture(deployWithSeries);
      await token.connect(operator).mint(alice.address, 2n);
      await expect(token.connect(operator).burn(alice.address, 3n)).to.be.revertedWithCustomError(
        token,
        "ERC20InsufficientBalance",
      );
      await expect(token.connect(admin).burn(alice.address, 1n)).to.be.revertedWithCustomError(
        token,
        "AccessControlUnauthorizedAccount",
      );
      await expect(token.connect(alice).burn(alice.address, 1n)).to.be.revertedWithCustomError(
        token,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("freeze", () => {
    it("emits events and is restricted to the freezer", async () => {
      const { token, operator, outsider, alice } = await loadFixture(deployWithSeries);
      await expect(token.connect(operator).freeze(alice.address)).to.emit(token, "Frozen").withArgs(alice.address);
      expect(await token.frozen(alice.address)).to.equal(true);
      await expect(token.connect(operator).unfreeze(alice.address)).to.emit(token, "Unfrozen").withArgs(alice.address);
      await expect(token.connect(outsider).freeze(alice.address)).to.be.revertedWithCustomError(
        token,
        "AccessControlUnauthorizedAccount",
      );
      await expect(token.connect(outsider).unfreeze(alice.address)).to.be.revertedWithCustomError(
        token,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("forcedTransfer (legal correction)", () => {
    it("multisig can move units even while transfers are locked and the sender is frozen", async () => {
      const { token, admin, operator, alice, bob } = await loadFixture(deployWithSeries);
      await token.connect(operator).mint(alice.address, 10n);
      await token.connect(operator).freeze(alice.address);
      const reason = id("court-order-1405-118");
      await expect(token.connect(admin).forcedTransfer(alice.address, bob.address, 4n, reason))
        .to.emit(token, "ForcedTransfer")
        .withArgs(alice.address, bob.address, 4n, reason);
      expect(await token.balanceOf(bob.address)).to.equal(4n);
      // the forcing flag is cleared: a normal transfer is still locked afterwards
      await token.connect(operator).unfreeze(alice.address);
      await expect(token.connect(alice).transfer(bob.address, 1n)).to.be.revertedWithCustomError(
        token,
        "TransfersDisabled",
      );
    });

    it("still requires a verified, non-frozen receiver", async () => {
      const { token, admin, operator, alice, bob, carol } = await loadFixture(deployWithSeries);
      await token.connect(operator).mint(alice.address, 10n);
      await expect(
        token.connect(admin).forcedTransfer(alice.address, carol.address, 1n, id("r")),
      ).to.be.revertedWithCustomError(token, "RecipientNotVerified");
      await token.connect(operator).freeze(bob.address);
      await expect(
        token.connect(admin).forcedTransfer(alice.address, bob.address, 1n, id("r")),
      ).to.be.revertedWithCustomError(token, "AccountFrozen");
    });

    it("only the multisig can force a transfer", async () => {
      const { token, operator, alice, bob } = await loadFixture(deployWithSeries);
      await token.connect(operator).mint(alice.address, 10n);
      await expect(
        token.connect(operator).forcedTransfer(alice.address, bob.address, 1n, id("r")),
      ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    });
  });

  describe("pause (emergency)", () => {
    it("blocks mint, burn and transfers until unpaused; only the multisig controls it", async () => {
      const { token, admin, operator, alice } = await loadFixture(deployWithSeries);
      await token.connect(operator).mint(alice.address, 5n);
      await expect(token.connect(operator).pause()).to.be.revertedWithCustomError(
        token,
        "AccessControlUnauthorizedAccount",
      );
      await token.connect(admin).pause();
      await expect(token.connect(operator).mint(alice.address, 1n)).to.be.revertedWithCustomError(token, "EnforcedPause");
      await expect(token.connect(operator).burn(alice.address, 1n)).to.be.revertedWithCustomError(token, "EnforcedPause");
      await expect(token.connect(operator).unpause()).to.be.revertedWithCustomError(
        token,
        "AccessControlUnauthorizedAccount",
      );
      await token.connect(admin).unpause();
      await token.connect(operator).mint(alice.address, 1n);
      expect(await token.balanceOf(alice.address)).to.equal(6n);
    });
  });

  it("supports the AccessControl interface", async () => {
    const { token } = await loadFixture(deployWithSeries);
    expect(await token.supportsInterface("0x7965db0b")).to.equal(true); // IAccessControl
    expect(await token.supportsInterface("0xffffffff")).to.equal(false);
  });

  it("constructor rejects zero addresses", async () => {
    const { registry } = await loadFixture(deployWithSeries);
    const [a] = await ethers.getSigners();
    const F = await ethers.getContractFactory("SeriesToken");
    const m = BigInt((await time.latest()) + YEAR);
    const r = await registry.getAddress();
    const Z = ethers.ZeroAddress;
    await expect(F.deploy("n", "s", Z, id("s"), id("t"), m, 1n, a.address, a.address)).to.be.revertedWithCustomError(F, "ZeroAddress");
    await expect(F.deploy("n", "s", r, id("s"), id("t"), m, 1n, Z, a.address)).to.be.revertedWithCustomError(F, "ZeroAddress");
    await expect(F.deploy("n", "s", r, id("s"), id("t"), m, 1n, a.address, Z)).to.be.revertedWithCustomError(F, "ZeroAddress");
  });
});
