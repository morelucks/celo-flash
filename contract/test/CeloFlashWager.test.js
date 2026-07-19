const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("CeloFlashWager — House Edge Withdrawal & Accounting", function () {
  const SCORE_THRESHOLD = 100;
  const FUND_AMOUNT = ethers.parseEther("100");
  const WAGER_AMOUNT = ethers.parseEther("1");
  const WIN_MULTIPLIER_BPS = 20_000n;
  const HOUSE_EDGE_BPS = 500n;
  const BPS_DENOMINATOR = 10_000n;

  // 2x gross payout, 5% house edge on the gross payout
  const GROSS_PAYOUT = (WAGER_AMOUNT * WIN_MULTIPLIER_BPS) / BPS_DENOMINATOR;
  const EDGE_PER_WIN = (GROSS_PAYOUT * HOUSE_EDGE_BPS) / BPS_DENOMINATOR;
  const NET_PAYOUT = GROSS_PAYOUT - EDGE_PER_WIN;

  let wager;
  let owner;
  let verifier;
  let treasury;
  let players;

  let nonceCounter = 0;

  function uniqueNonce() {
    return ethers.encodeBytes32String(`nonce-${nonceCounter++}`);
  }

  async function signScore(wagerId, playerAddress, score, nonce) {
    const messageHash = ethers.solidityPackedKeccak256(
      ["uint256", "address", "uint256", "bytes32"],
      [wagerId, playerAddress, score, nonce]
    );
    return verifier.signMessage(ethers.getBytes(messageHash));
  }

  async function placeAndResolve(player, score) {
    await wager.connect(player).placeWager({ value: WAGER_AMOUNT });
    const wagerId = await wager.nextWagerId();

    const nonce = uniqueNonce();
    const signature = await signScore(wagerId, player.address, score, nonce);
    await wager.connect(player).resolveWager(wagerId, score, nonce, signature);

    return wagerId;
  }

  async function expectSolvent() {
    const balance = await ethers.provider.getBalance(await wager.getAddress());
    const liabilities = await wager.totalPendingLiabilities();
    const edge = await wager.accumulatedHouseEdge();
    expect(balance).to.be.gte(liabilities + edge);
  }

  beforeEach(async function () {
    [owner, verifier, treasury, ...players] = await ethers.getSigners();
    players = players.slice(0, 5);

    const CeloFlashWager = await ethers.getContractFactory("CeloFlashWager");
    wager = await CeloFlashWager.deploy(verifier.address, treasury.address, SCORE_THRESHOLD);
    await wager.waitForDeployment();

    await wager.fundHouse({ value: FUND_AMOUNT });
  });

  describe("House edge accumulation", function () {
    it("Should accumulate 5% of the gross payout when a wager is won", async function () {
      await placeAndResolve(players[0], SCORE_THRESHOLD + 50);

      expect(await wager.accumulatedHouseEdge()).to.equal(EDGE_PER_WIN);
    });

    it("Should not accumulate house edge when a wager is lost", async function () {
      await placeAndResolve(players[0], SCORE_THRESHOLD - 1);

      expect(await wager.accumulatedHouseEdge()).to.equal(0);
    });
  });

  describe("withdrawHouseEdge", function () {
    beforeEach(async function () {
      await placeAndResolve(players[0], SCORE_THRESHOLD + 50);
    });

    it("Should natively transfer the accumulated house edge to treasury and reset to 0", async function () {
      await expect(wager.withdrawHouseEdge()).to.changeEtherBalances(
        [wager, treasury],
        [-EDGE_PER_WIN, EDGE_PER_WIN]
      );

      expect(await wager.accumulatedHouseEdge()).to.equal(0);
    });

    it("Should emit HouseEdgeWithdrawn with the correct amount", async function () {
      await expect(wager.withdrawHouseEdge())
        .to.emit(wager, "HouseEdgeWithdrawn")
        .withArgs(treasury.address, EDGE_PER_WIN);
    });

    it("Should revert on a second withdrawal since the pool was reset", async function () {
      await wager.withdrawHouseEdge();
      await expect(wager.withdrawHouseEdge()).to.be.revertedWithCustomError(
        wager,
        "NoHouseEdgeToWithdraw"
      );
    });

    it("Should revert if a non-owner tries to withdraw", async function () {
      await expect(
        wager.connect(players[0]).withdrawHouseEdge()
      ).to.be.revertedWithCustomError(wager, "OwnableUnauthorizedAccount");
    });
  });

  describe("withdrawHouseEdge — reverts", function () {
    it("Should revert with NoHouseEdgeToWithdraw when house edge is 0", async function () {
      expect(await wager.accumulatedHouseEdge()).to.equal(0);

      await expect(wager.withdrawHouseEdge()).to.be.revertedWithCustomError(
        wager,
        "NoHouseEdgeToWithdraw"
      );
    });
  });

  describe("Accounting invariants", function () {
    it("After 5 won wagers + house edge withdrawal + all claims: contract balance == funded reserve only", async function () {
      const contractAddress = await wager.getAddress();
      const wagerIds = [];

      for (const player of players) {
        wagerIds.push(await placeAndResolve(player, SCORE_THRESHOLD + 10));
        await expectSolvent();
      }

      expect(await wager.accumulatedHouseEdge()).to.equal(EDGE_PER_WIN * 5n);
      expect(await wager.totalPendingLiabilities()).to.equal(0);

      await wager.withdrawHouseEdge();
      await expectSolvent();

      for (let i = 0; i < players.length; i++) {
        await expect(wager.connect(players[i]).claimWinnings(wagerIds[i])).to.changeEtherBalance(
          players[i],
          NET_PAYOUT
        );
        await expectSolvent();
      }

      // The house paid out NET_PAYOUT against each 1 CELO stake and the edge
      // left the contract, so only the (reduced) funded reserve remains.
      const expectedReserve =
        FUND_AMOUNT + WAGER_AMOUNT * 5n - NET_PAYOUT * 5n - EDGE_PER_WIN * 5n;

      expect(await ethers.provider.getBalance(contractAddress)).to.equal(expectedReserve);
      expect(await wager.getHouseReserve()).to.equal(expectedReserve);
      expect(await wager.totalPendingLiabilities()).to.equal(0);
      expect(await wager.accumulatedHouseEdge()).to.equal(0);
    });

    it("Should keep a lost wager's stake in the house reserve", async function () {
      await placeAndResolve(players[0], SCORE_THRESHOLD - 1);

      expect(await wager.totalPendingLiabilities()).to.equal(0);
      expect(await wager.accumulatedHouseEdge()).to.equal(0);
      expect(await wager.getHouseReserve()).to.equal(FUND_AMOUNT + WAGER_AMOUNT);
      await expectSolvent();
    });

    it("Should maintain contract.balance >= totalPendingLiabilities + accumulatedHouseEdge throughout mixed activity", async function () {
      // Pending wagers lock liabilities
      await wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT });
      await wager.connect(players[1]).placeWager({ value: WAGER_AMOUNT });
      expect(await wager.totalPendingLiabilities()).to.equal(GROSS_PAYOUT * 2n);
      await expectSolvent();

      // players[0] wins
      const wonId = await wager.getActiveWager(players[0].address);
      const winNonce = uniqueNonce();
      const winSignature = await signScore(wonId, players[0].address, SCORE_THRESHOLD, winNonce);
      await wager.connect(players[0]).resolveWager(wonId, SCORE_THRESHOLD, winNonce, winSignature);
      await expectSolvent();

      // players[1] loses
      const lostId = await wager.getActiveWager(players[1].address);
      const loseNonce = uniqueNonce();
      const loseSignature = await signScore(lostId, players[1].address, 0, loseNonce);
      await wager.connect(players[1]).resolveWager(lostId, 0, loseNonce, loseSignature);
      await expectSolvent();

      // players[2]'s wager expires and is refunded
      await wager.connect(players[2]).placeWager({ value: WAGER_AMOUNT });
      const expiredId = await wager.getActiveWager(players[2].address);
      await time.increase(3600 + 1);
      await expect(wager.expireWager(expiredId)).to.changeEtherBalance(
        players[2],
        WAGER_AMOUNT
      );
      await expectSolvent();

      // Winner claims, then the edge is withdrawn
      await wager.connect(players[0]).claimWinnings(wonId);
      await expectSolvent();

      await wager.withdrawHouseEdge();
      await expectSolvent();

      expect(await wager.totalPendingLiabilities()).to.equal(0);
      expect(await wager.accumulatedHouseEdge()).to.equal(0);
    });
  });
});

describe("CeloFlashWager — expireWager (time-based expiry & refunds)", function () {
  const SCORE_THRESHOLD = 100;
  const FUND_AMOUNT = ethers.parseEther("100");
  const WAGER_AMOUNT = ethers.parseEther("1");
  const MIN_WAGER = ethers.parseEther("0.001");
  const MAX_WAGER = ethers.parseEther("10");

  const WIN_MULTIPLIER_BPS = 20_000n;
  const BPS_DENOMINATOR = 10_000n;
  const WAGER_EXPIRY = 3600; // 1 hour, matches WAGER_EXPIRY in the contract

  // 2x the stake — the liability the house locks per pending wager
  const GROSS_PAYOUT = (WAGER_AMOUNT * WIN_MULTIPLIER_BPS) / BPS_DENOMINATOR;

  let wager;
  let owner;
  let verifier;
  let treasury;
  let players;

  let nonceCounter = 0;
  const uniqueNonce = () => ethers.encodeBytes32String(`exp-nonce-${nonceCounter++}`);

  async function signScore(wagerId, playerAddress, score, nonce) {
    const messageHash = ethers.solidityPackedKeccak256(
      ["uint256", "address", "uint256", "bytes32"],
      [wagerId, playerAddress, score, nonce]
    );
    return verifier.signMessage(ethers.getBytes(messageHash));
  }

  beforeEach(async function () {
    [owner, verifier, treasury, ...players] = await ethers.getSigners();
    players = players.slice(0, 5);

    const CeloFlashWager = await ethers.getContractFactory("CeloFlashWager");
    wager = await CeloFlashWager.deploy(verifier.address, treasury.address, SCORE_THRESHOLD);
    await wager.waitForDeployment();

    await wager.fundHouse({ value: FUND_AMOUNT });
  });

  // Place a pending wager and return its id.
  async function placePending(player, amount = WAGER_AMOUNT) {
    await wager.connect(player).placeWager({ value: amount });
    return wager.nextWagerId();
  }

  // Place a wager then resolve it with the given score (won or lost).
  async function placeAndResolve(player, score) {
    const wagerId = await placePending(player);
    const nonce = uniqueNonce();
    const signature = await signScore(wagerId, player.address, score, nonce);
    await wager.connect(player).resolveWager(wagerId, score, nonce, signature);
    return wagerId;
  }

  // Assert the contract stays solvent: balance covers liabilities + edge.
  async function expectSolvent() {
    const balance = await ethers.provider.getBalance(await wager.getAddress());
    const liabilities = await wager.totalPendingLiabilities();
    const edge = await wager.accumulatedHouseEdge();
    expect(balance).to.be.gte(liabilities + edge);
  }

  // ── expireWager test cases ──

  it("expiring one of two pending wagers only releases that wager's liability", async function () {
    const idA = await placePending(players[0]);
    const idB = await placePending(players[1]);
    expect(await wager.totalPendingLiabilities()).to.equal(GROSS_PAYOUT * 2n);

    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(idA);

    // Only A's liability is released; B is still pending.
    expect(await wager.totalPendingLiabilities()).to.equal(GROSS_PAYOUT);
    const bStored = await wager.getWager(idB);
    expect(bStored.status).to.equal(0); // WagerStatus.Pending
  });

  it("keeps the contract solvent after refunding an expired wager", async function () {
    const wagerId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(wagerId);

    await expectSolvent();
  });

  it("leaves accumulatedHouseEdge untouched when a wager expires", async function () {
    // A prior win seeds some house edge.
    await placeAndResolve(players[0], SCORE_THRESHOLD + 5);
    const edgeBefore = await wager.accumulatedHouseEdge();
    expect(edgeBefore).to.be.gt(0);

    const wagerId = await placePending(players[1]);
    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(wagerId);

    expect(await wager.accumulatedHouseEdge()).to.equal(edgeBefore);
  });

  it("refunds the exact stake for a maximum-sized wager", async function () {
    await wager.connect(players[0]).placeWager({ value: MAX_WAGER });
    const wagerId = await wager.nextWagerId();

    await time.increase(WAGER_EXPIRY + 1);

    await expect(wager.expireWager(wagerId)).to.changeEtherBalance(
      players[0],
      MAX_WAGER
    );
  });

  it("refunds the exact stake for a minimum-sized wager", async function () {
    await wager.connect(players[0]).placeWager({ value: MIN_WAGER });
    const wagerId = await wager.nextWagerId();

    await time.increase(WAGER_EXPIRY + 1);

    await expect(wager.expireWager(wagerId)).to.changeEtherBalance(
      players[0],
      MIN_WAGER
    );
  });

  it("reduces the contract balance by exactly the refunded stake", async function () {
    const wagerId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);

    await expect(wager.expireWager(wagerId)).to.changeEtherBalance(
      wager,
      -WAGER_AMOUNT
    );
  });

  it("reports no active wager for the player once it is expired", async function () {
    const wagerId = await placePending(players[0]);
    expect(await wager.getActiveWager(players[0].address)).to.equal(wagerId);

    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(wagerId);

    expect(await wager.getActiveWager(players[0].address)).to.equal(0);
  });

  it("lets the player place a fresh wager after their previous one expired", async function () {
    const firstId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(firstId);

    // No ActiveWagerExists revert because the old wager is no longer Pending.
    await expect(
      wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT })
    ).to.emit(wager, "WagerPlaced");

    const secondId = await wager.nextWagerId();
    expect(secondId).to.equal(firstId + 1n);
  });

  it("pays the refund to the player, never to the caller who expires it", async function () {
    const wagerId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);

    // Caller (players[3]) nets zero (gas excluded); player receives the stake.
    await expect(
      wager.connect(players[3]).expireWager(wagerId)
    ).to.changeEtherBalances([players[3], players[0]], [0n, WAGER_AMOUNT]);
  });

  it("is permissionless: the owner may also expire a stale wager", async function () {
    const wagerId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);

    await expect(
      wager.connect(owner).expireWager(wagerId)
    ).to.changeEtherBalance(players[0], WAGER_AMOUNT);
  });

  it("is permissionless: a different player can expire and the original player is refunded", async function () {
    const wagerId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);

    // players[1] triggers the cleanup, players[0] receives the stake.
    await expect(
      wager.connect(players[1]).expireWager(wagerId)
    ).to.changeEtherBalance(players[0], WAGER_AMOUNT);
  });

  it("reverts WagerNotPending for a claimed wager", async function () {
    const wagerId = await placeAndResolve(players[0], SCORE_THRESHOLD + 5);
    await wager.connect(players[0]).claimWinnings(wagerId);

    await time.increase(WAGER_EXPIRY + 1);

    await expect(wager.expireWager(wagerId)).to.be.revertedWithCustomError(
      wager,
      "WagerNotPending"
    );
  });

  it("reverts WagerNotPending for a lost wager even after the window passes", async function () {
    const wagerId = await placeAndResolve(players[0], SCORE_THRESHOLD - 1);

    await time.increase(WAGER_EXPIRY + 1);

    await expect(wager.expireWager(wagerId)).to.be.revertedWithCustomError(
      wager,
      "WagerNotPending"
    );
  });

  it("reverts WagerNotPending for a won wager even after the window passes", async function () {
    const wagerId = await placeAndResolve(players[0], SCORE_THRESHOLD + 5);

    await time.increase(WAGER_EXPIRY + 1);

    await expect(wager.expireWager(wagerId)).to.be.revertedWithCustomError(
      wager,
      "WagerNotPending"
    );
  });

  it("reverts WagerNotPending when expiring an already-expired wager", async function () {
    const wagerId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(wagerId);

    await expect(wager.expireWager(wagerId)).to.be.revertedWithCustomError(
      wager,
      "WagerNotPending"
    );
  });

  it("succeeds at exactly createdAt + WAGER_EXPIRY (boundary is inclusive)", async function () {
    const wagerId = await placePending(players[0]);
    const { createdAt } = await wager.getWager(wagerId);

    // block.timestamp == createdAt + WAGER_EXPIRY is NOT < the deadline, so it passes.
    await time.setNextBlockTimestamp(Number(createdAt) + WAGER_EXPIRY);

    await expect(wager.expireWager(wagerId))
      .to.emit(wager, "WagerExpired")
      .withArgs(wagerId, players[0].address);
  });

  it("reverts with WagerNotExpired immediately after placing (no time passed)", async function () {
    const wagerId = await placePending(players[0]);

    await expect(wager.expireWager(wagerId)).to.be.revertedWithCustomError(
      wager,
      "WagerNotExpired"
    );
  });

  it("reverts with WagerNotExpired exactly one second before the window closes", async function () {
    const wagerId = await placePending(players[0]);
    const { createdAt } = await wager.getWager(wagerId);

    // Force the expire tx to land 1 second before createdAt + WAGER_EXPIRY.
    await time.setNextBlockTimestamp(Number(createdAt) + WAGER_EXPIRY - 1);

    await expect(wager.expireWager(wagerId)).to.be.revertedWithCustomError(
      wager,
      "WagerNotExpired"
    );
  });

  it("emits WagerExpired with the wager id and player", async function () {
    const wagerId = await placePending(players[0]);

    await time.increase(WAGER_EXPIRY + 1);

    await expect(wager.expireWager(wagerId))
      .to.emit(wager, "WagerExpired")
      .withArgs(wagerId, players[0].address);
  });

  it("sets the wager status to Expired (enum value 3)", async function () {
    const wagerId = await placePending(players[0]);

    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(wagerId);

    const stored = await wager.getWager(wagerId);
    expect(stored.status).to.equal(3); // WagerStatus.Expired
  });

  it("decreases totalPendingLiabilities by the wager's potentialPayout", async function () {
    const wagerId = await placePending(players[0]);
    expect(await wager.totalPendingLiabilities()).to.equal(GROSS_PAYOUT);

    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(wagerId);

    expect(await wager.totalPendingLiabilities()).to.equal(0);
  });

  it("refunds exactly msg.value, never the 2x potentialPayout", async function () {
    const wagerId = await placePending(players[0]);
    const stored = await wager.getWager(wagerId);
    expect(stored.potentialPayout).to.equal(GROSS_PAYOUT);
    expect(stored.potentialPayout).to.not.equal(WAGER_AMOUNT);

    await time.increase(WAGER_EXPIRY + 1);

    // Player gets back only the stake, not the doubled payout.
    await expect(wager.expireWager(wagerId)).to.changeEtherBalance(
      players[0],
      WAGER_AMOUNT
    );
  });

  it("refunds the player their exact original stake after 1 hour + 1 second", async function () {
    const wagerId = await placePending(players[0]);

    await time.increase(WAGER_EXPIRY + 1); // 1 hour + 1 second

    await expect(wager.expireWager(wagerId)).to.changeEtherBalance(
      players[0],
      WAGER_AMOUNT
    );
  });
});
