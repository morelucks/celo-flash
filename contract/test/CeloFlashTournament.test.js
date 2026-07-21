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

  describe("Accounting invariants", function () {
    it("After 5 USDm entries + fee withdrawal: contract balance == remaining prize pool only", async function () {
      const id = await createTournament();
      await joinAll(id, players, false);

      const expectedPrizePool = SEED_AMOUNT + PRIZE_PER_ENTRY * 5n;
      const expectedFees = FEE_PER_ENTRY * 5n;
      const contractAddress = await tournament.getAddress();

      // Before withdrawal: balance == prize pool + accumulated fees
      const t = await tournament.getTournament(id);
      expect(t.prizePool).to.equal(expectedPrizePool);
      expect(await usdm.balanceOf(contractAddress)).to.equal(expectedPrizePool + expectedFees);

      await tournament.withdrawFees();

      // After withdrawal: balance == remaining prize pool only
      expect(await usdm.balanceOf(contractAddress)).to.equal(expectedPrizePool);
    });

    it("After 5 native entries + fee withdrawal: contract balance == remaining prize pool only", async function () {
      const id = await createTournament({ isNative: true });
      await joinAll(id, players, true);

      const expectedPrizePool = SEED_AMOUNT + PRIZE_PER_ENTRY * 5n;
      const expectedFees = FEE_PER_ENTRY * 5n;
      const contractAddress = await tournament.getAddress();

      expect(await ethers.provider.getBalance(contractAddress)).to.equal(
        expectedPrizePool + expectedFees
      );

      await tournament.withdrawFees();

      expect(await ethers.provider.getBalance(contractAddress)).to.equal(expectedPrizePool);
    });

    it("Should fully drain the contract after fee withdrawal + finalization + all prize claims", async function () {
      const id = await createTournament();
      await joinAll(id, players, false);

      // Top-3 leaderboard: players[0] > players[1] > players[2]
      const scores = [300, 200, 100];
      for (let i = 0; i < 3; i++) {
        const nonce = uniqueNonce();
        const signature = await signScore(id, players[i].address, scores[i], nonce);
        await tournament.connect(players[i]).submitScore(id, scores[i], nonce, signature);
      }

      await time.increase(DURATION + 1);
      await tournament.finalizeTournament(id);
      await tournament.withdrawFees();

      const pool = SEED_AMOUNT + PRIZE_PER_ENTRY * 5n;
      const secondPrize = (pool * 2500n) / BPS_DENOMINATOR;
      const thirdPrize = (pool * 1500n) / BPS_DENOMINATOR;
      const firstPrize = pool - secondPrize - thirdPrize; // 60% + rounding dust

      await expect(tournament.connect(players[0]).claimPrize(id)).to.changeTokenBalance(
        usdm,
        players[0],
        firstPrize
      );
      await expect(tournament.connect(players[1]).claimPrize(id)).to.changeTokenBalance(
        usdm,
        players[1],
        secondPrize
      );
      await expect(tournament.connect(players[2]).claimPrize(id)).to.changeTokenBalance(
        usdm,
        players[2],
        thirdPrize
      );

      // No funds leaked or stuck
      expect(await usdm.balanceOf(await tournament.getAddress())).to.equal(0);
      expect(await tournament.accumulatedFees()).to.equal(0);
    });
  });
});

describe("CeloFlashTournament — joinTournament Flow", function () {
  const ENTRY_FEE = ethers.parseEther("10");
  const SEED_AMOUNT = ethers.parseEther("20");
  const DURATION = 3600; // 1 hour (MIN_DURATION)
  const PROTOCOL_FEE_BPS = 500n;
  const BPS_DENOMINATOR = 10_000n;
  const MAX_PARTICIPANTS = 1_000n;

  // protocolFee = (entryFee * 500) / 10000
  const protocolFeeFor = (fee) => (fee * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
  const FEE_PER_ENTRY = protocolFeeFor(ENTRY_FEE);
  const PRIZE_PER_ENTRY = ENTRY_FEE - FEE_PER_ENTRY;

  let tournament;
  let usdm;
  let owner;
  let verifier;
  let feeRecipient;
  let creator;
  let alice;
  let bob;
  let carol;

  async function createTournament({
    isNative = false,
    seed = SEED_AMOUNT,
    entryFee = ENTRY_FEE,
  } = {}) {
    const id = await tournament.nextTournamentId();
    await tournament
      .connect(creator)
      .createTournament("Join Flow", entryFee, seed, DURATION, isNative, {
        value: isNative ? seed : 0n,
      });
    return id;
  }

  // Read participantCount straight from the tournament struct.
  async function participantCount(id) {
    return (await tournament.tournaments(id)).participantCount;
  }

  async function prizePool(id) {
    return (await tournament.tournaments(id)).prizePool;
  }

  // Locate and overwrite tournaments[id].participantCount in storage so the
  // MAX_PARTICIPANTS branch can be exercised without 1,000 real joins.
  async function forceParticipantCount(id, count) {
    const addr = await tournament.getAddress();
    const coder = ethers.AbiCoder.defaultAbiCoder();

    // participantCount is the 9th field (struct-relative slot 8) of Tournament.
    // Scan candidate base slots for the `tournaments` mapping using the current
    // (non-zero) participantCount as a fingerprint, so this stays robust to
    // storage-layout shifts from the inherited contracts.
    const known = await participantCount(id);
    if (known === 0n) throw new Error("need a non-zero participantCount to locate the slot");

    let baseSlot = -1;
    for (let s = 0; s < 64; s++) {
      const base = BigInt(ethers.keccak256(coder.encode(["uint256", "uint256"], [id, s])));
      const raw = await ethers.provider.getStorage(addr, ethers.toBeHex(base + 8n, 32));
      if (BigInt(raw) === known) {
        baseSlot = s;
        break;
      }
    }
    if (baseSlot === -1) throw new Error("could not locate participantCount storage slot");

    const base = BigInt(ethers.keccak256(coder.encode(["uint256", "uint256"], [id, baseSlot])));
    await ethers.provider.send("hardhat_setStorageAt", [
      addr,
      ethers.toBeHex(base + 8n, 32),
      ethers.toBeHex(BigInt(count), 32),
    ]);
  }

  beforeEach(async function () {
    [owner, verifier, feeRecipient, creator, alice, bob, carol] =
      await ethers.getSigners();

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

    for (const acct of [creator, alice, bob, carol]) {
      await usdm.mint(acct.address, ethers.parseEther("1000"));
      await usdm
        .connect(acct)
        .approve(await tournament.getAddress(), ethers.MaxUint256);
    }
  });

  describe("Successful join — USDm", function () {
    it("Should set hasJoined[id][player] to true", async function () {
      const id = await createTournament();
      await tournament.connect(alice).joinTournament(id);

      expect(await tournament.hasJoined(id, alice.address)).to.equal(true);
    });

    it("Should increment participantCount by one", async function () {
      const id = await createTournament();
      expect(await participantCount(id)).to.equal(0n);

      await tournament.connect(alice).joinTournament(id);

      expect(await participantCount(id)).to.equal(1n);
    });

    it("Should emit TournamentJoined with the entry fee", async function () {
      const id = await createTournament();

      await expect(tournament.connect(alice).joinTournament(id))
        .to.emit(tournament, "TournamentJoined")
        .withArgs(id, alice.address, ENTRY_FEE);
    });

    it("Should transfer the full entry fee in USDm from player to contract", async function () {
      const id = await createTournament();

      await expect(
        tournament.connect(alice).joinTournament(id)
      ).to.changeTokenBalances(
        usdm,
        [alice, tournament],
        [-ENTRY_FEE, ENTRY_FEE]
      );
    });

    it("Should grow prizePool by entryFee minus the protocol fee", async function () {
      const id = await createTournament();
      const before = await prizePool(id);

      await tournament.connect(alice).joinTournament(id);

      expect(await prizePool(id)).to.equal(before + PRIZE_PER_ENTRY);
    });

    it("Should grow accumulatedFees by the protocol fee", async function () {
      const id = await createTournament();

      await tournament.connect(alice).joinTournament(id);

      expect(await tournament.accumulatedFees()).to.equal(FEE_PER_ENTRY);
    });

  });
});
