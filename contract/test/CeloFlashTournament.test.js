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

    it("Should revert on a second withdrawal since the pool was reset", async function () {
      await tournament.withdrawFees();
      await expect(tournament.withdrawFees()).to.be.revertedWithCustomError(
        tournament,
        "NoFeesToWithdraw"
      );
    });
  });

  describe("withdrawFees — native CELO", function () {
    let id;
    let expectedFees;

    beforeEach(async function () {
      id = await createTournament({ isNative: true });
      await joinAll(id, players, true);
      expectedFees = FEE_PER_ENTRY * 5n;
    });

    it("Should natively transfer accumulated CELO fees to feeRecipient and reset to 0", async function () {
      await expect(tournament.withdrawFees()).to.changeEtherBalances(
        [tournament, feeRecipient],
        [-expectedFees, expectedFees]
      );

      expect(await tournament.accumulatedNativeFees()).to.equal(0);
    });

    it("Should emit FeesWithdrawn with isNative = true", async function () {
      await expect(tournament.withdrawFees())
        .to.emit(tournament, "FeesWithdrawn")
        .withArgs(feeRecipient.address, expectedFees, true);
    });
  });

  describe("withdrawFees — both pools", function () {
    let expectedUsdmFees;
    let expectedNativeFees;

    beforeEach(async function () {
      const usdmId = await createTournament();
      await joinAll(usdmId, players, false);
      expectedUsdmFees = FEE_PER_ENTRY * 5n;

      const nativeId = await createTournament({ isNative: true });
      await joinAll(nativeId, players.slice(0, 3), true);
      expectedNativeFees = FEE_PER_ENTRY * 3n;
    });

    it("Should withdraw both pools in a single call", async function () {
      const tx = tournament.withdrawFees();

      await expect(tx).to.changeTokenBalances(
        usdm,
        [tournament, feeRecipient],
        [-expectedUsdmFees, expectedUsdmFees]
      );
      await expect(tx).to.changeEtherBalances(
        [tournament, feeRecipient],
        [-expectedNativeFees, expectedNativeFees]
      );

      expect(await tournament.accumulatedFees()).to.equal(0);
      expect(await tournament.accumulatedNativeFees()).to.equal(0);
    });

    it("Should emit one FeesWithdrawn event per asset type", async function () {
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

      expect(feeEvents.length).to.equal(2);

      const usdmEvent = feeEvents.find((e) => e.args.isNative === false);
      const nativeEvent = feeEvents.find((e) => e.args.isNative === true);

      expect(usdmEvent.args.recipient).to.equal(feeRecipient.address);
      expect(usdmEvent.args.amount).to.equal(expectedUsdmFees);
      expect(nativeEvent.args.recipient).to.equal(feeRecipient.address);
      expect(nativeEvent.args.amount).to.equal(expectedNativeFees);
    });
  });

  describe("withdrawFees — reverts", function () {
    it("Should revert with NoFeesToWithdraw when both fee pools are 0", async function () {
      expect(await tournament.accumulatedFees()).to.equal(0);
      expect(await tournament.accumulatedNativeFees()).to.equal(0);

      await expect(tournament.withdrawFees()).to.be.revertedWithCustomError(
        tournament,
        "NoFeesToWithdraw"
      );
    });
  });

  describe("Cancelled tournament fee accounting", function () {
    it("Should reduce accumulatedFees by the refunded protocol portion only", async function () {
      const cancelledId = await createTournament();
      await joinAll(cancelledId, players.slice(0, 3), false);

      const survivingId = await createTournament();
      await joinAll(survivingId, players.slice(3, 5), false);

      expect(await tournament.accumulatedFees()).to.equal(FEE_PER_ENTRY * 5n);

      await tournament.connect(creator).cancelTournament(cancelledId);

      // Only the 3 cancelled entries' protocol portion is returned to the pool
      expect(await tournament.accumulatedFees()).to.equal(FEE_PER_ENTRY * 2n);
    });

    it("Should reduce accumulatedNativeFees by the refunded protocol portion for native tournaments", async function () {
      const cancelledId = await createTournament({ isNative: true });
      await joinAll(cancelledId, players.slice(0, 3), true);

      const survivingId = await createTournament({ isNative: true });
      await joinAll(survivingId, players.slice(3, 5), true);

      expect(await tournament.accumulatedNativeFees()).to.equal(FEE_PER_ENTRY * 5n);

      await tournament.connect(creator).cancelTournament(cancelledId);

      expect(await tournament.accumulatedNativeFees()).to.equal(FEE_PER_ENTRY * 2n);
    });

    it("Should leave no funds stuck after a full cancel + refund cycle (USDm)", async function () {
      const id = await createTournament();
      await joinAll(id, players, false);

      // Seed refund back to creator on cancellation
      await expect(tournament.connect(creator).cancelTournament(id)).to.changeTokenBalance(
        usdm,
        creator,
        SEED_AMOUNT
      );

      expect(await tournament.accumulatedFees()).to.equal(0);

      // Every participant claims back the full entry fee
      for (const player of players) {
        await expect(tournament.connect(player).claimPrize(id)).to.changeTokenBalance(
          usdm,
          player,
          ENTRY_FEE
        );
      }

      // Nothing left in the contract
      expect(await usdm.balanceOf(await tournament.getAddress())).to.equal(0);
    });

    it("Should leave no funds stuck after a full cancel + refund cycle (native)", async function () {
      const id = await createTournament({ isNative: true });
      await joinAll(id, players, true);

      await expect(tournament.connect(creator).cancelTournament(id)).to.changeEtherBalance(
        creator,
        SEED_AMOUNT
      );

      expect(await tournament.accumulatedNativeFees()).to.equal(0);

      for (const player of players) {
        await expect(tournament.connect(player).claimPrize(id)).to.changeEtherBalance(
          player,
          ENTRY_FEE
        );
      }

      expect(await ethers.provider.getBalance(await tournament.getAddress())).to.equal(0);
    });
  });
});
