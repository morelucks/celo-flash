const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("CeloFlashWager — placeWager", function () {
  const SCORE_THRESHOLD = 100;
  const FUND_AMOUNT = ethers.parseEther("100");
  const WAGER_AMOUNT = ethers.parseEther("1");
  const MIN_WAGER = ethers.parseEther("0.001");
  const MAX_WAGER = ethers.parseEther("10");
  const WIN_MULTIPLIER_BPS = 20_000n;
  const BPS_DENOMINATOR = 10_000n;

  const GROSS_PAYOUT = (WAGER_AMOUNT * WIN_MULTIPLIER_BPS) / BPS_DENOMINATOR;

  const PENDING = 0n;

  let wager, owner, verifier, treasury, players;
  let nonceCounter = 0;

  beforeEach(async function () {
    [owner, verifier, treasury, ...players] = await ethers.getSigners();
    players = players.slice(0, 5);

    const CeloFlashWager = await ethers.getContractFactory("CeloFlashWager");
    wager = await CeloFlashWager.deploy(verifier.address, treasury.address, SCORE_THRESHOLD);
    await wager.waitForDeployment();

    await wager.fundHouse({ value: FUND_AMOUNT });
  });

  const uniqueNonce = () => ethers.encodeBytes32String(`pw-nonce-${nonceCounter++}`);

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

  it("stores the player on a valid wager", async function () {
    await wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT });
    const w = await wager.getWager(1);
    expect(w.player).to.equal(players[0].address);
  });

  it("stores the staked amount on a valid wager", async function () {
    await wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT });
    const w = await wager.getWager(1);
    expect(w.amount).to.equal(WAGER_AMOUNT);
  });

  it("sets potentialPayout to exactly 2x the stake", async function () {
    await wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT });
    const w = await wager.getWager(1);
    expect(w.potentialPayout).to.equal(GROSS_PAYOUT);
    expect(w.potentialPayout).to.equal(WAGER_AMOUNT * 2n);
  });

  it("records createdAt as the block timestamp", async function () {
    const tx = await wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT });
    const rc = await tx.wait();
    const block = await ethers.provider.getBlock(rc.blockNumber);
    const w = await wager.getWager(1);
    expect(w.createdAt).to.equal(block.timestamp);
  });

  it("initializes the score to zero", async function () {
    await wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT });
    const w = await wager.getWager(1);
    expect(w.score).to.equal(0);
  });

  it("marks a new wager as Pending", async function () {
    await wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT });
    const w = await wager.getWager(1);
    expect(w.status).to.equal(PENDING);
  });

  it("assigns an incrementing wager id", async function () {
    await wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT });
    expect(await wager.nextWagerId()).to.equal(1);
    await wager.connect(players[1]).placeWager({ value: WAGER_AMOUNT });
    expect(await wager.nextWagerId()).to.equal(2);
  });

  it("points activeWager at the new wager id", async function () {
    await wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT });
    expect(await wager.activeWager(players[0].address)).to.equal(1);
  });

  it("exposes the pending wager via getActiveWager", async function () {
    await wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT });
    expect(await wager.getActiveWager(players[0].address)).to.equal(1);
  });

  it("emits WagerPlaced with the correct args", async function () {
    await expect(wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT }))
      .to.emit(wager, "WagerPlaced")
      .withArgs(1, players[0].address, WAGER_AMOUNT, GROSS_PAYOUT);
  });

  it("credits the stake to the contract balance", async function () {
    await expect(
      wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT })
    ).to.changeEtherBalance(wager, WAGER_AMOUNT);
  });

  it("pays exactly 2x on a minimum-size stake", async function () {
    await wager.connect(players[0]).placeWager({ value: MIN_WAGER });
    const w = await wager.getWager(1);
    expect(w.potentialPayout).to.equal(MIN_WAGER * 2n);
  });

  it("pays exactly 2x on a maximum-size stake", async function () {
    await wager.connect(players[0]).placeWager({ value: MAX_WAGER });
    const w = await wager.getWager(1);
    expect(w.potentialPayout).to.equal(MAX_WAGER * 2n);
  });

  it("pays exactly 2x on an arbitrary stake", async function () {
    const stake = ethers.parseEther("0.37");
    await wager.connect(players[0]).placeWager({ value: stake });
    const w = await wager.getWager(1);
    expect(w.potentialPayout).to.equal((stake * WIN_MULTIPLIER_BPS) / BPS_DENOMINATOR);
    expect(w.potentialPayout).to.equal(stake * 2n);
  });

  it("raises totalPendingLiabilities by the potential payout", async function () {
    expect(await wager.totalPendingLiabilities()).to.equal(0);
    await wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT });
    expect(await wager.totalPendingLiabilities()).to.equal(GROSS_PAYOUT);
  });

  it("accumulates liabilities across multiple players", async function () {
    await wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT });
    await wager.connect(players[1]).placeWager({ value: WAGER_AMOUNT });
    expect(await wager.totalPendingLiabilities()).to.equal(GROSS_PAYOUT * 2n);
  });

  it("increments totalWagersPlaced", async function () {
    expect(await wager.totalWagersPlaced()).to.equal(0);
    await wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT });
    expect(await wager.totalWagersPlaced()).to.equal(1);
  });

  it("keeps totalWagersPlaced counting across wagers", async function () {
    await wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT });
    await wager.connect(players[1]).placeWager({ value: WAGER_AMOUNT });
    await wager.connect(players[2]).placeWager({ value: WAGER_AMOUNT });
    expect(await wager.totalWagersPlaced()).to.equal(3);
  });

  it("reverts a zero-value wager with WagerTooLow", async function () {
    await expect(
      wager.connect(players[0]).placeWager({ value: 0 })
    ).to.be.revertedWithCustomError(wager, "WagerTooLow");
  });

  it("reverts just below MIN_WAGER with WagerTooLow", async function () {
    await expect(
      wager.connect(players[0]).placeWager({ value: MIN_WAGER - 1n })
    ).to.be.revertedWithCustomError(wager, "WagerTooLow");
  });

  it("accepts a stake at exactly MIN_WAGER", async function () {
    await wager.connect(players[0]).placeWager({ value: MIN_WAGER });
    const w = await wager.getWager(1);
    expect(w.amount).to.equal(MIN_WAGER);
  });

  it("reverts just above MAX_WAGER with WagerTooHigh", async function () {
    await expect(
      wager.connect(players[0]).placeWager({ value: MAX_WAGER + 1n })
    ).to.be.revertedWithCustomError(wager, "WagerTooHigh");
  });

  it("accepts a stake at exactly MAX_WAGER", async function () {
    await wager.connect(players[0]).placeWager({ value: MAX_WAGER });
    const w = await wager.getWager(1);
    expect(w.amount).to.equal(MAX_WAGER);
  });

  it("reverts a second pending wager with ActiveWagerExists", async function () {
    await wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT });
    await expect(
      wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT })
    ).to.be.revertedWithCustomError(wager, "ActiveWagerExists");
  });

  it("allows different players to hold pending wagers simultaneously", async function () {
    await wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT });
    await wager.connect(players[1]).placeWager({ value: WAGER_AMOUNT });
    expect(await wager.getActiveWager(players[0].address)).to.equal(1);
    expect(await wager.getActiveWager(players[1].address)).to.equal(2);
  });

  it("reverts when the house reserve is insufficient", async function () {
    const Factory = await ethers.getContractFactory("CeloFlashWager");
    const bare = await Factory.deploy(verifier.address, treasury.address, SCORE_THRESHOLD);
    await bare.waitForDeployment();

    await bare.connect(players[0]).placeWager({ value: WAGER_AMOUNT });
    await expect(
      bare.connect(players[1]).placeWager({ value: WAGER_AMOUNT })
    ).to.be.revertedWithCustomError(bare, "InsufficientHouseReserve");
  });

  it("accepts a wager when the reserve exactly covers the risk", async function () {
    const Factory = await ethers.getContractFactory("CeloFlashWager");
    const bare = await Factory.deploy(verifier.address, treasury.address, SCORE_THRESHOLD);
    await bare.waitForDeployment();
    await bare.fundHouse({ value: WAGER_AMOUNT });

    await bare.connect(players[0]).placeWager({ value: WAGER_AMOUNT });
    await expect(
      bare.connect(players[1]).placeWager({ value: WAGER_AMOUNT })
    ).to.not.be.reverted;
    expect(await bare.getActiveWager(players[1].address)).to.equal(2);
  });

  it("reverts when the reserve is one wei short of the risk", async function () {
    const Factory = await ethers.getContractFactory("CeloFlashWager");
    const bare = await Factory.deploy(verifier.address, treasury.address, SCORE_THRESHOLD);
    await bare.waitForDeployment();
    await bare.fundHouse({ value: WAGER_AMOUNT - 1n });

    await bare.connect(players[0]).placeWager({ value: WAGER_AMOUNT });
    await expect(
      bare.connect(players[1]).placeWager({ value: WAGER_AMOUNT })
    ).to.be.revertedWithCustomError(bare, "InsufficientHouseReserve");
  });

  it("lets a player wager again after a win", async function () {
    await placeAndResolve(players[0], SCORE_THRESHOLD + 10);
    await expect(
      wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT })
    ).to.not.be.reverted;
    expect(await wager.getActiveWager(players[0].address)).to.equal(2);
  });

  it("lets a player wager again after a loss", async function () {
    await placeAndResolve(players[0], SCORE_THRESHOLD - 1);
    await expect(
      wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT })
    ).to.not.be.reverted;
    expect(await wager.getActiveWager(players[0].address)).to.equal(2);
  });

  it("lets a player wager again after an expiry", async function () {
    await wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT });
    const id = await wager.getActiveWager(players[0].address);
    await time.increase(3600 + 1);
    await wager.expireWager(id);

    await expect(
      wager.connect(players[0]).placeWager({ value: WAGER_AMOUNT })
    ).to.not.be.reverted;
    expect(await wager.getActiveWager(players[0].address)).to.equal(2);
  });
});
