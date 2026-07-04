const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("CeloFlashTournament", function () {
  let tournament;
  let mockUSDm;
  let owner, verifier, feeRecipient, player1, player2, player3, player4;

  const ENTRY_FEE = ethers.parseEther("0.30"); // 0.30 USDm
  const SEED_AMOUNT = ethers.parseEther("10"); // 10 USDm seed
  const DURATION = 24 * 60 * 60; // 24 hours
  const INITIAL_BALANCE = ethers.parseEther("1000");

  // Helper: sign a score attestation
  async function signScore(signer, tournamentId, player, score, nonce) {
    const messageHash = ethers.solidityPackedKeccak256(
      ["uint256", "address", "uint256", "bytes32"],
      [tournamentId, player, score, nonce]
    );
    return await signer.signMessage(ethers.getBytes(messageHash));
  }

  beforeEach(async function () {
    [owner, verifier, feeRecipient, player1, player2, player3, player4] =
      await ethers.getSigners();

    // Deploy mock USDm token
    const MockToken = await ethers.getContractFactory("MockERC20");
    mockUSDm = await MockToken.deploy("Mock USDm", "USDm", 18);
    await mockUSDm.waitForDeployment();

    // Deploy tournament contract
    const Tournament = await ethers.getContractFactory("CeloFlashTournament");
    tournament = await Tournament.deploy(
      await mockUSDm.getAddress(),
      verifier.address,
      feeRecipient.address
    );
    await tournament.waitForDeployment();

    // Distribute tokens and set approvals
    for (const player of [owner, player1, player2, player3, player4]) {
      await mockUSDm.mint(player.address, INITIAL_BALANCE);
      await mockUSDm
        .connect(player)
        .approve(await tournament.getAddress(), ethers.MaxUint256);
    }
  });

  describe("Deployment", function () {
    it("should set correct initial values", async function () {
      expect(await tournament.stablecoin()).to.equal(
        await mockUSDm.getAddress()
      );
      expect(await tournament.scoreVerifier()).to.equal(verifier.address);
      expect(await tournament.feeRecipient()).to.equal(feeRecipient.address);
      expect(await tournament.nextTournamentId()).to.equal(0);
    });

    it("should revert on zero addresses", async function () {
      const Tournament = await ethers.getContractFactory("CeloFlashTournament");
      await expect(
        Tournament.deploy(ethers.ZeroAddress, verifier.address, feeRecipient.address)
      ).to.be.revertedWithCustomError(tournament, "InvalidAddress");

      await expect(
        Tournament.deploy(await mockUSDm.getAddress(), ethers.ZeroAddress, feeRecipient.address)
      ).to.be.revertedWithCustomError(tournament, "InvalidAddress");

      await expect(
        Tournament.deploy(await mockUSDm.getAddress(), verifier.address, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(tournament, "InvalidAddress");
    });
  });

  describe("Create Tournament", function () {
    it("should create a tournament with seed amount", async function () {
      const tx = await tournament.createTournament(
        "UNDERDOGS WILL RISE 🔥",
        ENTRY_FEE,
        SEED_AMOUNT,
        DURATION
      );

      const receipt = await tx.wait();
      expect(await tournament.nextTournamentId()).to.equal(1);

      const t = await tournament.getTournament(0);
      expect(t.name).to.equal("UNDERDOGS WILL RISE 🔥");
      expect(t.entryFee).to.equal(ENTRY_FEE);
      expect(t.seedAmount).to.equal(SEED_AMOUNT);
      expect(t.prizePool).to.equal(SEED_AMOUNT);
      expect(t.status).to.equal(0); // Active
    });

    it("should create a free tournament (no entry fee, no seed)", async function () {
      await tournament.createTournament("Daily Free Cup", 0, 0, DURATION);
      const t = await tournament.getTournament(0);
      expect(t.entryFee).to.equal(0);
      expect(t.prizePool).to.equal(0);
    });

    it("should transfer seed amount from creator", async function () {
      const balBefore = await mockUSDm.balanceOf(owner.address);
      await tournament.createTournament("Test", ENTRY_FEE, SEED_AMOUNT, DURATION);
      const balAfter = await mockUSDm.balanceOf(owner.address);
      expect(balBefore - balAfter).to.equal(SEED_AMOUNT);
    });

    it("should revert on empty name", async function () {
      await expect(
        tournament.createTournament("", ENTRY_FEE, 0, DURATION)
      ).to.be.revertedWithCustomError(tournament, "EmptyName");
    });

    it("should revert on excessive entry fee", async function () {
      await expect(
        tournament.createTournament("Test", ethers.parseEther("101"), 0, DURATION)
      ).to.be.revertedWithCustomError(tournament, "InvalidEntryFee");
    });

    it("should revert on invalid duration", async function () {
      await expect(
        tournament.createTournament("Test", ENTRY_FEE, 0, 60) // 1 minute
      ).to.be.revertedWithCustomError(tournament, "InvalidDuration");

      await expect(
        tournament.createTournament("Test", ENTRY_FEE, 0, 8 * 24 * 60 * 60) // 8 days
      ).to.be.revertedWithCustomError(tournament, "InvalidDuration");
    });

    it("should emit TournamentCreated event", async function () {
      await expect(
        tournament.createTournament("Test Cup", ENTRY_FEE, SEED_AMOUNT, DURATION)
      ).to.emit(tournament, "TournamentCreated");
    });
  });

  describe("Join Tournament", function () {
    beforeEach(async function () {
      await tournament.createTournament("Test Cup", ENTRY_FEE, SEED_AMOUNT, DURATION);
    });

    it("should allow a player to join", async function () {
      await tournament.connect(player1).joinTournament(0);
      expect(await tournament.hasJoined(0, player1.address)).to.be.true;

      const t = await tournament.getTournament(0);
      expect(t.participantCount).to.equal(1);
    });

    it("should deduct entry fee and add to prize pool (minus protocol fee)", async function () {
      const balBefore = await mockUSDm.balanceOf(player1.address);
      await tournament.connect(player1).joinTournament(0);
      const balAfter = await mockUSDm.balanceOf(player1.address);

      expect(balBefore - balAfter).to.equal(ENTRY_FEE);

      // Prize pool should increase by entry - 5% fee
      const expectedProtocolFee = (ENTRY_FEE * 500n) / 10000n;
      const expectedPrizeAdd = ENTRY_FEE - expectedProtocolFee;

      const t = await tournament.getTournament(0);
      expect(t.prizePool).to.equal(SEED_AMOUNT + expectedPrizeAdd);
      expect(await tournament.accumulatedFees()).to.equal(expectedProtocolFee);
    });

    it("should revert if already joined", async function () {
      await tournament.connect(player1).joinTournament(0);
      await expect(
        tournament.connect(player1).joinTournament(0)
      ).to.be.revertedWithCustomError(tournament, "AlreadyJoined");
    });

    it("should revert if tournament ended", async function () {
      await time.increase(DURATION + 1);
      await expect(
        tournament.connect(player1).joinTournament(0)
      ).to.be.revertedWithCustomError(tournament, "TournamentNotActive");
    });

    it("should allow joining free tournaments", async function () {
      await tournament.createTournament("Free Cup", 0, 0, DURATION);
      const balBefore = await mockUSDm.balanceOf(player1.address);
      await tournament.connect(player1).joinTournament(1);
      const balAfter = await mockUSDm.balanceOf(player1.address);
      expect(balAfter).to.equal(balBefore); // No tokens taken
    });
  });

  describe("Submit Score", function () {
    beforeEach(async function () {
      await tournament.createTournament("Test Cup", ENTRY_FEE, SEED_AMOUNT, DURATION);
      await tournament.connect(player1).joinTournament(0);
      await tournament.connect(player2).joinTournament(0);
    });

    it("should accept a valid server-signed score", async function () {
      const nonce = ethers.id("nonce-1");
      const score = 12450;
      const sig = await signScore(verifier, 0, player1.address, score, nonce);

      await expect(tournament.connect(player1).submitScore(0, score, nonce, sig))
        .to.emit(tournament, "ScoreSubmitted")
        .withArgs(0, player1.address, score);

      expect(await tournament.playerBestScore(0, player1.address)).to.equal(score);
    });

    it("should update leaderboard on better score", async function () {
      const nonce1 = ethers.id("nonce-1");
      const nonce2 = ethers.id("nonce-2");

      const sig1 = await signScore(verifier, 0, player1.address, 5000, nonce1);
      await tournament.connect(player1).submitScore(0, 5000, nonce1, sig1);

      const sig2 = await signScore(verifier, 0, player1.address, 15000, nonce2);
      await tournament.connect(player1).submitScore(0, 15000, nonce2, sig2);

      expect(await tournament.playerBestScore(0, player1.address)).to.equal(15000);
    });

    it("should not update if score is lower", async function () {
      const nonce1 = ethers.id("nonce-1");
      const nonce2 = ethers.id("nonce-2");

      const sig1 = await signScore(verifier, 0, player1.address, 15000, nonce1);
      await tournament.connect(player1).submitScore(0, 15000, nonce1, sig1);

      const sig2 = await signScore(verifier, 0, player1.address, 5000, nonce2);
      await tournament.connect(player1).submitScore(0, 5000, nonce2, sig2);

      expect(await tournament.playerBestScore(0, player1.address)).to.equal(15000);
    });

    it("should revert on invalid signature", async function () {
      const nonce = ethers.id("nonce-bad");
      // Sign with wrong signer
      const badSig = await signScore(player2, 0, player1.address, 5000, nonce);

      await expect(
        tournament.connect(player1).submitScore(0, 5000, nonce, badSig)
      ).to.be.revertedWithCustomError(tournament, "InvalidSignature");
    });

    it("should revert on nonce reuse", async function () {
      const nonce = ethers.id("nonce-reuse");
      const sig = await signScore(verifier, 0, player1.address, 5000, nonce);
      await tournament.connect(player1).submitScore(0, 5000, nonce, sig);

      const sig2 = await signScore(verifier, 0, player1.address, 10000, nonce);
      await expect(
        tournament.connect(player1).submitScore(0, 10000, nonce, sig2)
      ).to.be.revertedWithCustomError(tournament, "NonceAlreadyUsed");
    });

    it("should revert if player hasn't joined", async function () {
      const nonce = ethers.id("nonce-notjoined");
      const sig = await signScore(verifier, 0, player3.address, 5000, nonce);

      await expect(
        tournament.connect(player3).submitScore(0, 5000, nonce, sig)
      ).to.be.revertedWithCustomError(tournament, "TournamentNotActive");
    });

    it("should sort leaderboard correctly", async function () {
      // Player1 scores 12000
      const n1 = ethers.id("n1");
      const s1 = await signScore(verifier, 0, player1.address, 12000, n1);
      await tournament.connect(player1).submitScore(0, 12000, n1, s1);

      // Player2 scores 15000
      const n2 = ethers.id("n2");
      const s2 = await signScore(verifier, 0, player2.address, 15000, n2);
      await tournament.connect(player2).submitScore(0, 15000, n2, s2);

      const lb = await tournament.getLeaderboard(0);
      expect(lb.length).to.equal(2);
      expect(lb[0].player).to.equal(player2.address); // Higher score first
      expect(lb[0].score).to.equal(15000);
      expect(lb[1].player).to.equal(player1.address);
      expect(lb[1].score).to.equal(12000);
    });
  });

  describe("Finalize Tournament", function () {
    beforeEach(async function () {
      await tournament.createTournament("Test Cup", ENTRY_FEE, SEED_AMOUNT, DURATION);
      await tournament.connect(player1).joinTournament(0);
      await tournament.connect(player2).joinTournament(0);
      await tournament.connect(player3).joinTournament(0);

      // Submit scores
      const n1 = ethers.id("f-n1");
      const s1 = await signScore(verifier, 0, player1.address, 15000, n1);
      await tournament.connect(player1).submitScore(0, 15000, n1, s1);

      const n2 = ethers.id("f-n2");
      const s2 = await signScore(verifier, 0, player2.address, 12000, n2);
      await tournament.connect(player2).submitScore(0, 12000, n2, s2);

      const n3 = ethers.id("f-n3");
      const s3 = await signScore(verifier, 0, player3.address, 8000, n3);
      await tournament.connect(player3).submitScore(0, 8000, n3, s3);
    });

    it("should revert if tournament has not ended", async function () {
      await expect(
        tournament.finalizeTournament(0)
      ).to.be.revertedWithCustomError(tournament, "TournamentNotEnded");
    });

    it("should finalize and distribute prizes correctly", async function () {
      await time.increase(DURATION + 1);
      await tournament.finalizeTournament(0);

      const t = await tournament.getTournament(0);
      expect(t.status).to.equal(1); // Finalized
      expect(t.winner).to.equal(player1.address);
      expect(t.winningScore).to.equal(15000);

      const pool = t.prizePool;
      // 1st: 60%, 2nd: 25%, 3rd: 15%
      const first = (pool * 6000n) / 10000n;
      const second = (pool * 2500n) / 10000n;
      const third = (pool * 1500n) / 10000n;
      const dust = pool - first - second - third;

      expect(await tournament.claimablePrize(0, player1.address)).to.equal(first + dust);
      expect(await tournament.claimablePrize(0, player2.address)).to.equal(second);
      expect(await tournament.claimablePrize(0, player3.address)).to.equal(third);
    });

    it("should emit TournamentFinalized event", async function () {
      await time.increase(DURATION + 1);
      await expect(tournament.finalizeTournament(0)).to.emit(
        tournament,
        "TournamentFinalized"
      );
    });

    it("should revert on double finalization", async function () {
      await time.increase(DURATION + 1);
      await tournament.finalizeTournament(0);
      await expect(
        tournament.finalizeTournament(0)
      ).to.be.revertedWithCustomError(tournament, "TournamentAlreadyFinalized");
    });
  });

  describe("Claim Prize", function () {
    beforeEach(async function () {
      await tournament.createTournament("Test Cup", ENTRY_FEE, SEED_AMOUNT, DURATION);
      await tournament.connect(player1).joinTournament(0);

      const n1 = ethers.id("claim-n1");
      const s1 = await signScore(verifier, 0, player1.address, 10000, n1);
      await tournament.connect(player1).submitScore(0, 10000, n1, s1);

      await time.increase(DURATION + 1);
      await tournament.finalizeTournament(0);
    });

    it("should allow winner to claim prize", async function () {
      const balBefore = await mockUSDm.balanceOf(player1.address);
      const claimable = await tournament.claimablePrize(0, player1.address);

      await tournament.connect(player1).claimPrize(0);

      const balAfter = await mockUSDm.balanceOf(player1.address);
      expect(balAfter - balBefore).to.equal(claimable);
      expect(await tournament.claimablePrize(0, player1.address)).to.equal(0);
    });

    it("should revert on double claim", async function () {
      await tournament.connect(player1).claimPrize(0);
      await expect(
        tournament.connect(player1).claimPrize(0)
      ).to.be.revertedWithCustomError(tournament, "NoPrizeToClaim");
    });

    it("should revert if no prize to claim", async function () {
      await expect(
        tournament.connect(player2).claimPrize(0)
      ).to.be.revertedWithCustomError(tournament, "NoPrizeToClaim");
    });
  });

  describe("Cancel Tournament", function () {
    beforeEach(async function () {
      await tournament.createTournament("Cancel Test", ENTRY_FEE, SEED_AMOUNT, DURATION);
      await tournament.connect(player1).joinTournament(0);
    });

    it("should allow creator to cancel", async function () {
      await tournament.cancelTournament(0);
      const t = await tournament.getTournament(0);
      expect(t.status).to.equal(2); // Cancelled
    });

    it("should allow owner to cancel", async function () {
      // Create from player1
      await tournament
        .connect(player1)
        .createTournament("P1 Tournament", 0, 0, DURATION);
      await tournament.cancelTournament(1); // owner cancels
      const t = await tournament.getTournament(1);
      expect(t.status).to.equal(2);
    });

    it("should refund seed to creator", async function () {
      const balBefore = await mockUSDm.balanceOf(owner.address);
      await tournament.cancelTournament(0);
      const balAfter = await mockUSDm.balanceOf(owner.address);
      expect(balAfter - balBefore).to.equal(SEED_AMOUNT);
    });

    it("should allow players to claim refund after cancellation", async function () {
      await tournament.cancelTournament(0);
      const balBefore = await mockUSDm.balanceOf(player1.address);
      await tournament.connect(player1).claimPrize(0);
      const balAfter = await mockUSDm.balanceOf(player1.address);
      expect(balAfter - balBefore).to.equal(ENTRY_FEE);
    });

    it("should revert if non-creator/non-owner tries to cancel", async function () {
      await expect(
        tournament.connect(player2).cancelTournament(0)
      ).to.be.revertedWithCustomError(tournament, "InvalidAddress");
    });
  });

  describe("Admin Functions", function () {
    it("should update score verifier", async function () {
      await tournament.setScoreVerifier(player1.address);
      expect(await tournament.scoreVerifier()).to.equal(player1.address);
    });

    it("should update fee recipient", async function () {
      await tournament.setFeeRecipient(player1.address);
      expect(await tournament.feeRecipient()).to.equal(player1.address);
    });

    it("should withdraw accumulated fees", async function () {
      await tournament.createTournament("Fee Test", ENTRY_FEE, 0, DURATION);
      await tournament.connect(player1).joinTournament(0);

      const fees = await tournament.accumulatedFees();
      expect(fees).to.be.gt(0);

      const balBefore = await mockUSDm.balanceOf(feeRecipient.address);
      await tournament.withdrawFees();
      const balAfter = await mockUSDm.balanceOf(feeRecipient.address);
      expect(balAfter - balBefore).to.equal(fees);
    });

    it("should pause and unpause", async function () {
      await tournament.pause();
      await expect(
        tournament.createTournament("Paused", 0, 0, DURATION)
      ).to.be.revertedWithCustomError(tournament, "EnforcedPause");

      await tournament.unpause();
      await tournament.createTournament("Unpaused", 0, 0, DURATION);
    });
  });
});
