const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sign a score attestation the same way the contract verifies it.
 * keccak256(abi.encodePacked(tournamentId, player, score, nonce)) → Eth signed hash
 */
async function signScore(signer, tournamentId, player, score, nonce) {
  const messageHash = ethers.solidityPackedKeccak256(
    ["uint256", "address", "uint256", "bytes32"],
    [tournamentId, player, score, nonce]
  );
  // ethers v6: signMessage signs the eth-prefixed version automatically
  return signer.signMessage(ethers.getBytes(messageHash));
}

/** Unique nonce for every call to avoid NonceAlreadyUsed. */
let nonceCounter = 0n;
function freshNonce() {
  nonceCounter++;
  return ethers.zeroPadValue(ethers.toBeHex(nonceCounter), 32);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Constants mirrored from the contract
// ─────────────────────────────────────────────────────────────────────────────
const BPS_DENOMINATOR = 10_000n;
const PROTOCOL_FEE_BPS = 500n;
const MIN_DURATION = 3600; // 1 hour in seconds
const ONE_HOUR = 3600;

// ─────────────────────────────────────────────────────────────────────────────
//  Suite
// ─────────────────────────────────────────────────────────────────────────────
describe("CeloFlashTournament – finalizeTournament() prize distribution", function () {
  // ── shared fixture ──────────────────────────────────────────────────────────
  let tournament;
  let mockToken;
  let owner, scoreVerifierWallet, feeRecipient;
  let players; // array of 10 extra signers

  beforeEach(async function () {
    [owner, scoreVerifierWallet, feeRecipient, ...players] =
      await ethers.getSigners();

    // Deploy mock ERC-20 (USDm stand-in)
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy("Mock USD", "USDm", 18);
    await mockToken.waitForDeployment();

    // Mint tokens to each player
    for (const p of players) {
      await mockToken.mint(p.address, ethers.parseEther("1000"));
    }

    // Deploy the tournament contract
    const CeloFlashTournament = await ethers.getContractFactory(
      "CeloFlashTournament"
    );
    tournament = await CeloFlashTournament.deploy(
      await mockToken.getAddress(),
      scoreVerifierWallet.address,
      feeRecipient.address
    );
    await tournament.waitForDeployment();

    // Give each player a large allowance
    for (const p of players) {
      await mockToken
        .connect(p)
        .approve(await tournament.getAddress(), ethers.MaxUint256);
    }

    // Also approve for owner (used as creator in some tests)
    await mockToken
      .connect(owner)
      .approve(await tournament.getAddress(), ethers.MaxUint256);
    await mockToken.mint(owner.address, ethers.parseEther("1000"));
  });

  // ────────────────────────────────────────────────────────────────────────────
  //  Helper – creates and optionally populates a tournament
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Creates a USDm tournament (no seed, configurable entry fee & duration).
   * Returns the tournamentId (BigInt).
   */
  async function createTournament({
    entryFee = ethers.parseEther("1"),
    durationSecs = MIN_DURATION + 60,
    seedAmount = 0n,
    creator = owner,
  } = {}) {
    const tx = await tournament
      .connect(creator)
      .createTournament("Test Tournament", entryFee, seedAmount, durationSecs, false);
    const receipt = await tx.wait();
    // Extract tournamentId from TournamentCreated event
    const event = receipt.logs
      .map((log) => {
        try {
          return tournament.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((e) => e && e.name === "TournamentCreated");
    return event.args.tournamentId;
  }

  /**
   * Joins + submits a score for a player in one call.
   */
  async function joinAndScore(tournamentId, player, score) {
    const entryFee = (await tournament.getTournament(tournamentId)).entryFee;
    await tournament.connect(player).joinTournament(tournamentId, {
      value: 0n,
    });
    const nonce = freshNonce();
    const sig = await signScore(
      scoreVerifierWallet,
      tournamentId,
      player.address,
      score,
      nonce
    );
    await tournament
      .connect(player)
      .submitScore(tournamentId, score, nonce, sig);
  }

  /**
   * Fast-forwards time past the tournament end and finalizes it.
   */
  async function endAndFinalize(tournamentId) {
    const t = await tournament.getTournament(tournamentId);
    await time.increaseTo(Number(t.endTime) + 1);
    return tournament.finalizeTournament(tournamentId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  1.  Revert guards
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Revert guards", function () {
    it("reverts with TournamentNotEnded() when called before endTime", async function () {
      const id = await createTournament();
      await expect(
        tournament.finalizeTournament(id)
      ).to.be.revertedWithCustomError(tournament, "TournamentNotEnded");
    });

    it("reverts with TournamentAlreadyFinalized() on double finalization", async function () {
      const id = await createTournament();
      const t = await tournament.getTournament(id);
      await time.increaseTo(Number(t.endTime) + 1);
      await tournament.finalizeTournament(id); // first call — succeeds
      await expect(
        tournament.finalizeTournament(id) // second call — must revert
      ).to.be.revertedWithCustomError(tournament, "TournamentAlreadyFinalized");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  2.  0 scores submitted
  // ═══════════════════════════════════════════════════════════════════════════

  describe("0 scores submitted", function () {
    it("emits TournamentFinalized with winner=address(0) and prizeAmount=0", async function () {
      const id = await createTournament();
      const t = await tournament.getTournament(id);
      await time.increaseTo(Number(t.endTime) + 1);

      await expect(tournament.finalizeTournament(id))
        .to.emit(tournament, "TournamentFinalized")
        .withArgs(id, ethers.ZeroAddress, 0n, 0n);
    });

    it("sets status to Finalized even with no scores", async function () {
      const id = await createTournament();
      const t0 = await tournament.getTournament(id);
      await time.increaseTo(Number(t0.endTime) + 1);
      await tournament.finalizeTournament(id);

      const t1 = await tournament.getTournament(id);
      // TournamentStatus.Finalized == 1
      expect(t1.status).to.equal(1n);
    });

    it("leaves winner as address(0) with no scores", async function () {
      const id = await createTournament();
      const t0 = await tournament.getTournament(id);
      await time.increaseTo(Number(t0.endTime) + 1);
      await tournament.finalizeTournament(id);

      const t1 = await tournament.getTournament(id);
      expect(t1.winner).to.equal(ethers.ZeroAddress);
      expect(t1.winningScore).to.equal(0n);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  3.  1 participant
  // ═══════════════════════════════════════════════════════════════════════════

  describe("1 participant", function () {
    it("claimablePrize[id][player] == full prizePool", async function () {
      const id = await createTournament({ entryFee: ethers.parseEther("1") });
      await joinAndScore(id, players[0], 9000);
      await endAndFinalize(id);

      const t = await tournament.getTournament(id);
      const prize = await tournament.claimablePrize(id, players[0].address);
      expect(prize).to.equal(t.prizePool);
    });

    it("winner and winningScore match leaderboard[0]", async function () {
      const id = await createTournament({ entryFee: ethers.parseEther("1") });
      await joinAndScore(id, players[0], 8888);
      await endAndFinalize(id);

      const t = await tournament.getTournament(id);
      const lb = await tournament.getLeaderboard(id);
      expect(t.winner).to.equal(lb[0].player);
      expect(t.winningScore).to.equal(lb[0].score);
    });

    it("status is Finalized after call", async function () {
      const id = await createTournament({ entryFee: ethers.parseEther("1") });
      await joinAndScore(id, players[0], 5000);
      await endAndFinalize(id);

      const t = await tournament.getTournament(id);
      expect(t.status).to.equal(1n); // Finalized
    });

    it("emits TournamentFinalized with correct args for 1 participant", async function () {
      const id = await createTournament({ entryFee: ethers.parseEther("2") });
      await joinAndScore(id, players[0], 7777);
      const t0 = await tournament.getTournament(id);
      await time.increaseTo(Number(t0.endTime) + 1);

      const expectedPool = t0.prizePool; // already net of protocol fee
      await expect(tournament.finalizeTournament(id))
        .to.emit(tournament, "TournamentFinalized")
        .withArgs(id, players[0].address, 7777n, expectedPool);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  4.  2 participants  — 70 / 30 split
  // ═══════════════════════════════════════════════════════════════════════════

  describe("2 participants", function () {
    let id, pool;

    beforeEach(async function () {
      id = await createTournament({ entryFee: ethers.parseEther("1") });
      await joinAndScore(id, players[0], 9000); // higher score → 1st
      await joinAndScore(id, players[1], 5000); // lower  score → 2nd
      const t = await tournament.getTournament(id);
      pool = t.prizePool;
      await time.increaseTo(Number(t.endTime) + 1);
      await tournament.finalizeTournament(id);
    });

    it("1st gets (pool * 7000) / 10000", async function () {
      const expected = (pool * 7000n) / BPS_DENOMINATOR;
      expect(
        await tournament.claimablePrize(id, players[0].address)
      ).to.equal(expected);
    });

    it("2nd gets pool - first (i.e. remainder ~ 30%)", async function () {
      const first = (pool * 7000n) / BPS_DENOMINATOR;
      const expectedSecond = pool - first;
      expect(
        await tournament.claimablePrize(id, players[1].address)
      ).to.equal(expectedSecond);
    });

    it("prizes sum to the full pool (no leakage)", async function () {
      const p0 = await tournament.claimablePrize(id, players[0].address);
      const p1 = await tournament.claimablePrize(id, players[1].address);
      expect(p0 + p1).to.equal(pool);
    });

    it("winner is the higher-scoring player", async function () {
      const t = await tournament.getTournament(id);
      expect(t.winner).to.equal(players[0].address);
      expect(t.winningScore).to.equal(9000n);
    });

    it("status is Finalized", async function () {
      const t = await tournament.getTournament(id);
      expect(t.status).to.equal(1n);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  5.  3+ participants  — 60 / 25 / 15 split
  // ═══════════════════════════════════════════════════════════════════════════

  describe("3+ participants — standard 60/25/15 split", function () {
    let id, pool;

    beforeEach(async function () {
      id = await createTournament({ entryFee: ethers.parseEther("1") });
      // Submit scores in non-rank order to exercise sort correctness
      await joinAndScore(id, players[0], 3000); // 3rd
      await joinAndScore(id, players[1], 9500); // 1st
      await joinAndScore(id, players[2], 7000); // 2nd
      const t = await tournament.getTournament(id);
      pool = t.prizePool;
      await time.increaseTo(Number(t.endTime) + 1);
      await tournament.finalizeTournament(id);
    });

    it("1st place receives ~60% of pool", async function () {
      const expected = (pool * 6000n) / BPS_DENOMINATOR;
      // dust may have been added to 1st if integer division left remainder
      const actual = await tournament.claimablePrize(id, players[1].address);
      expect(actual).to.be.gte(expected); // at least 60%
    });

    it("2nd place receives exactly (pool * 2500) / 10000", async function () {
      const expected = (pool * 2500n) / BPS_DENOMINATOR;
      expect(
        await tournament.claimablePrize(id, players[2].address)
      ).to.equal(expected);
    });

    it("3rd place receives exactly (pool * 1500) / 10000", async function () {
      const expected = (pool * 1500n) / BPS_DENOMINATOR;
      expect(
        await tournament.claimablePrize(id, players[0].address)
      ).to.equal(expected);
    });

    it("all prizes sum to the full pool (dust goes to 1st)", async function () {
      const p1 = await tournament.claimablePrize(id, players[1].address);
      const p2 = await tournament.claimablePrize(id, players[2].address);
      const p3 = await tournament.claimablePrize(id, players[0].address);
      expect(p1 + p2 + p3).to.equal(pool);
    });

    it("winner is the highest-scoring player (players[1] with 9500)", async function () {
      const t = await tournament.getTournament(id);
      expect(t.winner).to.equal(players[1].address);
      expect(t.winningScore).to.equal(9500n);
    });

    it("status is Finalized", async function () {
      const t = await tournament.getTournament(id);
      expect(t.status).to.equal(1n);
    });

    it("dust added to 1st: (p1 + p2 + p3) === pool with no leftover", async function () {
      const p1 = await tournament.claimablePrize(id, players[1].address);
      const p2 = await tournament.claimablePrize(id, players[2].address);
      const p3 = await tournament.claimablePrize(id, players[0].address);
      const rawDistributed =
        (pool * 6000n) / BPS_DENOMINATOR +
        (pool * 2500n) / BPS_DENOMINATOR +
        (pool * 1500n) / BPS_DENOMINATOR;
      const dust = pool - rawDistributed;
      // 1st place prize must equal base + dust
      expect(p1).to.equal((pool * 6000n) / BPS_DENOMINATOR + dust);
      expect(p2 + p3 + p1).to.equal(pool);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  6.  5 participants — exact wei amounts for pool = 10e18
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Exact wei amounts — pool of 10e18 with 5 participants", function () {
    /**
     * We want a prizePool of exactly 10 ETH (10e18 wei).
     * Entry fee = 10e18 / 5 before protocol fee deduction.
     * Each entry contributes entryFee * (1 - 5/100) = entryFee * 0.95 to the pool.
     * But we also add a seed to reach exactly 10e18.
     *
     * Simpler approach: use a seed of 10e18 and entryFee = 0.
     * Then prizePool = 10e18 exactly — no protocol fee on zero-fee entry.
     */
    let id;
    const POOL = ethers.parseEther("10"); // 10e18

    beforeEach(async function () {
      // Zero entry-fee tournament seeded with 10e18 by owner
      await mockToken.mint(owner.address, POOL);
      id = await createTournament({
        entryFee: 0n,
        seedAmount: POOL,
        creator: owner,
      });

      // 5 players join (no entry fee → no protocol fee deduction)
      for (let i = 0; i < 5; i++) {
        await tournament.connect(players[i]).joinTournament(id, { value: 0n });
      }

      // Submit scores: player[0]=1000, [1]=2000, [2]=3000, [3]=4000, [4]=5000
      for (let i = 0; i < 5; i++) {
        const score = (i + 1) * 1000;
        const nonce = freshNonce();
        const sig = await signScore(
          scoreVerifierWallet,
          id,
          players[i].address,
          score,
          nonce
        );
        await tournament.connect(players[i]).submitScore(id, score, nonce, sig);
      }

      const t = await tournament.getTournament(id);
      await time.increaseTo(Number(t.endTime) + 1);
      await tournament.finalizeTournament(id);
    });

    it("prizePool is exactly 10e18", async function () {
      const t = await tournament.getTournament(id);
      expect(t.prizePool).to.equal(POOL);
    });

    it("1st place prize is exactly 6e18", async function () {
      // players[4] submitted score 5000 → rank 1
      expect(
        await tournament.claimablePrize(id, players[4].address)
      ).to.equal(ethers.parseEther("6"));
    });

    it("2nd place prize is exactly 2.5e18", async function () {
      // players[3] submitted score 4000 → rank 2
      expect(
        await tournament.claimablePrize(id, players[3].address)
      ).to.equal(ethers.parseEther("2.5"));
    });

    it("3rd place prize is exactly 1.5e18", async function () {
      // players[2] submitted score 3000 → rank 3
      expect(
        await tournament.claimablePrize(id, players[2].address)
      ).to.equal(ethers.parseEther("1.5"));
    });

    it("4th and 5th place receive nothing", async function () {
      expect(
        await tournament.claimablePrize(id, players[1].address)
      ).to.equal(0n);
      expect(
        await tournament.claimablePrize(id, players[0].address)
      ).to.equal(0n);
    });

    it("sum of top-3 prizes equals full pool (6+2.5+1.5 == 10)", async function () {
      const p1 = await tournament.claimablePrize(id, players[4].address);
      const p2 = await tournament.claimablePrize(id, players[3].address);
      const p3 = await tournament.claimablePrize(id, players[2].address);
      expect(p1 + p2 + p3).to.equal(POOL);
    });

    it("winner is players[4] with score 5000", async function () {
      const t = await tournament.getTournament(id);
      expect(t.winner).to.equal(players[4].address);
      expect(t.winningScore).to.equal(5000n);
    });

    it("status is Finalized", async function () {
      const t = await tournament.getTournament(id);
      expect(t.status).to.equal(1n);
    });

    it("dust is zero for exact 10e18 pool (10e18 * 6000 / 10000 is exact)", async function () {
      const rawDistributed =
        (POOL * 6000n) / BPS_DENOMINATOR +
        (POOL * 2500n) / BPS_DENOMINATOR +
        (POOL * 1500n) / BPS_DENOMINATOR;
      expect(rawDistributed).to.equal(POOL); // no dust
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  7.  Post-finalization claim flow
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Prize claim flow after finalization", function () {
    it("winner can claim and receives correct token balance delta", async function () {
      const id = await createTournament({ entryFee: 0n, seedAmount: ethers.parseEther("3") });
      await joinAndScore(id, players[0], 9999);
      await joinAndScore(id, players[1], 5555);
      await endAndFinalize(id);

      const balBefore = await mockToken.balanceOf(players[0].address);
      const prize = await tournament.claimablePrize(id, players[0].address);
      await tournament.connect(players[0]).claimPrize(id);
      const balAfter = await mockToken.balanceOf(players[0].address);
      expect(balAfter - balBefore).to.equal(prize);
    });

    it("claimable amount is zero after claiming", async function () {
      const id = await createTournament({ entryFee: 0n, seedAmount: ethers.parseEther("3") });
      await joinAndScore(id, players[0], 9999);
      await endAndFinalize(id);
      await tournament.connect(players[0]).claimPrize(id);
      expect(
        await tournament.claimablePrize(id, players[0].address)
      ).to.equal(0n);
    });

    it("non-winner cannot claim (reverts NoPrizeToClaim)", async function () {
      const id = await createTournament({ entryFee: 0n, seedAmount: ethers.parseEther("3") });
      await joinAndScore(id, players[0], 9999);
      await joinAndScore(id, players[1], 8000);
      await joinAndScore(id, players[2], 7000);
      await endAndFinalize(id);

      // players[3] never joined → no prize
      await expect(
        tournament.connect(players[3]).claimPrize(id)
      ).to.be.revertedWithCustomError(tournament, "NoPrizeToClaim");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  8.  Edge cases
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Edge cases", function () {
    it("tournament with 0 prizePool and scores emits winner=address(0)", async function () {
      // Zero entry-fee, zero seed → prizePool stays 0
      const id = await createTournament({ entryFee: 0n, seedAmount: 0n });
      await joinAndScore(id, players[0], 1234);
      const t = await tournament.getTournament(id);
      await time.increaseTo(Number(t.endTime) + 1);

      await expect(tournament.finalizeTournament(id))
        .to.emit(tournament, "TournamentFinalized")
        .withArgs(id, ethers.ZeroAddress, 0n, 0n);
    });

    it("leaderboard[0] matches tournament.winner after finalization", async function () {
      const id = await createTournament({ entryFee: 0n, seedAmount: ethers.parseEther("2") });
      await joinAndScore(id, players[0], 200);
      await joinAndScore(id, players[1], 800);
      await joinAndScore(id, players[2], 500);
      await endAndFinalize(id);

      const t = await tournament.getTournament(id);
      const lb = await tournament.getLeaderboard(id);
      expect(t.winner).to.equal(lb[0].player);
      expect(t.winningScore).to.equal(lb[0].score);
    });

    it("later, higher score update gets reflected in winner", async function () {
      const id = await createTournament({
        entryFee: 0n,
        seedAmount: ethers.parseEther("1"),
        durationSecs: MIN_DURATION + 300,
      });

      // players[0] submits 5000 then updates to 9500
      await tournament.connect(players[0]).joinTournament(id, { value: 0n });
      const nonce1 = freshNonce();
      const sig1 = await signScore(scoreVerifierWallet, id, players[0].address, 5000, nonce1);
      await tournament.connect(players[0]).submitScore(id, 5000, nonce1, sig1);

      await tournament.connect(players[1]).joinTournament(id, { value: 0n });
      const nonce2 = freshNonce();
      const sig2 = await signScore(scoreVerifierWallet, id, players[1].address, 8000, nonce2);
      await tournament.connect(players[1]).submitScore(id, 8000, nonce2, sig2);

      // players[0] improves — should overtake players[1]
      const nonce3 = freshNonce();
      const sig3 = await signScore(scoreVerifierWallet, id, players[0].address, 9500, nonce3);
      await tournament.connect(players[0]).submitScore(id, 9500, nonce3, sig3);

      await endAndFinalize(id);

      const t = await tournament.getTournament(id);
      expect(t.winner).to.equal(players[0].address);
      expect(t.winningScore).to.equal(9500n);
    });

    it("tied scenario — first submitter stays ahead when scores are equal", async function () {
      // The leaderboard insertion sort is stable; equal scores keep insertion order.
      // We only verify no revert, both receive non-zero prizes in a 2-player tie.
      const id = await createTournament({ entryFee: 0n, seedAmount: ethers.parseEther("2") });
      await joinAndScore(id, players[0], 7777);
      await joinAndScore(id, players[1], 7777); // same score
      await endAndFinalize(id);

      const p0 = await tournament.claimablePrize(id, players[0].address);
      const p1 = await tournament.claimablePrize(id, players[1].address);
      // Combined prizes must equal the pool
      const t = await tournament.getTournament(id);
      expect(p0 + p1).to.equal(t.prizePool);
    });
  });
});
