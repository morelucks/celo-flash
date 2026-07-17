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
});
