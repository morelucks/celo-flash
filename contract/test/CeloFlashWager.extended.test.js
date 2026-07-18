const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("CeloFlashWager — Extended House Edge & Accounting Coverage", function () {
  const SCORE_THRESHOLD = 100;
  const FUND_AMOUNT = ethers.parseEther("100");
  const WAGER_AMOUNT = ethers.parseEther("1");
  const MIN_WAGER = ethers.parseEther("0.001");
  const WIN_MULTIPLIER_BPS = 20_000n;
  const HOUSE_EDGE_BPS = 500n;
  const BPS_DENOMINATOR = 10_000n;

  const GROSS_PAYOUT = (WAGER_AMOUNT * WIN_MULTIPLIER_BPS) / BPS_DENOMINATOR;
  const EDGE_PER_WIN = (GROSS_PAYOUT * HOUSE_EDGE_BPS) / BPS_DENOMINATOR;
  const NET_PAYOUT = GROSS_PAYOUT - EDGE_PER_WIN;

  let wager, owner, verifier, treasury, players;
  let nonceCounter = 0;
  const uniqueNonce = () => ethers.encodeBytes32String(`xw-nonce-${nonceCounter++}`);

  async function signScore(wagerId, addr, score, nonce) {
    const h = ethers.solidityPackedKeccak256(
      ["uint256", "address", "uint256", "bytes32"],
      [wagerId, addr, score, nonce]
    );
    return verifier.signMessage(ethers.getBytes(h));
  }

  async function placeAndResolve(player, score) {
    await wager.connect(player).placeWager({ value: WAGER_AMOUNT });
    const wagerId = await wager.nextWagerId();
    const nonce = uniqueNonce();
    const sig = await signScore(wagerId, player.address, score, nonce);
    await wager.connect(player).resolveWager(wagerId, score, nonce, sig);
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

  it("routes the house edge to a rotated treasury", async function () {
    await placeAndResolve(players[0], SCORE_THRESHOLD + 50);
    expect(await wager.accumulatedHouseEdge()).to.equal(EDGE_PER_WIN);

    await wager.connect(owner).setTreasury(players[1].address);

    await expect(wager.withdrawHouseEdge()).to.changeEtherBalances(
      [treasury, players[1]],
      [0n, EDGE_PER_WIN]
    );
    expect(await wager.accumulatedHouseEdge()).to.equal(0);
  });

  it("sweeps only edge accrued since the previous withdrawal", async function () {
    await placeAndResolve(players[0], SCORE_THRESHOLD + 10);
    await expect(wager.withdrawHouseEdge()).to.changeEtherBalances(
      [wager, treasury],
      [-EDGE_PER_WIN, EDGE_PER_WIN]
    );
    expect(await wager.accumulatedHouseEdge()).to.equal(0);

    await placeAndResolve(players[1], SCORE_THRESHOLD + 10);
    expect(await wager.accumulatedHouseEdge()).to.equal(EDGE_PER_WIN);
    await expect(wager.withdrawHouseEdge()).to.changeEtherBalances(
      [wager, treasury],
      [-EDGE_PER_WIN, EDGE_PER_WIN]
    );
    expect(await wager.accumulatedHouseEdge()).to.equal(0);
    await expectSolvent();
  });

  it("withdraws edge without touching a pending wager's liability", async function () {
    await wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT });
    const pendingId = await wager.getActiveWager(players[0].address);
    expect(await wager.totalPendingLiabilities()).to.equal(GROSS_PAYOUT);

    const wonId = await placeAndResolve(players[1], SCORE_THRESHOLD + 10);
    expect(await wager.accumulatedHouseEdge()).to.equal(EDGE_PER_WIN);

    await wager.withdrawHouseEdge();
    expect(await wager.accumulatedHouseEdge()).to.equal(0);
    expect(await wager.totalPendingLiabilities()).to.equal(GROSS_PAYOUT);
    await expectSolvent();

    await expect(wager.connect(players[1]).claimWinnings(wonId)).to.changeEtherBalance(
      players[1],
      NET_PAYOUT
    );
    await expectSolvent();

    await time.increase(3600 + 1);
    await expect(wager.expireWager(pendingId)).to.changeEtherBalance(
      players[0],
      WAGER_AMOUNT
    );
    await expectSolvent();
    expect(await wager.totalPendingLiabilities()).to.equal(0);
  });

  it("grows the reserve and emits HouseFunded on fundHouse", async function () {
    const extra = ethers.parseEther("5");
    await expect(wager.fundHouse({ value: extra }))
      .to.emit(wager, "HouseFunded")
      .withArgs(owner.address, extra);
    expect(await wager.getHouseReserve()).to.equal(FUND_AMOUNT + extra);
  });

  it("reverts fundHouse on a zero deposit", async function () {
    await expect(wager.fundHouse({ value: 0 })).to.be.revertedWithCustomError(
      wager,
      "WagerTooLow"
    );
  });

  it("accepts direct CELO via receive and emits HouseFunded", async function () {
    const extra = ethers.parseEther("3");
    await expect(
      owner.sendTransaction({ to: await wager.getAddress(), value: extra })
    )
      .to.emit(wager, "HouseFunded")
      .withArgs(owner.address, extra);
    expect(await wager.getHouseReserve()).to.equal(FUND_AMOUNT + extra);
  });

  it("reverts setTreasury on the zero address", async function () {
    await expect(
      wager.connect(owner).setTreasury(ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(wager, "InvalidAddress");
  });

  it("reverts setTreasury for a non-owner", async function () {
    await expect(
      wager.connect(players[0]).setTreasury(players[0].address)
    ).to.be.revertedWithCustomError(wager, "OwnableUnauthorizedAccount");
  });
});
