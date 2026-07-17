const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("CeloFlashTournament — Fee Withdrawal & Accounting", function () {
  const ENTRY_FEE = ethers.parseEther("10");
  const SEED_AMOUNT = ethers.parseEther("20");
  const DURATION = 3600; // 1 hour (MIN_DURATION)
  const PROTOCOL_FEE_BPS = 500n;
  const BPS_DENOMINATOR = 10_000n;

  // 5% of each entry fee
  const FEE_PER_ENTRY = (ENTRY_FEE * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
  const PRIZE_PER_ENTRY = ENTRY_FEE - FEE_PER_ENTRY;

  let tournament;
  let usdm;
  let owner;
  let verifier;
  let feeRecipient;
  let creator;
  let players;

  let nonceCounter = 0;

  function uniqueNonce() {
    return ethers.encodeBytes32String(`nonce-${nonceCounter++}`);
  }

  async function signScore(tournamentId, playerAddress, score, nonce) {
    const messageHash = ethers.solidityPackedKeccak256(
      ["uint256", "address", "uint256", "bytes32"],
      [tournamentId, playerAddress, score, nonce]
    );
    return verifier.signMessage(ethers.getBytes(messageHash));
  }

  async function createTournament({ isNative = false, seed = SEED_AMOUNT, entryFee = ENTRY_FEE } = {}) {
    const tournamentId = await tournament.nextTournamentId();
    await tournament
      .connect(creator)
      .createTournament("Test Tournament", entryFee, seed, DURATION, isNative, {
        value: isNative ? seed : 0n,
      });
    return tournamentId;
  }

  async function joinAll(tournamentId, joiners, isNative) {
    for (const player of joiners) {
      await tournament.connect(player).joinTournament(tournamentId, {
        value: isNative ? ENTRY_FEE : 0n,
      });
    }
  }

  beforeEach(async function () {
    [owner, verifier, feeRecipient, creator, ...players] = await ethers.getSigners();
    players = players.slice(0, 5);

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdm = await MockERC20.deploy("Mock USDm", "USDm", 18);
    await usdm.waitForDeployment();

    const CeloFlashTournament = await ethers.getContractFactory("CeloFlashTournament");
    tournament = await CeloFlashTournament.deploy(
      await usdm.getAddress(),
      verifier.address,
      feeRecipient.address
    );
    await tournament.waitForDeployment();

    await usdm.mint(creator.address, ethers.parseEther("1000"));
    await usdm.connect(creator).approve(await tournament.getAddress(), ethers.MaxUint256);

    for (const player of players) {
      await usdm.mint(player.address, ethers.parseEther("1000"));
      await usdm.connect(player).approve(await tournament.getAddress(), ethers.MaxUint256);
    }
  });

  describe("Fee accumulation", function () {
    it("Should accumulate 5% of each USDm entry into accumulatedFees", async function () {
      const id = await createTournament();
      await joinAll(id, players, false);

      expect(await tournament.accumulatedFees()).to.equal(FEE_PER_ENTRY * 5n);
      expect(await tournament.accumulatedNativeFees()).to.equal(0);
    });

    it("Should accumulate 5% of each native CELO entry into accumulatedNativeFees", async function () {
      const id = await createTournament({ isNative: true });
      await joinAll(id, players, true);

      expect(await tournament.accumulatedNativeFees()).to.equal(FEE_PER_ENTRY * 5n);
      expect(await tournament.accumulatedFees()).to.equal(0);
    });
  });

  describe("withdrawFees — USDm", function () {
    let id;
    let expectedFees;

    beforeEach(async function () {
      id = await createTournament();
      await joinAll(id, players, false);
      expectedFees = FEE_PER_ENTRY * 5n;
    });

    it("Should transfer accumulated USDm fees to feeRecipient and reset to 0", async function () {
      await expect(tournament.withdrawFees()).to.changeTokenBalances(
        usdm,
        [tournament, feeRecipient],
        [-expectedFees, expectedFees]
      );

      expect(await tournament.accumulatedFees()).to.equal(0);
    });

    it("Should emit FeesWithdrawn with isNative = false", async function () {
      await expect(tournament.withdrawFees())
        .to.emit(tournament, "FeesWithdrawn")
        .withArgs(feeRecipient.address, expectedFees, false);
    });

    it("Should emit exactly one FeesWithdrawn event when only the USDm pool is non-zero", async function () {
      const tx = await tournament.withdrawFees();
      const receipt = await tx.wait();

      const feeEvents = receipt.logs
        .map((log) => {
          try {
            return tournament.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .filter((parsed) => parsed && parsed.name === "FeesWithdrawn");

      expect(feeEvents.length).to.equal(1);
      expect(feeEvents[0].args.isNative).to.equal(false);
    });
  });
});
