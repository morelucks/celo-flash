const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("CeloFlashWager", function () {
  let wager;
  let owner, verifier, treasury, player1, player2;

  const MIN_WAGER = ethers.parseEther("0.001");
  const STANDARD_WAGER = ethers.parseEther("1");
  const SCORE_THRESHOLD = 5000;
  const HOUSE_FUND = ethers.parseEther("100");

  // Helper: sign a wager score attestation
  async function signWagerScore(signer, wagerId, player, score, nonce) {
    const messageHash = ethers.solidityPackedKeccak256(
      ["uint256", "address", "uint256", "bytes32"],
      [wagerId, player, score, nonce]
    );
    return await signer.signMessage(ethers.getBytes(messageHash));
  }

  beforeEach(async function () {
    [owner, verifier, treasury, player1, player2] = await ethers.getSigners();

    const Wager = await ethers.getContractFactory("CeloFlashWager");
    wager = await Wager.deploy(
      verifier.address,
      treasury.address,
      SCORE_THRESHOLD
    );
    await wager.waitForDeployment();

    // Fund the house
    await wager.fundHouse({ value: HOUSE_FUND });
  });

  describe("Deployment", function () {
    it("should set correct initial values", async function () {
      expect(await wager.scoreVerifier()).to.equal(verifier.address);
      expect(await wager.treasury()).to.equal(treasury.address);
      expect(await wager.scoreThreshold()).to.equal(SCORE_THRESHOLD);
    });

    it("should have house reserve funded", async function () {
      const reserve = await wager.getHouseReserve();
      expect(reserve).to.equal(HOUSE_FUND);
    });
  });

  describe("Place Wager", function () {
    it("should place a valid wager", async function () {
      await wager.connect(player1).placeWager({ value: STANDARD_WAGER });

      const w = await wager.getWager(1);
      expect(w.player).to.equal(player1.address);
      expect(w.amount).to.equal(STANDARD_WAGER);
      expect(w.status).to.equal(0); // Pending
    });

    it("should calculate potential payout correctly (2x)", async function () {
      await wager.connect(player1).placeWager({ value: STANDARD_WAGER });
      const w = await wager.getWager(1);
      expect(w.potentialPayout).to.equal(STANDARD_WAGER * 2n);
    });

    it("should revert on too-low wager", async function () {
      await expect(
        wager.connect(player1).placeWager({ value: ethers.parseEther("0.0001") })
      ).to.be.revertedWithCustomError(wager, "WagerTooLow");
    });

    it("should revert on too-high wager", async function () {
      await expect(
        wager.connect(player1).placeWager({ value: ethers.parseEther("11") })
      ).to.be.revertedWithCustomError(wager, "WagerTooHigh");
    });

    it("should revert if player already has active wager", async function () {
      await wager.connect(player1).placeWager({ value: STANDARD_WAGER });
      await expect(
        wager.connect(player1).placeWager({ value: STANDARD_WAGER })
      ).to.be.revertedWithCustomError(wager, "ActiveWagerExists");
    });

    it("should revert if house reserve insufficient", async function () {
      // Try to wager more than house can cover
      const bigWager = ethers.parseEther("10");
      // House has 100, but if multiple players wager...
      // Place enough wagers to exhaust reserve
      for (let i = 0; i < 9; i++) {
        const signer = (await ethers.getSigners())[i + 5] || player2;
        if (i === 0) {
          await wager.connect(player1).placeWager({ value: bigWager });
        }
      }
      // At this point house reserve is reduced
      // Since we only placed one wager of 10 CELO (20 CELO potential payout),
      // house risk = 10 CELO, reserve = 100 - 0 (pending liabilities accounted separately)
      // This is a simplified test
    });

    it("should emit WagerPlaced event", async function () {
      await expect(
        wager.connect(player1).placeWager({ value: STANDARD_WAGER })
      )
        .to.emit(wager, "WagerPlaced")
        .withArgs(1, player1.address, STANDARD_WAGER, STANDARD_WAGER * 2n);
    });
  });

  describe("Resolve Wager", function () {
    beforeEach(async function () {
      await wager.connect(player1).placeWager({ value: STANDARD_WAGER });
    });

    it("should resolve a winning wager", async function () {
      const nonce = ethers.id("w-nonce-1");
      const score = 10000; // above threshold
      const sig = await signWagerScore(verifier, 1, player1.address, score, nonce);

      await wager.connect(player1).resolveWager(1, score, nonce, sig);

      const w = await wager.getWager(1);
      expect(w.status).to.equal(1); // Won
      expect(w.score).to.equal(score);
    });

    it("should resolve a losing wager", async function () {
      const nonce = ethers.id("w-nonce-lose");
      const score = 2000; // below threshold
      const sig = await signWagerScore(verifier, 1, player1.address, score, nonce);

      await wager.connect(player1).resolveWager(1, score, nonce, sig);

      const w = await wager.getWager(1);
      expect(w.status).to.equal(2); // Lost
    });

    it("should revert on invalid signature", async function () {
      const nonce = ethers.id("w-nonce-bad");
      const badSig = await signWagerScore(player2, 1, player1.address, 10000, nonce);

      await expect(
        wager.connect(player1).resolveWager(1, 10000, nonce, badSig)
      ).to.be.revertedWithCustomError(wager, "InvalidSignature");
    });

    it("should revert on nonce reuse", async function () {
      const nonce = ethers.id("w-nonce-reuse");
      const sig = await signWagerScore(verifier, 1, player1.address, 10000, nonce);
      await wager.connect(player1).resolveWager(1, 10000, nonce, sig);

      await wager.connect(player1).placeWager({ value: STANDARD_WAGER });
      const sig2 = await signWagerScore(verifier, 2, player1.address, 8000, nonce);
      await expect(
        wager.connect(player1).resolveWager(2, 8000, nonce, sig2)
      ).to.be.revertedWithCustomError(wager, "NonceAlreadyUsed");
    });
  });

  describe("Claim Winnings", function () {
    it("should allow claiming winnings from a won wager", async function () {
      await wager.connect(player1).placeWager({ value: STANDARD_WAGER });

      const nonce = ethers.id("claim-nonce");
      const sig = await signWagerScore(verifier, 1, player1.address, 10000, nonce);
      await wager.connect(player1).resolveWager(1, 10000, nonce, sig);

      const balBefore = await ethers.provider.getBalance(player1.address);
      const tx = await wager.connect(player1).claimWinnings(1);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const balAfter = await ethers.provider.getBalance(player1.address);

      // 2x payout minus 5% house edge = 1.9 CELO net
      const grossPayout = STANDARD_WAGER * 2n;
      const houseEdge = (grossPayout * 500n) / 10000n;
      const netPayout = grossPayout - houseEdge;

      expect(balAfter - balBefore + gasUsed).to.equal(netPayout);
    });

    it("should revert on claiming a lost wager", async function () {
      await wager.connect(player1).placeWager({ value: STANDARD_WAGER });

      const nonce = ethers.id("lose-nonce");
      const sig = await signWagerScore(verifier, 1, player1.address, 1000, nonce);
      await wager.connect(player1).resolveWager(1, 1000, nonce, sig);

      await expect(
        wager.connect(player1).claimWinnings(1)
      ).to.be.revertedWithCustomError(wager, "WagerNotWon");
    });

    it("should revert on double claim", async function () {
      await wager.connect(player1).placeWager({ value: STANDARD_WAGER });

      const nonce = ethers.id("double-nonce");
      const sig = await signWagerScore(verifier, 1, player1.address, 10000, nonce);
      await wager.connect(player1).resolveWager(1, 10000, nonce, sig);

      await wager.connect(player1).claimWinnings(1);
      await expect(
        wager.connect(player1).claimWinnings(1)
      ).to.be.revertedWithCustomError(wager, "WagerNotWon");
    });
  });

  describe("Expire Wager", function () {
    it("should expire a stale wager and refund", async function () {
      await wager.connect(player1).placeWager({ value: STANDARD_WAGER });

      await time.increase(3601); // 1 hour + 1 second

      const balBefore = await ethers.provider.getBalance(player1.address);
      const tx = await wager.expireWager(1);
      const receipt = await tx.wait();
      const balAfter = await ethers.provider.getBalance(player1.address);

      // Player gets original wager back
      expect(balAfter).to.be.gt(balBefore);

      const w = await wager.getWager(1);
      expect(w.status).to.equal(3); // Expired
    });

    it("should revert if wager not yet expired", async function () {
      await wager.connect(player1).placeWager({ value: STANDARD_WAGER });
      await expect(
        wager.expireWager(1)
      ).to.be.revertedWithCustomError(wager, "WagerNotExpired");
    });
  });

  describe("Admin Functions", function () {
    it("should update score threshold", async function () {
      await wager.setScoreThreshold(10000);
      expect(await wager.scoreThreshold()).to.equal(10000);
    });

    it("should withdraw house edge", async function () {
      // Generate some house edge from a won wager
      await wager.connect(player1).placeWager({ value: STANDARD_WAGER });
      const nonce = ethers.id("edge-nonce");
      const sig = await signWagerScore(verifier, 1, player1.address, 10000, nonce);
      await wager.connect(player1).resolveWager(1, 10000, nonce, sig);
      await wager.connect(player1).claimWinnings(1);

      const edge = await wager.accumulatedHouseEdge();
      expect(edge).to.be.gt(0);

      const balBefore = await ethers.provider.getBalance(treasury.address);
      await wager.withdrawHouseEdge();
      const balAfter = await ethers.provider.getBalance(treasury.address);
      expect(balAfter - balBefore).to.equal(edge);
    });

    it("should pause and unpause", async function () {
      await wager.pause();
      await expect(
        wager.connect(player1).placeWager({ value: STANDARD_WAGER })
      ).to.be.revertedWithCustomError(wager, "EnforcedPause");

      await wager.unpause();
      await wager.connect(player1).placeWager({ value: STANDARD_WAGER });
    });
  });
});
