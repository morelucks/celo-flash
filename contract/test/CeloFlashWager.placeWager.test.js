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
});
