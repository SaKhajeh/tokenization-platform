import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { deployWithSeries, id, YEAR } from "./fixtures";

/**
 * Randomised operation sequences (deterministic seed) checking the invariants from the PRD:
 *   1. totalSupply <= maxSupply, always
 *   2. sum of balances == totalSupply, always
 *   3. no unverified address ever holds units
 *   4. while transfers are disabled, only mint/burn/forcedTransfer change balances
 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("Invariants (randomised)", () => {
  for (const seed of [1, 7, 42, 1405]) {
    it(`holds across 120 random operations (seed ${seed})`, async () => {
      const { token, admin, operator, registry, alice, bob, carol } = await loadFixture(deployWithSeries);
      const rand = rng(seed);
      const holders = [alice, bob, carol];
      const max = await token.maxSupply();
      let transfersOn = false;

      // carol becomes verified half way through some runs
      for (let step = 0; step < 120; step++) {
        const op = Math.floor(rand() * 7);
        const a = holders[Math.floor(rand() * holders.length)];
        const b = holders[Math.floor(rand() * holders.length)];
        const amt = BigInt(1 + Math.floor(rand() * 900));
        try {
          if (op === 0) await token.connect(operator).mint(a.address, amt);
          else if (op === 1) await token.connect(operator).burn(a.address, amt);
          else if (op === 2) await token.connect(a).transfer(b.address, amt);
          else if (op === 3) await token.connect(admin).forcedTransfer(a.address, b.address, amt, id(`r${step}`));
          else if (op === 4) await token.connect(operator)[rand() < 0.5 ? "freeze" : "unfreeze"](a.address);
          else if (op === 5) {
            transfersOn = !transfersOn;
            await token.connect(admin).setTransfersEnabled(transfersOn);
          } else if (op === 6 && !(await registry.isVerified(carol.address))) {
            const exists = (await registry.identityOf(carol.address)).exists;
            if (!exists)
              await registry
                .connect(operator)
                .register(carol.address, id("org-c"), 1, id("kyb-c"), BigInt((await time.latest()) + YEAR));
          }
        } catch {
          // reverts are expected for many random ops; invariants must hold regardless
        }

        const supply = await token.totalSupply();
        let sum = 0n;
        for (const h of holders) {
          const bal = await token.balanceOf(h.address);
          sum += bal;
          if (bal > 0n) expect(await registry.isVerified(h.address)).to.equal(true);
        }
        expect(supply <= max).to.equal(true);
        expect(sum).to.equal(supply);
      }
    });
  }

  it("an unverified address cannot end up holding units through any path", async () => {
    const { token, admin, operator, alice, carol } = await loadFixture(deployWithSeries);
    await token.connect(operator).mint(alice.address, 10n);
    await token.connect(admin).setTransfersEnabled(true);
    await expect(token.connect(operator).mint(carol.address, 1n)).to.be.reverted;
    await expect(token.connect(alice).transfer(carol.address, 1n)).to.be.reverted;
    await expect(token.connect(admin).forcedTransfer(alice.address, carol.address, 1n, id("x"))).to.be.reverted;
    expect(await token.balanceOf(carol.address)).to.equal(0n);
    expect(await ethers.provider.getCode(carol.address)).to.equal("0x");
  });
});
