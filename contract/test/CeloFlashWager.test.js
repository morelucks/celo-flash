const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

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

  it("restores the house reserve to its funded baseline after a lone wager expires", async function () {
    expect(await wager.getHouseReserve()).to.equal(FUND_AMOUNT);

    const wagerId = await placePending(players[0]);
    // Locking the liability temporarily shrinks the free reserve.
    expect(await wager.getHouseReserve()).to.equal(FUND_AMOUNT - (GROSS_PAYOUT - WAGER_AMOUNT));

    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(wagerId);

    // Refund returns the stake and clears the liability — back to square one.
    expect(await wager.getHouseReserve()).to.equal(FUND_AMOUNT);
    expect(await wager.totalPendingLiabilities()).to.equal(0);
  });

  it("expiring one player's wager does not disturb another player's winning resolution", async function () {
    const staleId = await placePending(players[0]);
    const liveId = await placePending(players[1]);

    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(staleId);

    // players[1] can still resolve their (now also aged) wager as a win.
    const nonce = uniqueNonce();
    const signature = await signScore(liveId, players[1].address, SCORE_THRESHOLD + 1, nonce);
    await wager.connect(players[1]).resolveWager(liveId, SCORE_THRESHOLD + 1, nonce, signature);

    const stored = await wager.getWager(liveId);
    expect(stored.status).to.equal(1); // Won
    await expectSolvent();
  });

  it("lets a player win and claim a new wager after their prior one expired", async function () {
    const firstId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(firstId);

    // A fresh, winning wager for the same player resolves and claims normally.
    const secondId = await placeAndResolve(players[0], SCORE_THRESHOLD + 10);
    const stored = await wager.getWager(secondId);
    expect(stored.status).to.equal(1); // WagerStatus.Won

    await expect(
      wager.connect(players[0]).claimWinnings(secondId)
    ).to.emit(wager, "WagerClaimed");
  });

  it("still counts an expired wager in totalWagersPlaced", async function () {
    const placedBefore = await wager.totalWagersPlaced();

    const wagerId = await placePending(players[0]);
    expect(await wager.totalWagersPlaced()).to.equal(placedBefore + 1n);

    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(wagerId);

    // Expiry is a refund, not an un-count: the placement total is unchanged.
    expect(await wager.totalWagersPlaced()).to.equal(placedBefore + 1n);
  });

  it("moves exactly the stake from the contract to the player", async function () {
    const wagerId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);

    await expect(wager.expireWager(wagerId)).to.changeEtherBalances(
      [wager, players[0]],
      [-WAGER_AMOUNT, WAGER_AMOUNT]
    );
  });

  it("reverts early then succeeds once enough time elapses on the same wager", async function () {
    const wagerId = await placePending(players[0]);

    await time.increase(WAGER_EXPIRY - 60); // still inside the window
    await expect(wager.expireWager(wagerId)).to.be.revertedWithCustomError(
      wager,
      "WagerNotExpired"
    );

    await time.increase(120); // now well past the deadline
    await expect(wager.expireWager(wagerId)).to.changeEtherBalance(
      players[0],
      WAGER_AMOUNT
    );
  });

  it("still allows expiry cleanup while the contract is paused", async function () {
    const wagerId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);

    // expireWager carries no whenNotPaused guard — cleanup must survive a pause.
    await wager.connect(owner).pause();

    await expect(wager.expireWager(wagerId)).to.changeEtherBalance(
      players[0],
      WAGER_AMOUNT
    );
  });

  it("full flow: after time.increase(3601) the wager expires, refunds, and settles state", async function () {
    const wagerId = await placePending(players[0]);

    await time.increase(3601); // 1 hour + 1 second, per the acceptance criteria

    const tx = wager.expireWager(wagerId);
    await expect(tx).to.changeEtherBalance(players[0], WAGER_AMOUNT);
    await expect(tx)
      .to.emit(wager, "WagerExpired")
      .withArgs(wagerId, players[0].address);

    const stored = await wager.getWager(wagerId);
    expect(stored.status).to.equal(3); // Expired
    expect(await wager.totalPendingLiabilities()).to.equal(0);
  });

  it("does not count an expired wager as a win", async function () {
    const wonBefore = await wager.totalWagersWon();

    const wagerId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(wagerId);

    expect(await wager.totalWagersWon()).to.equal(wonBefore);
  });

  it("preserves the player and amount fields on the expired wager record", async function () {
    const wagerId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(wagerId);

    const stored = await wager.getWager(wagerId);
    expect(stored.player).to.equal(players[0].address);
    expect(stored.amount).to.equal(WAGER_AMOUNT);
    expect(stored.potentialPayout).to.equal(GROSS_PAYOUT);
  });

  it("exposes WAGER_EXPIRY as exactly 1 hour (3600 seconds)", async function () {
    expect(await wager.WAGER_EXPIRY()).to.equal(WAGER_EXPIRY);
    expect(await wager.WAGER_EXPIRY()).to.equal(3600);
  });

  it("expires several stale wagers independently, refunding each player", async function () {
    const idA = await placePending(players[0]);
    const idB = await placePending(players[1]);
    await time.increase(WAGER_EXPIRY + 1);

    await expect(wager.expireWager(idA)).to.changeEtherBalance(players[0], WAGER_AMOUNT);
    await expect(wager.expireWager(idB)).to.changeEtherBalance(players[1], WAGER_AMOUNT);

    expect(await wager.totalPendingLiabilities()).to.equal(0);
    await expectSolvent();
  });

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

// Wager unit test update

// Wager house edge withdrawal test suite

// Revert assertion on zero house edge

// HouseEdgeWithdrawn event assertion

// Wager 5-won-wager balance accounting invariant

// Solvency invariant check

describe("CeloFlashWager — expireWager extended coverage", function () {
  const SCORE_THRESHOLD = 100;
  const FUND_AMOUNT = ethers.parseEther("100");
  const WAGER_AMOUNT = ethers.parseEther("1");
  const MID_WAGER = ethers.parseEther("2.5");
  const ODD_WAGER = ethers.parseEther("1.337");
  const MAX_WAGER = ethers.parseEther("10");

  const WIN_MULTIPLIER_BPS = 20_000n;
  const HOUSE_EDGE_BPS = 500n;
  const BPS_DENOMINATOR = 10_000n;
  const WAGER_EXPIRY = 3600; // 1 hour, matches WAGER_EXPIRY in the contract

  // Gross payout locked as a liability for a given stake (2x).
  const payoutOf = (amount) => (amount * WIN_MULTIPLIER_BPS) / BPS_DENOMINATOR;
  const GROSS_PAYOUT = payoutOf(WAGER_AMOUNT);

  let wager;
  let owner;
  let verifier;
  let treasury;
  let players;

  beforeEach(async function () {
    [owner, verifier, treasury, ...players] = await ethers.getSigners();
    players = players.slice(0, 5);

    const CeloFlashWager = await ethers.getContractFactory("CeloFlashWager");
    wager = await CeloFlashWager.deploy(verifier.address, treasury.address, SCORE_THRESHOLD);
    await wager.waitForDeployment();

    await wager.fundHouse({ value: FUND_AMOUNT });
  });

  let nonceCounter = 0;
  const uniqueNonce = () => ethers.encodeBytes32String(`ext-nonce-${nonceCounter++}`);

  async function signScore(wagerId, playerAddress, score, nonce) {
    const messageHash = ethers.solidityPackedKeccak256(
      ["uint256", "address", "uint256", "bytes32"],
      [wagerId, playerAddress, score, nonce]
    );
    return verifier.signMessage(ethers.getBytes(messageHash));
  }

  // Place a pending wager for `player` and return its id.
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

  it("refunds the exact stake for a mid-sized 2.5 CELO wager", async function () {
    const wagerId = await placePending(players[0], MID_WAGER);

    await time.increase(WAGER_EXPIRY + 1);

    await expect(wager.expireWager(wagerId)).to.changeEtherBalance(
      players[0],
      MID_WAGER
    );
  });

  it("refunds the exact stake for an odd 1.337 CELO wager", async function () {
    const wagerId = await placePending(players[0], ODD_WAGER);

    await time.increase(WAGER_EXPIRY + 1);

    // No rounding anywhere: the refund is the stake to the wei.
    await expect(wager.expireWager(wagerId)).to.changeEtherBalance(
      players[0],
      ODD_WAGER
    );
  });

  it("expiring an unknown wager id moves no funds and no real liability", async function () {
    // A genuine pending wager locks a liability the phantom expiry must not touch.
    await placePending(players[0]);
    expect(await wager.totalPendingLiabilities()).to.equal(GROSS_PAYOUT);

    await time.increase(WAGER_EXPIRY + 1);

    // Id 999 was never created: its record is zeroed, so even though the call
    // goes through, it refunds 0 wei to address(0) and cannot drain anything.
    await expect(wager.expireWager(999)).to.changeEtherBalance(wager, 0n);
    expect(await wager.totalPendingLiabilities()).to.equal(GROSS_PAYOUT);
  });

  it("reverts with WagerNotExpired at the half-hour mark", async function () {
    const wagerId = await placePending(players[0]);

    await time.increase(WAGER_EXPIRY / 2); // 30 minutes in, half the window

    await expect(wager.expireWager(wagerId)).to.be.revertedWithCustomError(
      wager,
      "WagerNotExpired"
    );
  });

  it("cannot resolve a wager once it has been expired", async function () {
    const wagerId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(wagerId);

    // Even a validly signed winning score is rejected after expiry.
    const nonce = uniqueNonce();
    const signature = await signScore(
      wagerId,
      players[0].address,
      SCORE_THRESHOLD + 10,
      nonce
    );

    await expect(
      wager.connect(players[0]).resolveWager(wagerId, SCORE_THRESHOLD + 10, nonce, signature)
    ).to.be.revertedWithCustomError(wager, "WagerNotPending");
  });

  it("cannot claim winnings from an expired wager", async function () {
    const wagerId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(wagerId);

    await expect(
      wager.connect(players[0]).claimWinnings(wagerId)
    ).to.be.revertedWithCustomError(wager, "WagerNotWon");
  });

  it("still expires and refunds a wager thirty days after placement", async function () {
    const wagerId = await placePending(players[0]);

    await time.increase(30 * 24 * 3600); // long-forgotten wager

    await expect(wager.expireWager(wagerId)).to.changeEtherBalance(
      players[0],
      WAGER_AMOUNT
    );
  });

  it("keeps the expired record's score at zero", async function () {
    const wagerId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(wagerId);

    // No score was ever attested, and expiry must not fabricate one.
    const stored = await wager.getWager(wagerId);
    expect(stored.score).to.equal(0);
  });

  it("preserves the original createdAt timestamp through expiry", async function () {
    const wagerId = await placePending(players[0]);
    const { createdAt: before } = await wager.getWager(wagerId);

    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(wagerId);

    const { createdAt: after } = await wager.getWager(wagerId);
    expect(after).to.equal(before);
  });

  it("records a strictly later createdAt on the replacement wager", async function () {
    const firstId = await placePending(players[0]);
    const { createdAt: firstCreatedAt } = await wager.getWager(firstId);

    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(firstId);

    const secondId = await placePending(players[0]);
    const { createdAt: secondCreatedAt } = await wager.getWager(secondId);
    expect(secondCreatedAt).to.be.gt(firstCreatedAt);
  });

  it("points the activeWager mapping at the replacement wager", async function () {
    const firstId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(firstId);

    const secondId = await placePending(players[0]);

    expect(await wager.activeWager(players[0].address)).to.equal(secondId);
    expect(secondId).to.not.equal(firstId);
  });

  it("leaves nextWagerId untouched when a wager expires", async function () {
    const wagerId = await placePending(players[0]);
    const idBefore = await wager.nextWagerId();

    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(wagerId);

    // Expiry consumes no ids — only placements advance the counter.
    expect(await wager.nextWagerId()).to.equal(idBefore);
  });

  it("counts both the original and the replacement in totalWagersPlaced", async function () {
    const wagerId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(wagerId);

    await placePending(players[0]);

    expect(await wager.totalWagersPlaced()).to.equal(2);
  });

  it("refunds five stale players independently and clears all liabilities", async function () {
    const ids = [];
    for (const player of players) {
      ids.push(await placePending(player));
    }
    expect(await wager.totalPendingLiabilities()).to.equal(GROSS_PAYOUT * 5n);

    await time.increase(WAGER_EXPIRY + 1);

    for (let i = 0; i < players.length; i++) {
      await expect(wager.expireWager(ids[i])).to.changeEtherBalance(
        players[i],
        WAGER_AMOUNT
      );
    }

    expect(await wager.totalPendingLiabilities()).to.equal(0);
  });

  it("stays solvent through a mix of expiry, loss and claimed win", async function () {
    const expiredId = await placePending(players[0]);
    const lostId = await placePending(players[1]);
    const wonId = await placePending(players[2]);

    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(expiredId);
    await expectSolvent();

    // Resolution has no deadline of its own, so the aged wagers still settle.
    const loseNonce = uniqueNonce();
    const loseSig = await signScore(lostId, players[1].address, 0, loseNonce);
    await wager.connect(players[1]).resolveWager(lostId, 0, loseNonce, loseSig);
    await expectSolvent();

    const winScore = SCORE_THRESHOLD + 1;
    const winNonce = uniqueNonce();
    const winSig = await signScore(wonId, players[2].address, winScore, winNonce);
    await wager.connect(players[2]).resolveWager(wonId, winScore, winNonce, winSig);
    await wager.connect(players[2]).claimWinnings(wonId);
    await expectSolvent();

    expect(await wager.totalPendingLiabilities()).to.equal(0);
    expect(await wager.accumulatedHouseEdge()).to.equal(
      (GROSS_PAYOUT * HOUSE_EDGE_BPS) / BPS_DENOMINATOR
    );
  });

  it("expires staggered wagers only after their own deadlines", async function () {
    const idA = await placePending(players[0]);
    const { createdAt: createdA } = await wager.getWager(idA);

    await time.increase(WAGER_EXPIRY / 2);
    const idB = await placePending(players[1]);

    // A is past its window, B is only ~30 minutes old.
    await time.setNextBlockTimestamp(Number(createdA) + WAGER_EXPIRY + 1);
    await expect(wager.expireWager(idA)).to.changeEtherBalance(
      players[0],
      WAGER_AMOUNT
    );

    await expect(wager.expireWager(idB)).to.be.revertedWithCustomError(
      wager,
      "WagerNotExpired"
    );
  });

  it("is permissionless: the treasury account can trigger the expiry", async function () {
    const wagerId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);

    await expect(
      wager.connect(treasury).expireWager(wagerId)
    ).to.changeEtherBalance(players[0], WAGER_AMOUNT);
  });

  it("is permissionless: the score verifier account can trigger the expiry", async function () {
    const wagerId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);

    await expect(
      wager.connect(verifier).expireWager(wagerId)
    ).to.changeEtherBalance(players[0], WAGER_AMOUNT);
  });

  it("emits exactly one WagerExpired log in the expiry receipt", async function () {
    const wagerId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);

    const receipt = await (await wager.expireWager(wagerId)).wait();
    const expiredLogs = receipt.logs
      .map((log) => wager.interface.parseLog(log))
      .filter((parsed) => parsed && parsed.name === "WagerExpired");

    expect(expiredLogs).to.have.lengthOf(1);
  });

  it("makes WagerExpired queryable by its indexed wager id", async function () {
    const wagerId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(wagerId);

    const events = await wager.queryFilter(wager.filters.WagerExpired(wagerId));
    expect(events).to.have.lengthOf(1);
    expect(events[0].args.wagerId).to.equal(wagerId);
    expect(events[0].args.player).to.equal(players[0].address);
  });

  it("keeps getHouseReserve equal to balance minus liabilities and edge while pending", async function () {
    await placePending(players[0]);

    const balance = await ethers.provider.getBalance(await wager.getAddress());
    const liabilities = await wager.totalPendingLiabilities();
    const edge = await wager.accumulatedHouseEdge();

    expect(await wager.getHouseReserve()).to.equal(balance - liabilities - edge);
  });

  it("restores the reserve to its funded baseline after a max wager expires", async function () {
    const wagerId = await placePending(players[0], MAX_WAGER);

    // A 10 CELO stake locks another 10 CELO of house risk.
    expect(await wager.getHouseReserve()).to.equal(
      FUND_AMOUNT - (payoutOf(MAX_WAGER) - MAX_WAGER)
    );

    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(wagerId);

    expect(await wager.getHouseReserve()).to.equal(FUND_AMOUNT);
  });

  it("keeps accumulatedHouseEdge at zero across an expiry with no prior wins", async function () {
    const wagerId = await placePending(players[0]);
    expect(await wager.accumulatedHouseEdge()).to.equal(0);

    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(wagerId);

    expect(await wager.accumulatedHouseEdge()).to.equal(0);
  });

  it("grows the free reserve when the house is funded after an expiry", async function () {
    const wagerId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(wagerId);

    const topUp = ethers.parseEther("5");
    await wager.connect(players[3]).fundHouse({ value: topUp });

    expect(await wager.getHouseReserve()).to.equal(FUND_AMOUNT + topUp);
  });

  it("keeps the contract solvent after refunding a max-sized wager", async function () {
    const wagerId = await placePending(players[0], MAX_WAGER);
    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(wagerId);

    await expectSolvent();
    expect(await wager.totalPendingLiabilities()).to.equal(0);
  });

  it("rejects a second expiry attempt from a different caller", async function () {
    const wagerId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);
    await wager.connect(players[1]).expireWager(wagerId);

    // Once refunded the wager is no longer Pending, whoever asks.
    await expect(
      wager.connect(players[2]).expireWager(wagerId)
    ).to.be.revertedWithCustomError(wager, "WagerNotPending");
  });

  it("leaves another player's pending wager untouched by the expiry", async function () {
    const idA = await placePending(players[0]);
    const idB = await placePending(players[1]);

    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(idA);

    const storedB = await wager.getWager(idB);
    expect(storedB.status).to.equal(0); // still Pending
    expect(await wager.getActiveWager(players[1].address)).to.equal(idB);
  });

  it("keeps the Expired record alongside the player's new pending wager", async function () {
    const firstId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(firstId);

    const secondId = await placePending(players[0]);

    const first = await wager.getWager(firstId);
    const second = await wager.getWager(secondId);
    expect(first.status).to.equal(3); // Expired
    expect(second.status).to.equal(0); // Pending
  });

  it("takes no house edge cut out of the refund", async function () {
    const wagerId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);

    // A win pays out net of the 5% edge; a refund must not.
    const edgeCut = (WAGER_AMOUNT * HOUSE_EDGE_BPS) / BPS_DENOMINATOR;
    expect(edgeCut).to.be.gt(0);

    await expect(wager.expireWager(wagerId)).to.changeEtherBalance(
      players[0],
      WAGER_AMOUNT // full stake, not WAGER_AMOUNT - edgeCut
    );
  });

  it("costs the player only gas across a place-then-expire round trip", async function () {
    const before = await ethers.provider.getBalance(players[0].address);

    const placeTx = await wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT });
    const placeReceipt = await placeTx.wait();
    const gasCost = placeReceipt.gasUsed * placeReceipt.gasPrice;

    const wagerId = await wager.nextWagerId();
    await time.increase(WAGER_EXPIRY + 1);

    // Someone else expires, so the player pays no further gas.
    await wager.connect(players[1]).expireWager(wagerId);

    const after = await ethers.provider.getBalance(players[0].address);
    expect(before - after).to.equal(gasCost);
  });

  it("lets the same player expire two consecutive wagers", async function () {
    const firstId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);
    await expect(wager.expireWager(firstId)).to.changeEtherBalance(
      players[0],
      WAGER_AMOUNT
    );

    const secondId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);
    await expect(wager.expireWager(secondId)).to.changeEtherBalance(
      players[0],
      WAGER_AMOUNT
    );

    expect(await wager.totalPendingLiabilities()).to.equal(0);
  });

  it("drops liabilities by the odd wager's exact potentialPayout", async function () {
    const wagerId = await placePending(players[0], ODD_WAGER);
    expect(await wager.totalPendingLiabilities()).to.equal(payoutOf(ODD_WAGER));

    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(wagerId);

    expect(await wager.totalPendingLiabilities()).to.equal(0);
  });

  it("drops the contract balance by exactly the max wager stake", async function () {
    const wagerId = await placePending(players[0], MAX_WAGER);
    await time.increase(WAGER_EXPIRY + 1);

    // Only the 10 CELO stake leaves, never the 20 CELO potential payout.
    await expect(wager.expireWager(wagerId)).to.changeEtherBalance(
      wager,
      -MAX_WAGER
    );
  });

  it("emits neither WagerResolved nor WagerClaimed on expiry", async function () {
    const wagerId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);

    const tx = wager.expireWager(wagerId);
    await expect(tx).to.emit(wager, "WagerExpired");
    await expect(tx).to.not.emit(wager, "WagerResolved");
    await expect(tx).to.not.emit(wager, "WagerClaimed");
  });

  it("gives the replacement wager a fresh full expiry window", async function () {
    const firstId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(firstId);

    const secondId = await placePending(players[0]);

    // The old wager's age must not bleed into the new one.
    await expect(wager.expireWager(secondId)).to.be.revertedWithCustomError(
      wager,
      "WagerNotExpired"
    );

    await time.increase(WAGER_EXPIRY + 1);
    await expect(wager.expireWager(secondId)).to.changeEtherBalance(
      players[0],
      WAGER_AMOUNT
    );
  });

  it("returns the expired stake to the player instead of booking house profit", async function () {
    // A lost wager leaves its stake behind as house profit.
    await placeAndResolve(players[1], SCORE_THRESHOLD - 1);
    expect(await wager.getHouseReserve()).to.equal(FUND_AMOUNT + WAGER_AMOUNT);

    // An expired wager must not: the reserve stays exactly where it was.
    const wagerId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);
    await wager.expireWager(wagerId);

    expect(await wager.getHouseReserve()).to.equal(FUND_AMOUNT + WAGER_AMOUNT);
  });
});

describe("CeloFlashWager — placeWager (bounds, solvency & state)", function () {
  const SCORE_THRESHOLD = 100;
  const FUND_AMOUNT = ethers.parseEther("100");
  const WAGER_AMOUNT = ethers.parseEther("1");
  const MID_WAGER = ethers.parseEther("2.5");
  const ODD_WAGER = ethers.parseEther("1.337");
  const MIN_WAGER = ethers.parseEther("0.001");
  const MAX_WAGER = ethers.parseEther("10");

  const WIN_MULTIPLIER_BPS = 20_000n;
  const HOUSE_EDGE_BPS = 500n;
  const BPS_DENOMINATOR = 10_000n;

  // The 2x liability the house locks for a given stake.
  const payoutOf = (amount) => (amount * WIN_MULTIPLIER_BPS) / BPS_DENOMINATOR;
  const GROSS_PAYOUT = payoutOf(WAGER_AMOUNT);

  // WagerStatus enum values, mirrored from the contract.
  const PENDING = 0n;

  let wager;
  let owner;
  let verifier;
  let treasury;
  let houseFunder;
  let players;

  let nonceCounter = 0;
  const uniqueNonce = () => ethers.encodeBytes32String(`pwb-nonce-${nonceCounter++}`);

  // Deploy a house pre-funded with 100 CELO of reserve.
  async function deployFundedWager() {
    const signers = await ethers.getSigners();
    const [deployer, signer, treasuryAccount] = signers;
    // The reserve is a one-way deposit, so it comes from a signer no other
    // suite spends, keeping the shared accounts out of it.
    const funder = signers[signers.length - 1];

    const CeloFlashWager = await ethers.getContractFactory("CeloFlashWager");
    const contract = await CeloFlashWager.deploy(
      signer.address,
      treasuryAccount.address,
      SCORE_THRESHOLD
    );
    await contract.waitForDeployment();

    await contract.connect(funder).fundHouse({ value: FUND_AMOUNT });

    return {
      wager: contract,
      owner: deployer,
      verifier: signer,
      treasury: treasuryAccount,
      houseFunder: funder,
      players: signers.slice(3, 8),
    };
  }

  beforeEach(async function () {
    // A snapshot-backed fixture: every test starts from the same balances
    // instead of permanently draining the shared signers on each run.
    ({ wager, owner, verifier, treasury, houseFunder, players } =
      await loadFixture(deployFundedWager));
  });

  async function signScore(wagerId, playerAddress, score, nonce) {
    const messageHash = ethers.solidityPackedKeccak256(
      ["uint256", "address", "uint256", "bytes32"],
      [wagerId, playerAddress, score, nonce]
    );
    return verifier.signMessage(ethers.getBytes(messageHash));
  }

  // Place a pending wager for `player` and return its id.
  async function placePending(player, amount = WAGER_AMOUNT) {
    await wager.connect(player).placeWager({ value: amount });
    return wager.nextWagerId();
  }

  // Place a wager then settle it with the given score (won or lost).
  async function placeAndResolve(player, score, amount = WAGER_AMOUNT) {
    const wagerId = await placePending(player, amount);
    const nonce = uniqueNonce();
    const signature = await signScore(wagerId, player.address, score, nonce);
    await wager.connect(player).resolveWager(wagerId, score, nonce, signature);
    return wagerId;
  }

  // A second, deliberately unfunded contract for house-solvency scenarios.
  async function deployBare(fundWith = 0n) {
    const CeloFlashWager = await ethers.getContractFactory("CeloFlashWager");
    const bare = await CeloFlashWager.deploy(
      verifier.address,
      treasury.address,
      SCORE_THRESHOLD
    );
    await bare.waitForDeployment();
    if (fundWith > 0n) await bare.connect(houseFunder).fundHouse({ value: fundWith });
    return bare;
  }

  // Snapshot of every counter placeWager is expected to move.
  async function readCounters(player) {
    return {
      nextWagerId: await wager.nextWagerId(),
      totalWagersPlaced: await wager.totalWagersPlaced(),
      totalPendingLiabilities: await wager.totalPendingLiabilities(),
      activeWager: await wager.activeWager(player.address),
    };
  }
  it("stores every field of the Wager struct on a valid placement", async function () {
    const tx = await wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT });
    const receipt = await tx.wait();
    const block = await ethers.provider.getBlock(receipt.blockNumber);

    const stored = await wager.getWager(1);
    expect(stored.player).to.equal(players[0].address);
    expect(stored.amount).to.equal(WAGER_AMOUNT);
    expect(stored.potentialPayout).to.equal(GROSS_PAYOUT);
    expect(stored.createdAt).to.equal(block.timestamp);
    expect(stored.score).to.equal(0);
    expect(stored.status).to.equal(PENDING);
  });

  it("emits WagerPlaced with the id, player, stake and potential payout", async function () {
    await expect(wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT }))
      .to.emit(wager, "WagerPlaced")
      .withArgs(1, players[0].address, WAGER_AMOUNT, GROSS_PAYOUT);
  });

  it("assigns sequential wager ids starting at 1", async function () {
    expect(await wager.nextWagerId()).to.equal(0);

    expect(await placePending(players[0])).to.equal(1);
    expect(await placePending(players[1])).to.equal(2);
    expect(await placePending(players[2])).to.equal(3);
  });

  it("computes potentialPayout as (amount * 20000) / 10000", async function () {
    await placePending(players[0]);

    const stored = await wager.getWager(1);
    expect(stored.potentialPayout).to.equal(
      (WAGER_AMOUNT * 20_000n) / 10_000n
    );
    expect(stored.potentialPayout).to.equal(WAGER_AMOUNT * 2n);
  });

  it("doubles a minimum-sized stake exactly", async function () {
    await placePending(players[0], MIN_WAGER);

    const stored = await wager.getWager(1);
    expect(stored.potentialPayout).to.equal(MIN_WAGER * 2n);
    expect(stored.potentialPayout).to.equal(payoutOf(MIN_WAGER));
  });

  it("doubles a maximum-sized stake exactly", async function () {
    await placePending(players[0], MAX_WAGER);

    const stored = await wager.getWager(1);
    expect(stored.potentialPayout).to.equal(MAX_WAGER * 2n);
    expect(stored.potentialPayout).to.equal(ethers.parseEther("20"));
  });

  it("doubles an odd stake with no rounding loss", async function () {
    // 1.337 CELO plus a single wei — the bps math must stay exact.
    const stake = ODD_WAGER + 1n;
    await placePending(players[0], stake);

    const stored = await wager.getWager(1);
    expect(stored.potentialPayout).to.equal(stake * 2n);
  });

  it("exposes the win multiplier as 20000 bps over a 10000 denominator", async function () {
    expect(await wager.WIN_MULTIPLIER_BPS()).to.equal(20_000);
    expect(await wager.BPS_DENOMINATOR()).to.equal(10_000);

    // The pair encodes a flat 2x, which is what placeWager must apply.
    const multiplier = (await wager.WIN_MULTIPLIER_BPS()) / (await wager.BPS_DENOMINATOR());
    expect(multiplier).to.equal(2n);
  });

  it("raises totalPendingLiabilities by the wager's potentialPayout", async function () {
    expect(await wager.totalPendingLiabilities()).to.equal(0);

    await placePending(players[0]);

    expect(await wager.totalPendingLiabilities()).to.equal(GROSS_PAYOUT);
  });

  it("tracks liabilities exactly across mixed stake sizes", async function () {
    await placePending(players[0], MIN_WAGER);
    await placePending(players[1], ODD_WAGER);
    await placePending(players[2], MID_WAGER);

    const expected = payoutOf(MIN_WAGER) + payoutOf(ODD_WAGER) + payoutOf(MID_WAGER);
    expect(await wager.totalPendingLiabilities()).to.equal(expected);
  });

  it("shrinks getHouseReserve by the net house risk, not the full payout", async function () {
    expect(await wager.getHouseReserve()).to.equal(FUND_AMOUNT);

    await placePending(players[0]);

    // The stake itself lands in the contract, so only payout - stake is at risk.
    const netRisk = GROSS_PAYOUT - WAGER_AMOUNT;
    expect(await wager.getHouseReserve()).to.equal(FUND_AMOUNT - netRisk);
  });

  it("increments totalWagersPlaced once per placement", async function () {
    expect(await wager.totalWagersPlaced()).to.equal(0);

    await placePending(players[0]);
    expect(await wager.totalWagersPlaced()).to.equal(1);

    await placePending(players[1]);
    expect(await wager.totalWagersPlaced()).to.equal(2);
  });

  it("reverts a zero-value wager with WagerTooLow", async function () {
    await expect(
      wager.connect(players[0]).placeWager({ value: 0 })
    ).to.be.revertedWithCustomError(wager, "WagerTooLow");
  });

  it("reverts one wei below MIN_WAGER with WagerTooLow", async function () {
    await expect(
      wager.connect(players[0]).placeWager({ value: MIN_WAGER - 1n })
    ).to.be.revertedWithCustomError(wager, "WagerTooLow");
  });

  it("accepts a stake at exactly MIN_WAGER", async function () {
    // The lower bound is inclusive: 0.001 CELO is a valid wager.
    await expect(wager.connect(players[0]).placeWager({ value: MIN_WAGER }))
      .to.emit(wager, "WagerPlaced")
      .withArgs(1, players[0].address, MIN_WAGER, payoutOf(MIN_WAGER));
  });

  it("reverts one wei above MAX_WAGER with WagerTooHigh", async function () {
    await expect(
      wager.connect(players[0]).placeWager({ value: MAX_WAGER + 1n })
    ).to.be.revertedWithCustomError(wager, "WagerTooHigh");
  });

  it("accepts a stake at exactly MAX_WAGER", async function () {
    // The upper bound is inclusive: 10 CELO is a valid wager.
    await expect(wager.connect(players[0]).placeWager({ value: MAX_WAGER }))
      .to.emit(wager, "WagerPlaced")
      .withArgs(1, players[0].address, MAX_WAGER, payoutOf(MAX_WAGER));
  });

  it("exposes MIN_WAGER as 0.001 CELO and MAX_WAGER as 10 CELO", async function () {
    expect(await wager.MIN_WAGER()).to.equal(ethers.parseEther("0.001"));
    expect(await wager.MAX_WAGER()).to.equal(ethers.parseEther("10"));
  });

  it("mutates no state when a below-minimum wager reverts", async function () {
    const before = await readCounters(players[0]);

    await expect(
      wager.connect(players[0]).placeWager({ value: MIN_WAGER - 1n })
    ).to.be.revertedWithCustomError(wager, "WagerTooLow");

    expect(await readCounters(players[0])).to.deep.equal(before);
  });

  it("mutates no state when an above-maximum wager reverts", async function () {
    const before = await readCounters(players[0]);

    await expect(
      wager.connect(players[0]).placeWager({ value: MAX_WAGER + 1n })
    ).to.be.revertedWithCustomError(wager, "WagerTooHigh");

    expect(await readCounters(players[0])).to.deep.equal(before);
  });

  it("reverts a second pending wager with ActiveWagerExists", async function () {
    await placePending(players[0]);

    await expect(
      wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT })
    ).to.be.revertedWithCustomError(wager, "ActiveWagerExists");
  });

  it("keeps the first wager and its liability intact when the second is rejected", async function () {
    const firstId = await placePending(players[0]);

    await expect(
      wager.connect(players[0]).placeWager({ value: MID_WAGER })
    ).to.be.revertedWithCustomError(wager, "ActiveWagerExists");

    expect(await wager.activeWager(players[0].address)).to.equal(firstId);
    expect(await wager.totalPendingLiabilities()).to.equal(GROSS_PAYOUT);
    expect(await wager.totalWagersPlaced()).to.equal(1);
  });

  it("blocks a duplicate wager of any size, not just the same stake", async function () {
    await placePending(players[0], MIN_WAGER);

    // The guard is on the pending status alone; the new amount is irrelevant.
    await expect(
      wager.connect(players[0]).placeWager({ value: MAX_WAGER })
    ).to.be.revertedWithCustomError(wager, "ActiveWagerExists");
  });

  it("lets the player place again after their wager was Won", async function () {
    const wonId = await placeAndResolve(players[0], SCORE_THRESHOLD + 10);
    expect((await wager.getWager(wonId)).status).to.equal(1n); // Won

    await expect(
      wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT })
    ).to.emit(wager, "WagerPlaced");

    expect(await wager.getActiveWager(players[0].address)).to.equal(wonId + 1n);
  });

  it("lets the player place again after their wager was Lost", async function () {
    const lostId = await placeAndResolve(players[0], SCORE_THRESHOLD - 1);
    expect((await wager.getWager(lostId)).status).to.equal(2n); // Lost

    await expect(
      wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT })
    ).to.emit(wager, "WagerPlaced");

    expect(await wager.getActiveWager(players[0].address)).to.equal(lostId + 1n);
  });

  it("lets the player place again after claiming their winnings", async function () {
    const wonId = await placeAndResolve(players[0], SCORE_THRESHOLD + 10);
    await wager.connect(players[0]).claimWinnings(wonId);
    expect((await wager.getWager(wonId)).status).to.equal(4n); // Claimed

    await expect(
      wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT })
    ).to.emit(wager, "WagerPlaced");
  });

  it("repoints activeWager at the replacement wager after a loss", async function () {
    const lostId = await placeAndResolve(players[0], SCORE_THRESHOLD - 1);

    const replacementId = await placePending(players[0]);

    expect(replacementId).to.not.equal(lostId);
    expect(await wager.activeWager(players[0].address)).to.equal(replacementId);
    expect(await wager.getActiveWager(players[0].address)).to.equal(replacementId);
  });

  it("relocks a fresh liability for the replacement wager", async function () {
    await placeAndResolve(players[0], SCORE_THRESHOLD - 1);
    expect(await wager.totalPendingLiabilities()).to.equal(0);

    await placePending(players[0], MID_WAGER);

    expect(await wager.totalPendingLiabilities()).to.equal(payoutOf(MID_WAGER));
    expect(await wager.totalWagersPlaced()).to.equal(2);
  });

  it("reverts InsufficientHouseReserve when an outstanding liability drains the reserve", async function () {
    const bare = await deployBare();

    // The first stake backs its own risk, but leaves nothing over for a second.
    await bare.connect(players[0]).placeWager({ value: WAGER_AMOUNT });

    await expect(
      bare.connect(players[1]).placeWager({ value: WAGER_AMOUNT })
    ).to.be.revertedWithCustomError(bare, "InsufficientHouseReserve");
  });

  it("accepts a wager when the reserve exactly covers the outstanding risk", async function () {
    const bare = await deployBare(WAGER_AMOUNT);

    await bare.connect(players[0]).placeWager({ value: WAGER_AMOUNT });

    // Reserve is exactly the 1 CELO of net risk still owed — the boundary passes.
    await expect(bare.connect(players[1]).placeWager({ value: WAGER_AMOUNT })).to.emit(
      bare,
      "WagerPlaced"
    );
  });

  it("reverts when the reserve is one wei short of the outstanding risk", async function () {
    const bare = await deployBare(WAGER_AMOUNT - 1n);

    await bare.connect(players[0]).placeWager({ value: WAGER_AMOUNT });

    await expect(
      bare.connect(players[1]).placeWager({ value: WAGER_AMOUNT })
    ).to.be.revertedWithCustomError(bare, "InsufficientHouseReserve");
  });

  it("reverts a max wager the thinly funded house cannot cover", async function () {
    const bare = await deployBare(ethers.parseEther("0.5"));

    await bare.connect(players[0]).placeWager({ value: WAGER_AMOUNT });

    // 9.5 CELO of free reserve against 10 CELO of new risk.
    await expect(
      bare.connect(players[1]).placeWager({ value: MAX_WAGER })
    ).to.be.revertedWithCustomError(bare, "InsufficientHouseReserve");
  });

  it("accepts a previously rejected wager once the house is topped up", async function () {
    const bare = await deployBare();
    await bare.connect(players[0]).placeWager({ value: WAGER_AMOUNT });

    await expect(
      bare.connect(players[1]).placeWager({ value: WAGER_AMOUNT })
    ).to.be.revertedWithCustomError(bare, "InsufficientHouseReserve");

    await bare.connect(owner).fundHouse({ value: WAGER_AMOUNT });

    await expect(bare.connect(players[1]).placeWager({ value: WAGER_AMOUNT })).to.emit(
      bare,
      "WagerPlaced"
    );
  });

  it("treats accumulated house edge as locked rather than free reserve", async function () {
    await placeAndResolve(players[0], SCORE_THRESHOLD + 10);

    const edge = await wager.accumulatedHouseEdge();
    expect(edge).to.equal((GROSS_PAYOUT * HOUSE_EDGE_BPS) / BPS_DENOMINATOR);

    // The unclaimed edge is owed to the treasury, so it cannot back new wagers.
    const balance = await ethers.provider.getBalance(await wager.getAddress());
    expect(await wager.getHouseReserve()).to.equal(balance - edge);
    expect(await wager.getHouseReserve()).to.be.lt(balance);
  });

  it("stays solvent while five max wagers are pending at once", async function () {
    for (const player of players) {
      await wager.connect(player).placeWager({ value: MAX_WAGER });
    }

    // Each max wager puts 10 CELO of net risk on the house.
    const netRisk = (payoutOf(MAX_WAGER) - MAX_WAGER) * 5n;
    expect(await wager.totalPendingLiabilities()).to.equal(payoutOf(MAX_WAGER) * 5n);
    expect(await wager.getHouseReserve()).to.equal(FUND_AMOUNT - netRisk);

    const balance = await ethers.provider.getBalance(await wager.getAddress());
    expect(balance).to.be.gte(
      (await wager.totalPendingLiabilities()) + (await wager.accumulatedHouseEdge())
    );
  });

  it("emits HouseFunded and grows the reserve on fundHouse", async function () {
    const topUp = ethers.parseEther("5");

    await expect(wager.connect(owner).fundHouse({ value: topUp }))
      .to.emit(wager, "HouseFunded")
      .withArgs(owner.address, topUp);

    expect(await wager.getHouseReserve()).to.equal(FUND_AMOUNT + topUp);
  });

  it("accepts plain CELO through receive and emits HouseFunded", async function () {
    const topUp = ethers.parseEther("3");

    await expect(
      players[0].sendTransaction({ to: await wager.getAddress(), value: topUp })
    )
      .to.emit(wager, "HouseFunded")
      .withArgs(players[0].address, topUp);

    expect(await wager.getHouseReserve()).to.equal(FUND_AMOUNT + topUp);
  });

  it("reverts a zero-value fundHouse deposit with WagerTooLow", async function () {
    await expect(
      wager.connect(owner).fundHouse({ value: 0 })
    ).to.be.revertedWithCustomError(wager, "WagerTooLow");

    expect(await wager.getHouseReserve()).to.equal(FUND_AMOUNT);
  });

  it("lets any account fund the house, not just the owner", async function () {
    const topUp = ethers.parseEther("7");

    // fundHouse carries no onlyOwner guard — anyone may back the house.
    await expect(wager.connect(players[3]).fundHouse({ value: topUp }))
      .to.emit(wager, "HouseFunded")
      .withArgs(players[3].address, topUp);

    expect(await wager.getHouseReserve()).to.equal(FUND_AMOUNT + topUp);
  });

});

describe("CeloFlashWager — resolveWager outcomes & claimWinnings payouts", function () {
  const SCORE_THRESHOLD = 100;
  const FUND_AMOUNT = ethers.parseEther("100");
  const WAGER_AMOUNT = ethers.parseEther("1");
  const MAX_WAGER = ethers.parseEther("10");
  const WAGER_EXPIRY = 3600;

  const WIN_MULTIPLIER_BPS = 20_000n;
  const HOUSE_EDGE_BPS = 500n;
  const BPS_DENOMINATOR = 10_000n;

  // The gross payout is 2x the stake; the house keeps 500 bps of it on a win.
  const payoutOf = (amount) => (amount * WIN_MULTIPLIER_BPS) / BPS_DENOMINATOR;
  const edgeOf = (gross) => (gross * HOUSE_EDGE_BPS) / BPS_DENOMINATOR;
  const netOf = (gross) => gross - edgeOf(gross);

  const GROSS_PAYOUT = payoutOf(WAGER_AMOUNT);
  const HOUSE_EDGE = edgeOf(GROSS_PAYOUT);
  const NET_PAYOUT = netOf(GROSS_PAYOUT);

  // WagerStatus enum values, mirrored from the contract.
  const PENDING = 0n;
  const WON = 1n;
  const LOST = 2n;
  const EXPIRED = 3n;
  const CLAIMED = 4n;

  let wager;
  let owner;
  let verifier;
  let treasury;
  let houseFunder;
  let players;

  let nonceCounter = 0;
  const uniqueNonce = () => ethers.encodeBytes32String(`rwc-nonce-${nonceCounter++}`);

  async function deployFundedWager() {
    const signers = await ethers.getSigners();
    const [deployer, signer, treasuryAccount] = signers;
    // Reserve deposits are one-way, so they are paid by a signer none of the
    // player accounts below ever touch.
    const funder = signers[signers.length - 1];

    const CeloFlashWager = await ethers.getContractFactory("CeloFlashWager");
    const contract = await CeloFlashWager.deploy(
      signer.address,
      treasuryAccount.address,
      SCORE_THRESHOLD
    );
    await contract.waitForDeployment();

    await contract.connect(funder).fundHouse({ value: FUND_AMOUNT });

    return {
      wager: contract,
      owner: deployer,
      verifier: signer,
      treasury: treasuryAccount,
      houseFunder: funder,
      players: signers.slice(3, 8),
    };
  }

  beforeEach(async function () {
    ({ wager, owner, verifier, treasury, houseFunder, players } =
      await loadFixture(deployFundedWager));
  });

  // The server attestation resolveWager expects: keccak(id, player, score, nonce).
  async function signScore(wagerId, playerAddress, score, nonce, signer = verifier) {
    const messageHash = ethers.solidityPackedKeccak256(
      ["uint256", "address", "uint256", "bytes32"],
      [wagerId, playerAddress, score, nonce]
    );
    return signer.signMessage(ethers.getBytes(messageHash));
  }

  async function placePending(player, amount = WAGER_AMOUNT) {
    await wager.connect(player).placeWager({ value: amount });
    return wager.nextWagerId();
  }

  // Settle `wagerId` for `player` with a freshly signed score.
  async function resolve(player, wagerId, score) {
    const nonce = uniqueNonce();
    const signature = await signScore(wagerId, player.address, score, nonce);
    return wager.connect(player).resolveWager(wagerId, score, nonce, signature);
  }

  async function placeAndResolve(player, score, amount = WAGER_AMOUNT) {
    const wagerId = await placePending(player, amount);
    await resolve(player, wagerId, score);
    return wagerId;
  }

  // Place a wager, clear the threshold, and return the claimable id.
  async function placeAndWin(player, amount = WAGER_AMOUNT) {
    return placeAndResolve(player, SCORE_THRESHOLD + 25, amount);
  }

  async function expectSolvent() {
    const balance = await ethers.provider.getBalance(await wager.getAddress());
    const locked =
      (await wager.totalPendingLiabilities()) + (await wager.accumulatedHouseEdge());
    expect(balance).to.be.gte(locked);
  }


  it("marks a wager Won when the score clears the threshold", async function () {
    const wagerId = await placeAndResolve(players[0], SCORE_THRESHOLD + 50);

    expect((await wager.getWager(wagerId)).status).to.equal(WON);
  });



  it("treats a score exactly at the threshold as a win", async function () {
    // The win condition is score >= scoreThreshold, so the boundary wins.
    const wagerId = await placeAndResolve(players[0], SCORE_THRESHOLD);

    expect((await wager.getWager(wagerId)).status).to.equal(WON);
  });



  it("marks a wager Lost one point below the threshold", async function () {
    const wagerId = await placeAndResolve(players[0], SCORE_THRESHOLD - 1);

    expect((await wager.getWager(wagerId)).status).to.equal(LOST);
  });



  it("stores the attested score on the wager", async function () {
    const wagerId = await placeAndResolve(players[0], 175);

    expect((await wager.getWager(wagerId)).score).to.equal(175n);
  });



  it("adds 5% of the gross payout to accumulatedHouseEdge on a win", async function () {
    await placeAndWin(players[0]);

    expect(await wager.accumulatedHouseEdge()).to.equal(HOUSE_EDGE);
    // 1 CELO staked -> 2 CELO gross -> 0.1 CELO edge.
    expect(HOUSE_EDGE).to.equal(ethers.parseEther("0.1"));
  });



  it("accrues no house edge on a loss", async function () {
    await placeAndResolve(players[0], SCORE_THRESHOLD - 40);

    expect(await wager.accumulatedHouseEdge()).to.equal(0);
  });



  it("emits WagerResolved with the Won status and the net payout", async function () {
    const wagerId = await placePending(players[0]);
    const score = SCORE_THRESHOLD + 10;

    // The event carries the net payout, i.e. gross minus the house edge.
    await expect(resolve(players[0], wagerId, score))
      .to.emit(wager, "WagerResolved")
      .withArgs(wagerId, players[0].address, score, WON, NET_PAYOUT);
  });



  it("emits WagerResolved with the Lost status and a zero payout", async function () {
    const wagerId = await placePending(players[0]);
    const score = SCORE_THRESHOLD - 10;

    await expect(resolve(players[0], wagerId, score))
      .to.emit(wager, "WagerResolved")
      .withArgs(wagerId, players[0].address, score, LOST, 0);
  });



  it("increments totalWagersWon on a win", async function () {
    expect(await wager.totalWagersWon()).to.equal(0);

    await placeAndWin(players[0]);

    expect(await wager.totalWagersWon()).to.equal(1);
  });



  it("leaves totalWagersWon untouched on a loss", async function () {
    await placeAndWin(players[0]);
    await placeAndResolve(players[1], SCORE_THRESHOLD - 1);
    await placeAndResolve(players[2], 0);

    // Three wagers placed, only the first one counts as a win.
    expect(await wager.totalWagersWon()).to.equal(1);
    expect(await wager.totalWagersPlaced()).to.equal(3);
  });



  it("drops totalPendingLiabilities by potentialPayout on a win", async function () {
    const wagerId = await placePending(players[0]);
    expect(await wager.totalPendingLiabilities()).to.equal(GROSS_PAYOUT);

    await resolve(players[0], wagerId, SCORE_THRESHOLD + 1);

    expect(await wager.totalPendingLiabilities()).to.equal(0);
  });



  it("drops totalPendingLiabilities by potentialPayout on a loss", async function () {
    const wagerId = await placePending(players[0], MAX_WAGER);
    const gross = payoutOf(MAX_WAGER);
    expect(await wager.totalPendingLiabilities()).to.equal(gross);

    await resolve(players[0], wagerId, SCORE_THRESHOLD - 1);

    expect(await wager.totalPendingLiabilities()).to.equal(0);
  });



  it("unwinds liabilities one wager at a time across several players", async function () {
    const first = await placePending(players[0]);
    const second = await placePending(players[1], MAX_WAGER);
    const third = await placePending(players[2]);

    const total = GROSS_PAYOUT * 2n + payoutOf(MAX_WAGER);
    expect(await wager.totalPendingLiabilities()).to.equal(total);

    await resolve(players[1], second, SCORE_THRESHOLD + 5);
    expect(await wager.totalPendingLiabilities()).to.equal(total - payoutOf(MAX_WAGER));

    await resolve(players[0], first, SCORE_THRESHOLD - 5);
    await resolve(players[2], third, SCORE_THRESHOLD);

    expect(await wager.totalPendingLiabilities()).to.equal(0);
  });



  it("moves no CELO at resolution time — winnings must be pulled", async function () {
    const wagerId = await placePending(players[0]);

    await expect(resolve(players[0], wagerId, SCORE_THRESHOLD + 5)).to.changeEtherBalance(
      wager,
      0
    );

    expect((await wager.getWager(wagerId)).status).to.equal(WON);
  });



  it("reverts NoActiveWager when another player resolves the wager", async function () {
    const wagerId = await placePending(players[0]);
    const score = SCORE_THRESHOLD + 5;
    const nonce = uniqueNonce();
    // The attestation is bound to the real player, but the caller is not them.
    const signature = await signScore(wagerId, players[0].address, score, nonce);

    await expect(
      wager.connect(players[1]).resolveWager(wagerId, score, nonce, signature)
    ).to.be.revertedWithCustomError(wager, "NoActiveWager");
  });



  it("reverts NoActiveWager when the owner resolves on a player's behalf", async function () {
    const wagerId = await placePending(players[0]);
    const score = SCORE_THRESHOLD + 5;
    const nonce = uniqueNonce();
    const signature = await signScore(wagerId, players[0].address, score, nonce);

    // Ownership grants no authority over an individual wager.
    await expect(
      wager.connect(owner).resolveWager(wagerId, score, nonce, signature)
    ).to.be.revertedWithCustomError(wager, "NoActiveWager");

    expect((await wager.getWager(wagerId)).status).to.equal(PENDING);
  });



  it("reverts WagerNotPending when a won wager is resolved twice", async function () {
    const wagerId = await placeAndWin(players[0]);

    await expect(
      resolve(players[0], wagerId, SCORE_THRESHOLD + 5)
    ).to.be.revertedWithCustomError(wager, "WagerNotPending");
  });



  it("reverts WagerNotPending when a lost wager is resolved twice", async function () {
    const wagerId = await placeAndResolve(players[0], SCORE_THRESHOLD - 1);

    // A loss is final — it cannot be re-attested into a win.
    await expect(
      resolve(players[0], wagerId, SCORE_THRESHOLD + 100)
    ).to.be.revertedWithCustomError(wager, "WagerNotPending");

    expect((await wager.getWager(wagerId)).status).to.equal(LOST);
  });



  it("reverts NoActiveWager for an unknown wager id", async function () {
    const unknownId = 9999;
    const score = SCORE_THRESHOLD + 5;
    const nonce = uniqueNonce();
    const signature = await signScore(unknownId, players[0].address, score, nonce);

    // An unwritten slot reads as Pending with a zero player, so the caller
    // check is what rejects it.
    await expect(
      wager.connect(players[0]).resolveWager(unknownId, score, nonce, signature)
    ).to.be.revertedWithCustomError(wager, "NoActiveWager");
  });



  it("reverts NonceAlreadyUsed when a nonce is replayed", async function () {
    const score = SCORE_THRESHOLD + 5;
    const nonce = uniqueNonce();

    const first = await placePending(players[0]);
    let signature = await signScore(first, players[0].address, score, nonce);
    await wager.connect(players[0]).resolveWager(first, score, nonce, signature);

    const second = await placePending(players[1]);
    signature = await signScore(second, players[1].address, score, nonce);

    await expect(
      wager.connect(players[1]).resolveWager(second, score, nonce, signature)
    ).to.be.revertedWithCustomError(wager, "NonceAlreadyUsed");
  });



  it("reverts InvalidSignature when the score is signed by a non-verifier", async function () {
    const wagerId = await placePending(players[0]);
    const score = SCORE_THRESHOLD + 5;
    const nonce = uniqueNonce();
    const signature = await signScore(
      wagerId,
      players[0].address,
      score,
      nonce,
      players[0]
    );

    await expect(
      wager.connect(players[0]).resolveWager(wagerId, score, nonce, signature)
    ).to.be.revertedWithCustomError(wager, "InvalidSignature");
  });



  it("reverts InvalidSignature when the submitted score differs from the signed one", async function () {
    const wagerId = await placePending(players[0]);
    const nonce = uniqueNonce();
    // Signed for a losing score, submitted as a winning one.
    const signature = await signScore(
      wagerId,
      players[0].address,
      SCORE_THRESHOLD - 1,
      nonce
    );

    await expect(
      wager
        .connect(players[0])
        .resolveWager(wagerId, SCORE_THRESHOLD + 500, nonce, signature)
    ).to.be.revertedWithCustomError(wager, "InvalidSignature");
  });



  it("reverts resolveWager while the contract is paused", async function () {
    const wagerId = await placePending(players[0]);
    await wager.connect(owner).pause();

    await expect(
      resolve(players[0], wagerId, SCORE_THRESHOLD + 5)
    ).to.be.revertedWithCustomError(wager, "EnforcedPause");
  });



  it("records the attestation nonce as used", async function () {
    const wagerId = await placePending(players[0]);
    const score = SCORE_THRESHOLD + 5;
    const nonce = uniqueNonce();
    expect(await wager.usedNonces(nonce)).to.equal(false);

    const signature = await signScore(wagerId, players[0].address, score, nonce);
    await wager.connect(players[0]).resolveWager(wagerId, score, nonce, signature);

    expect(await wager.usedNonces(nonce)).to.equal(true);
  });



  it("clears getActiveWager once a wager is won", async function () {
    const wagerId = await placePending(players[0]);
    expect(await wager.getActiveWager(players[0].address)).to.equal(wagerId);

    await resolve(players[0], wagerId, SCORE_THRESHOLD + 5);

    expect(await wager.getActiveWager(players[0].address)).to.equal(0);
  });



  it("clears getActiveWager once a wager is lost", async function () {
    const wagerId = await placePending(players[0]);
    expect(await wager.getActiveWager(players[0].address)).to.equal(wagerId);

    await resolve(players[0], wagerId, SCORE_THRESHOLD - 1);

    // activeWager still points at the id, but it is no longer pending.
    expect(await wager.getActiveWager(players[0].address)).to.equal(0);
    expect(await wager.activeWager(players[0].address)).to.equal(wagerId);
  });



  it("applies a raised scoreThreshold to later resolutions", async function () {
    await wager.connect(owner).setScoreThreshold(500);
    const wagerId = await placeAndResolve(players[0], 400);

    // 400 would have won under the original threshold of 100.
    expect((await wager.getWager(wagerId)).status).to.equal(LOST);
    expect(await wager.totalWagersWon()).to.equal(0);
  });



  it("applies a lowered scoreThreshold to later resolutions", async function () {
    await wager.connect(owner).setScoreThreshold(10);
    const wagerId = await placeAndResolve(players[0], 10);

    expect((await wager.getWager(wagerId)).status).to.equal(WON);
    expect(await wager.accumulatedHouseEdge()).to.equal(HOUSE_EDGE);
  });



  it("accrues house edge across successive wins", async function () {
    await placeAndWin(players[0]);
    await placeAndWin(players[1], MAX_WAGER);
    await placeAndWin(players[2]);

    const expected = HOUSE_EDGE * 2n + edgeOf(payoutOf(MAX_WAGER));
    expect(await wager.accumulatedHouseEdge()).to.equal(expected);
    expect(await wager.totalWagersWon()).to.equal(3);
  });



  it("keeps the forfeited stake in the house reserve after a loss", async function () {
    await placeAndResolve(players[0], SCORE_THRESHOLD - 1);

    // Nothing is locked any more, so the whole balance is reserve again.
    expect(await wager.totalPendingLiabilities()).to.equal(0);
    expect(await wager.getHouseReserve()).to.equal(FUND_AMOUNT + WAGER_AMOUNT);
    await expectSolvent();
  });



  it("transfers potentialPayout less 500 bps to the winner", async function () {
    const wagerId = await placeAndWin(players[0]);

    // 1 CELO staked -> 2 CELO gross -> 1.9 CELO net.
    expect(NET_PAYOUT).to.equal(ethers.parseEther("1.9"));
    await expect(
      wager.connect(players[0]).claimWinnings(wagerId)
    ).to.changeEtherBalances([wager, players[0]], [-NET_PAYOUT, NET_PAYOUT]);
  });



  it("sets the wager status to Claimed", async function () {
    const wagerId = await placeAndWin(players[0]);

    await wager.connect(players[0]).claimWinnings(wagerId);

    expect((await wager.getWager(wagerId)).status).to.equal(CLAIMED);
  });



  it("emits WagerClaimed with the net payout", async function () {
    const wagerId = await placeAndWin(players[0]);

    await expect(wager.connect(players[0]).claimWinnings(wagerId))
      .to.emit(wager, "WagerClaimed")
      .withArgs(wagerId, players[0].address, NET_PAYOUT);
  });



  it("reverts WagerNotWon on a second claim", async function () {
    const wagerId = await placeAndWin(players[0]);
    await wager.connect(players[0]).claimWinnings(wagerId);

    // The status is Claimed by now, so the Won check rejects the replay.
    await expect(
      wager.connect(players[0]).claimWinnings(wagerId)
    ).to.be.revertedWithCustomError(wager, "WagerNotWon");
  });



  it("reverts WagerNotWon when claiming a lost wager", async function () {
    const wagerId = await placeAndResolve(players[0], SCORE_THRESHOLD - 1);

    await expect(
      wager.connect(players[0]).claimWinnings(wagerId)
    ).to.be.revertedWithCustomError(wager, "WagerNotWon");
  });



  it("reverts WagerNotWon when claiming a wager that is still pending", async function () {
    const wagerId = await placePending(players[0]);

    await expect(
      wager.connect(players[0]).claimWinnings(wagerId)
    ).to.be.revertedWithCustomError(wager, "WagerNotWon");
  });



  it("reverts WagerNotWon when claiming an expired wager", async function () {
    const wagerId = await placePending(players[0]);
    await time.increase(WAGER_EXPIRY + 1);
    await wager.connect(players[0]).expireWager(wagerId);

    expect((await wager.getWager(wagerId)).status).to.equal(EXPIRED);
    await expect(
      wager.connect(players[0]).claimWinnings(wagerId)
    ).to.be.revertedWithCustomError(wager, "WagerNotWon");
  });



  it("reverts NoActiveWager when someone other than the player claims", async function () {
    const wagerId = await placeAndWin(players[0]);

    await expect(
      wager.connect(players[1]).claimWinnings(wagerId)
    ).to.be.revertedWithCustomError(wager, "NoActiveWager");
    await expect(
      wager.connect(owner).claimWinnings(wagerId)
    ).to.be.revertedWithCustomError(wager, "NoActiveWager");

    // The winner's claim survives the failed attempts intact.
    expect((await wager.getWager(wagerId)).status).to.equal(WON);
  });

});
