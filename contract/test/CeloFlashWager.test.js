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
});
