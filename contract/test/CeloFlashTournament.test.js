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

    it("Should leave accumulatedNativeFees untouched for USDm joins", async function () {
      const id = await createTournament();

      await tournament.connect(alice).joinTournament(id);

      expect(await tournament.accumulatedNativeFees()).to.equal(0n);
    });
  });

  describe("Protocol fee math (500 bps)", function () {
    it("Should take exactly 0.05 USDm from a 1 USDm entry fee", async function () {
      const entryFee = ethers.parseEther("1");
      const id = await createTournament({ entryFee, seed: 0n });

      await tournament.connect(alice).joinTournament(id);

      expect(await tournament.accumulatedFees()).to.equal(ethers.parseEther("0.05"));
    });

    it("Should take exactly 5 USDm from the 100 USDm max entry fee", async function () {
      const entryFee = ethers.parseEther("100");
      const id = await createTournament({ entryFee, seed: 0n });

      await tournament.connect(alice).joinTournament(id);

      expect(await tournament.accumulatedFees()).to.equal(ethers.parseEther("5"));
    });

    it("Should route entryFee minus protocolFee into the prize pool for a 1e18 entry", async function () {
      const entryFee = ethers.parseEther("1");
      const id = await createTournament({ entryFee, seed: 0n });

      await tournament.connect(alice).joinTournament(id);

      expect(await prizePool(id)).to.equal(entryFee - ethers.parseEther("0.05"));
    });

    it("Should match (entryFee * 500) / 10000 across a range of 1e18 amounts", async function () {
      for (const label of ["1", "10", "37", "99.5", "100"]) {
        const entryFee = ethers.parseEther(label);
        const id = await createTournament({ entryFee, seed: 0n });
        const expectedFee = (entryFee * 500n) / 10000n;

        await tournament.connect(alice).joinTournament(id);

        expect(await tournament.accumulatedFees()).to.equal(expectedFee);
        expect(await prizePool(id)).to.equal(entryFee - expectedFee);

        // Reset the fee pool between iterations by withdrawing it.
        await tournament.withdrawFees();
      }
    });
  });

  describe("Multiple participants — USDm", function () {
    it("Should count every distinct player that joins", async function () {
      const id = await createTournament();

      await tournament.connect(alice).joinTournament(id);
      await tournament.connect(bob).joinTournament(id);
      await tournament.connect(carol).joinTournament(id);

      expect(await participantCount(id)).to.equal(3n);
    });

    it("Should accumulate the seed plus each prize contribution in prizePool", async function () {
      const id = await createTournament();

      await tournament.connect(alice).joinTournament(id);
      await tournament.connect(bob).joinTournament(id);
      await tournament.connect(carol).joinTournament(id);

      expect(await prizePool(id)).to.equal(SEED_AMOUNT + PRIZE_PER_ENTRY * 3n);
    });

    it("Should accumulate one protocol fee per entry", async function () {
      const id = await createTournament();

      await tournament.connect(alice).joinTournament(id);
      await tournament.connect(bob).joinTournament(id);
      await tournament.connect(carol).joinTournament(id);

      expect(await tournament.accumulatedFees()).to.equal(FEE_PER_ENTRY * 3n);
    });

    it("Should hold the seed plus every entry fee in the contract balance", async function () {
      const id = await createTournament();

      await tournament.connect(alice).joinTournament(id);
      await tournament.connect(bob).joinTournament(id);
      await tournament.connect(carol).joinTournament(id);

      expect(await usdm.balanceOf(await tournament.getAddress())).to.equal(
        SEED_AMOUNT + ENTRY_FEE * 3n
      );
    });
  });

  describe("Successful join — Native CELO", function () {
    it("Should set hasJoined and increment participantCount", async function () {
      const id = await createTournament({ isNative: true });

      await tournament.connect(alice).joinTournament(id, { value: ENTRY_FEE });

      expect(await tournament.hasJoined(id, alice.address)).to.equal(true);
      expect(await participantCount(id)).to.equal(1n);
    });

    it("Should accept msg.value equal to the entry fee", async function () {
      const id = await createTournament({ isNative: true });

      await expect(
        tournament.connect(alice).joinTournament(id, { value: ENTRY_FEE })
      ).to.changeEtherBalances([alice, tournament], [-ENTRY_FEE, ENTRY_FEE]);
    });

    it("Should grow accumulatedNativeFees by the protocol fee", async function () {
      const id = await createTournament({ isNative: true });

      await tournament.connect(alice).joinTournament(id, { value: ENTRY_FEE });

      expect(await tournament.accumulatedNativeFees()).to.equal(FEE_PER_ENTRY);
    });

    it("Should grow prizePool by entryFee minus the protocol fee", async function () {
      const id = await createTournament({ isNative: true });
      const before = await prizePool(id);

      await tournament.connect(alice).joinTournament(id, { value: ENTRY_FEE });

      expect(await prizePool(id)).to.equal(before + PRIZE_PER_ENTRY);
    });

    it("Should leave accumulatedFees (USDm) untouched for native joins", async function () {
      const id = await createTournament({ isNative: true });

      await tournament.connect(alice).joinTournament(id, { value: ENTRY_FEE });

      expect(await tournament.accumulatedFees()).to.equal(0n);
    });

    it("Should emit TournamentJoined for a native join", async function () {
      const id = await createTournament({ isNative: true });

      await expect(
        tournament.connect(alice).joinTournament(id, { value: ENTRY_FEE })
      )
        .to.emit(tournament, "TournamentJoined")
        .withArgs(id, alice.address, ENTRY_FEE);
    });
  });

  describe("Native value validation", function () {
    it("Should revert with InvalidValueSent when msg.value is below the entry fee", async function () {
      const id = await createTournament({ isNative: true });

      await expect(
        tournament.connect(alice).joinTournament(id, { value: ENTRY_FEE - 1n })
      ).to.be.revertedWithCustomError(tournament, "InvalidValueSent");
    });

    it("Should revert with InvalidValueSent when msg.value exceeds the entry fee", async function () {
      const id = await createTournament({ isNative: true });

      await expect(
        tournament.connect(alice).joinTournament(id, { value: ENTRY_FEE + 1n })
      ).to.be.revertedWithCustomError(tournament, "InvalidValueSent");
    });

    it("Should revert with InvalidValueSent when no value is sent for a paid native tournament", async function () {
      const id = await createTournament({ isNative: true });

      await expect(
        tournament.connect(alice).joinTournament(id, { value: 0n })
      ).to.be.revertedWithCustomError(tournament, "InvalidValueSent");
    });
  });

  describe("Duplicate join prevention", function () {
    it("Should revert with AlreadyJoined on a second USDm join", async function () {
      const id = await createTournament();
      await tournament.connect(alice).joinTournament(id);

      await expect(
        tournament.connect(alice).joinTournament(id)
      ).to.be.revertedWithCustomError(tournament, "AlreadyJoined");
    });

    it("Should revert with AlreadyJoined on a second native join", async function () {
      const id = await createTournament({ isNative: true });
      await tournament.connect(alice).joinTournament(id, { value: ENTRY_FEE });

      await expect(
        tournament.connect(alice).joinTournament(id, { value: ENTRY_FEE })
      ).to.be.revertedWithCustomError(tournament, "AlreadyJoined");
    });

    it("Should not change participantCount when a duplicate join reverts", async function () {
      const id = await createTournament();
      await tournament.connect(alice).joinTournament(id);

      await expect(tournament.connect(alice).joinTournament(id)).to.be.reverted;

      expect(await participantCount(id)).to.equal(1n);
    });
  });

  describe("Inactive tournament", function () {
    it("Should revert with TournamentNotActive once the tournament has ended", async function () {
      const id = await createTournament();
      await time.increase(DURATION + 1);

      await expect(
        tournament.connect(alice).joinTournament(id)
      ).to.be.revertedWithCustomError(tournament, "TournamentNotActive");
    });

    it("Should revert with TournamentNotActive after the tournament is cancelled", async function () {
      const id = await createTournament();
      await tournament.connect(creator).cancelTournament(id);

      await expect(
        tournament.connect(alice).joinTournament(id)
      ).to.be.revertedWithCustomError(tournament, "TournamentNotActive");
    });

    it("Should revert with TournamentNotActive for a tournament id that does not exist", async function () {
      await expect(
        tournament.connect(alice).joinTournament(999n)
      ).to.be.revertedWithCustomError(tournament, "TournamentNotActive");
    });
  });

  describe("Participant capacity (MAX_PARTICIPANTS)", function () {
    it("Should revert with MaxParticipantsReached once 1000 players have joined", async function () {
      const id = await createTournament();
      await tournament.connect(alice).joinTournament(id);

      await forceParticipantCount(id, MAX_PARTICIPANTS);
      expect(await participantCount(id)).to.equal(MAX_PARTICIPANTS);

      await expect(
        tournament.connect(bob).joinTournament(id)
      ).to.be.revertedWithCustomError(tournament, "MaxParticipantsReached");
    });

    it("Should still accept a join when one slot below the cap", async function () {
      const id = await createTournament();
      await tournament.connect(alice).joinTournament(id);

      await forceParticipantCount(id, MAX_PARTICIPANTS - 1n);

      await tournament.connect(bob).joinTournament(id);

      expect(await participantCount(id)).to.equal(MAX_PARTICIPANTS);
    });
  });

  describe("Free tournament (entryFee = 0) — USDm", function () {
    it("Should join without moving any USDm", async function () {
      const id = await createTournament({ entryFee: 0n, seed: 0n });

      await expect(
        tournament.connect(alice).joinTournament(id)
      ).to.changeTokenBalances(usdm, [alice, tournament], [0n, 0n]);

      expect(await tournament.hasJoined(id, alice.address)).to.equal(true);
    });

    it("Should increment participantCount and set hasJoined for a free join", async function () {
      const id = await createTournament({ entryFee: 0n, seed: 0n });

      await tournament.connect(alice).joinTournament(id);

      expect(await participantCount(id)).to.equal(1n);
      expect(await tournament.hasJoined(id, alice.address)).to.equal(true);
    });

    it("Should leave prizePool and both fee pools at zero for a free join", async function () {
      const id = await createTournament({ entryFee: 0n, seed: 0n });

      await tournament.connect(alice).joinTournament(id);

      expect(await prizePool(id)).to.equal(0n);
      expect(await tournament.accumulatedFees()).to.equal(0n);
      expect(await tournament.accumulatedNativeFees()).to.equal(0n);
    });

    it("Should revert with InvalidValueSent when value is sent to a free USDm tournament", async function () {
      const id = await createTournament({ entryFee: 0n, seed: 0n });

      await expect(
        tournament.connect(alice).joinTournament(id, { value: 1n })
      ).to.be.revertedWithCustomError(tournament, "InvalidValueSent");
    });
  });

  describe("Free tournament (entryFee = 0) — Native", function () {
    it("Should join a free native tournament with zero value", async function () {
      const id = await createTournament({ isNative: true, entryFee: 0n, seed: 0n });

      await tournament.connect(alice).joinTournament(id, { value: 0n });

      expect(await tournament.hasJoined(id, alice.address)).to.equal(true);
      expect(await participantCount(id)).to.equal(1n);
    });

    it("Should revert with InvalidValueSent when value is sent to a free native tournament", async function () {
      const id = await createTournament({ isNative: true, entryFee: 0n, seed: 0n });

      await expect(
        tournament.connect(alice).joinTournament(id, { value: 1n })
      ).to.be.revertedWithCustomError(tournament, "InvalidValueSent");
    });
  });
});

describe("CeloFlashTournament — joinTournament Extended Coverage", function () {
  const ENTRY_FEE = ethers.parseEther("10");
  const SEED_AMOUNT = ethers.parseEther("20");
  const DURATION = 3600; // 1 hour (MIN_DURATION)
  const PROTOCOL_FEE_BPS = 500n;
  const BPS_DENOMINATOR = 10_000n;

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
  let extras;

  async function createTournament({
    isNative = false,
    seed = SEED_AMOUNT,
    entryFee = ENTRY_FEE,
  } = {}) {
    const id = await tournament.nextTournamentId();
    await tournament
      .connect(creator)
      .createTournament("Extended", entryFee, seed, DURATION, isNative, {
        value: isNative ? seed : 0n,
      });
    return id;
  }

  async function participantCount(id) {
    return (await tournament.tournaments(id)).participantCount;
  }

  async function prizePool(id) {
    return (await tournament.tournaments(id)).prizePool;
  }

  async function endTimeOf(id) {
    return (await tournament.tournaments(id)).endTime;
  }

  beforeEach(async function () {
    [owner, verifier, feeRecipient, creator, alice, bob, carol, ...extras] =
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

  describe("View accessors after joining", function () {
    it("Should report hasJoined as false for a player who never joined", async function () {
      const id = await createTournament();

      await tournament.connect(alice).joinTournament(id);

      expect(await tournament.hasJoined(id, bob.address)).to.equal(false);
    });
    it("Should return true from isPlayerJoined after a player joins", async function () {
      const id = await createTournament();

      await tournament.connect(alice).joinTournament(id);

      expect(await tournament.isPlayerJoined(id, alice.address)).to.equal(true);
    });
    it("Should return false from isPlayerJoined before a player joins", async function () {
      const id = await createTournament();

      expect(await tournament.isPlayerJoined(id, alice.address)).to.equal(false);
    });
    it("Should reflect the incremented participantCount via getTournament", async function () {
      const id = await createTournament();

      await tournament.connect(alice).joinTournament(id);

      const t = await tournament.getTournament(id);
      expect(t.participantCount).to.equal(1n);
    });
    it("Should reflect the updated prizePool via getTournament after a join", async function () {
      const id = await createTournament();

      await tournament.connect(alice).joinTournament(id);

      const t = await tournament.getTournament(id);
      expect(t.prizePool).to.equal(SEED_AMOUNT + PRIZE_PER_ENTRY);
    });
  });

  describe("Cross-tournament isolation", function () {
    it("Should leave hasJoined false on tournament B when only A is joined", async function () {
      const idA = await createTournament();
      const idB = await createTournament();

      await tournament.connect(alice).joinTournament(idA);

      expect(await tournament.hasJoined(idA, alice.address)).to.equal(true);
      expect(await tournament.hasJoined(idB, alice.address)).to.equal(false);
    });
    it("Should leave tournament B participantCount at zero when only A is joined", async function () {
      const idA = await createTournament();
      const idB = await createTournament();

      await tournament.connect(alice).joinTournament(idA);

      expect(await participantCount(idA)).to.equal(1n);
      expect(await participantCount(idB)).to.equal(0n);
    });
    it("Should not change an unrelated tournament's prizePool on a join", async function () {
      const idA = await createTournament();
      const idB = await createTournament();
      const poolBBefore = await prizePool(idB);

      await tournament.connect(alice).joinTournament(idA);

      expect(await prizePool(idB)).to.equal(poolBBefore);
    });
    it("Should sum accumulatedFees across two separate USDm tournaments", async function () {
      const idA = await createTournament();
      const idB = await createTournament();

      await tournament.connect(alice).joinTournament(idA);
      await tournament.connect(bob).joinTournament(idB);

      expect(await tournament.accumulatedFees()).to.equal(FEE_PER_ENTRY * 2n);
    });
  });

  describe("Pausable behavior", function () {
    it("Should revert a USDm join when the contract is paused", async function () {
      const id = await createTournament();
      await tournament.connect(owner).pause();

      await expect(
        tournament.connect(alice).joinTournament(id)
      ).to.be.revertedWithCustomError(tournament, "EnforcedPause");
    });
    it("Should revert a native join when the contract is paused", async function () {
      const id = await createTournament({ isNative: true });
      await tournament.connect(owner).pause();

      await expect(
        tournament.connect(alice).joinTournament(id, { value: ENTRY_FEE })
      ).to.be.revertedWithCustomError(tournament, "EnforcedPause");
    });
    it("Should allow a join again after the contract is unpaused", async function () {
      const id = await createTournament();
      await tournament.connect(owner).pause();
      await tournament.connect(owner).unpause();

      await tournament.connect(alice).joinTournament(id);

      expect(await tournament.hasJoined(id, alice.address)).to.equal(true);
    });
  });

  describe("End-time boundary", function () {
    it("Should revert with TournamentNotActive at the exact endTime", async function () {
      const id = await createTournament();
      const endTime = await endTimeOf(id);

      await time.increaseTo(endTime);

      await expect(
        tournament.connect(alice).joinTournament(id)
      ).to.be.revertedWithCustomError(tournament, "TournamentNotActive");
    });
    it("Should allow a join one second before endTime", async function () {
      const id = await createTournament();
      const endTime = await endTimeOf(id);

      await time.setNextBlockTimestamp(endTime - 1n);
      await tournament.connect(alice).joinTournament(id);

      expect(await tournament.hasJoined(id, alice.address)).to.equal(true);
    });
  });

  describe("Balance movements", function () {
    it("Should hold seed plus the full native entry fee in the contract balance", async function () {
      const id = await createTournament({ isNative: true });

      await tournament.connect(alice).joinTournament(id, { value: ENTRY_FEE });

      expect(await ethers.provider.getBalance(await tournament.getAddress())).to.equal(
        SEED_AMOUNT + ENTRY_FEE
      );
    });
    it("Should decrease the player's USDm balance by exactly the entry fee", async function () {
      const id = await createTournament();
      const before = await usdm.balanceOf(alice.address);

      await tournament.connect(alice).joinTournament(id);

      expect(await usdm.balanceOf(alice.address)).to.equal(before - ENTRY_FEE);
    });
  });

  describe("Protocol fee math — additional 1e18 amounts", function () {
    it("Should take exactly 0.0005 USDm from a 0.01 USDm entry", async function () {
      const entryFee = ethers.parseEther("0.01");
      const id = await createTournament({ entryFee, seed: 0n });

      await tournament.connect(alice).joinTournament(id);

      expect(await tournament.accumulatedFees()).to.equal(ethers.parseEther("0.0005"));
    });
    it("Should take exactly 2.5 USDm from a 50 USDm entry", async function () {
      const entryFee = ethers.parseEther("50");
      const id = await createTournament({ entryFee, seed: 0n });

      await tournament.connect(alice).joinTournament(id);

      expect(await tournament.accumulatedFees()).to.equal(ethers.parseEther("2.5"));
    });
    it("Should route 47.5 USDm (95%) of a 50 USDm entry into the prize pool", async function () {
      const entryFee = ethers.parseEther("50");
      const id = await createTournament({ entryFee, seed: 0n });

      await tournament.connect(alice).joinTournament(id);

      expect(await prizePool(id)).to.equal(ethers.parseEther("47.5"));
    });
    it("Should accumulate exactly 5 CELO from the 100 CELO max native entry", async function () {
      const entryFee = ethers.parseEther("100");
      const id = await createTournament({ isNative: true, entryFee, seed: 0n });

      await tournament.connect(alice).joinTournament(id, { value: entryFee });

      expect(await tournament.accumulatedNativeFees()).to.equal(ethers.parseEther("5"));
      expect(await prizePool(id)).to.equal(ethers.parseEther("95"));
    });
  });

  describe("Free tournaments — multiple joiners", function () {
    it("Should keep pools at zero across three free USDm joins", async function () {
      const id = await createTournament({ entryFee: 0n, seed: 0n });

      await tournament.connect(alice).joinTournament(id);
      await tournament.connect(bob).joinTournament(id);
      await tournament.connect(carol).joinTournament(id);

      expect(await participantCount(id)).to.equal(3n);
      expect(await prizePool(id)).to.equal(0n);
      expect(await tournament.accumulatedFees()).to.equal(0n);
      expect(await tournament.accumulatedNativeFees()).to.equal(0n);
    });
    it("Should track participantCount across multiple free native joins", async function () {
      const id = await createTournament({ isNative: true, entryFee: 0n, seed: 0n });

      await tournament.connect(alice).joinTournament(id, { value: 0n });
      await tournament.connect(bob).joinTournament(id, { value: 0n });

      expect(await participantCount(id)).to.equal(2n);
      expect(await ethers.provider.getBalance(await tournament.getAddress())).to.equal(0n);
    });
  });

  describe("Duplicate join side effects", function () {
    it("Should let a different player join after the first has joined", async function () {
      const id = await createTournament();
      await tournament.connect(alice).joinTournament(id);

      await tournament.connect(bob).joinTournament(id);

      expect(await tournament.hasJoined(id, alice.address)).to.equal(true);
      expect(await tournament.hasJoined(id, bob.address)).to.equal(true);
      expect(await participantCount(id)).to.equal(2n);
    });
    it("Should leave accumulatedFees unchanged when a duplicate join reverts", async function () {
      const id = await createTournament();
      await tournament.connect(alice).joinTournament(id);
      const feesAfterFirst = await tournament.accumulatedFees();

      await expect(
        tournament.connect(alice).joinTournament(id)
      ).to.be.revertedWithCustomError(tournament, "AlreadyJoined");

      expect(await tournament.accumulatedFees()).to.equal(feesAfterFirst);
    });
    it("Should move no USDm when a duplicate join reverts", async function () {
      const id = await createTournament();
      await tournament.connect(alice).joinTournament(id);
      const aliceBefore = await usdm.balanceOf(alice.address);
      const contractBefore = await usdm.balanceOf(await tournament.getAddress());

      await expect(
        tournament.connect(alice).joinTournament(id)
      ).to.be.revertedWithCustomError(tournament, "AlreadyJoined");

      expect(await usdm.balanceOf(alice.address)).to.equal(aliceBefore);
      expect(await usdm.balanceOf(await tournament.getAddress())).to.equal(contractBefore);
    });
  });

  describe("Event emission details", function () {
    it("Should be queryable by the indexed tournamentId topic", async function () {
      const id = await createTournament();
      await tournament.connect(alice).joinTournament(id);

      const events = await tournament.queryFilter(
        tournament.filters.TournamentJoined(id)
      );

      expect(events.length).to.equal(1);
      expect(events[0].args.player).to.equal(alice.address);
      expect(events[0].args.entryFee).to.equal(ENTRY_FEE);
    });
    it("Should emit TournamentJoined with entryFee = 0 for a free tournament", async function () {
      const id = await createTournament({ entryFee: 0n, seed: 0n });

      await expect(tournament.connect(alice).joinTournament(id))
        .to.emit(tournament, "TournamentJoined")
        .withArgs(id, alice.address, 0n);
    });
  });

  describe("ERC20 preconditions", function () {
    it("Should revert a USDm join when the player has not approved the contract", async function () {
      const dave = extras[0];
      await usdm.mint(dave.address, ethers.parseEther("1000"));
      const id = await createTournament();

      await expect(tournament.connect(dave).joinTournament(id)).to.be.reverted;
      expect(await tournament.hasJoined(id, dave.address)).to.equal(false);
    });
    it("Should revert a USDm join when the player has insufficient balance", async function () {
      const eve = extras[1];
      await usdm
        .connect(eve)
        .approve(await tournament.getAddress(), ethers.MaxUint256);
      const id = await createTournament();

      await expect(tournament.connect(eve).joinTournament(id)).to.be.reverted;
      expect(await tournament.hasJoined(id, eve.address)).to.equal(false);
    });
  });

  describe("Volume and invariants", function () {
    it("Should reach participantCount 10 after ten distinct native joins", async function () {
      const id = await createTournament({ isNative: true });
      const joiners = [alice, bob, carol, ...extras.slice(0, 7)];

      for (const player of joiners) {
        await tournament.connect(player).joinTournament(id, { value: ENTRY_FEE });
      }

      expect(await participantCount(id)).to.equal(10n);
    });
    it("Should grow prizePool to seed plus ten prize contributions", async function () {
      const id = await createTournament({ isNative: true });
      const joiners = [alice, bob, carol, ...extras.slice(0, 7)];

      for (const player of joiners) {
        await tournament.connect(player).joinTournament(id, { value: ENTRY_FEE });
      }

      expect(await prizePool(id)).to.equal(SEED_AMOUNT + PRIZE_PER_ENTRY * 10n);
    });
    it("Should accumulate ten protocol fees after ten native joins", async function () {
      const id = await createTournament({ isNative: true });
      const joiners = [alice, bob, carol, ...extras.slice(0, 7)];

      for (const player of joiners) {
        await tournament.connect(player).joinTournament(id, { value: ENTRY_FEE });
      }

      expect(await tournament.accumulatedNativeFees()).to.equal(FEE_PER_ENTRY * 10n);
    });
    it("Should keep USDm and native fee pools isolated across asset types", async function () {
      const usdmId = await createTournament();
      const nativeId = await createTournament({ isNative: true });

      await tournament.connect(alice).joinTournament(usdmId);
      await tournament.connect(bob).joinTournament(nativeId, { value: ENTRY_FEE });

      expect(await tournament.accumulatedFees()).to.equal(FEE_PER_ENTRY);
      expect(await tournament.accumulatedNativeFees()).to.equal(FEE_PER_ENTRY);
    });
    it("Should hold prizePool + accumulatedFees == seed + total entry fees", async function () {
      const id = await createTournament();

      await tournament.connect(alice).joinTournament(id);
      await tournament.connect(bob).joinTournament(id);
      await tournament.connect(carol).joinTournament(id);

      const pool = await prizePool(id);
      const fees = await tournament.accumulatedFees();
      expect(pool + fees).to.equal(SEED_AMOUNT + ENTRY_FEE * 3n);
    });
  });

  describe("Lifecycle guards", function () {
    it("Should revert a join on a finalized tournament with TournamentNotActive", async function () {
      const id = await createTournament();
      await time.increase(DURATION + 1);
      await tournament.finalizeTournament(id);

      await expect(
        tournament.connect(alice).joinTournament(id)
      ).to.be.revertedWithCustomError(tournament, "TournamentNotActive");
    });
    it("Should revert a direct native transfer so CELO must route through joinTournament", async function () {
      await expect(
        alice.sendTransaction({ to: await tournament.getAddress(), value: 1n })
      ).to.be.reverted;
    });
    it("Should not transfer anything to feeRecipient on a join (fees only accrue)", async function () {
      const id = await createTournament();

      await expect(
        tournament.connect(alice).joinTournament(id)
      ).to.changeTokenBalance(usdm, feeRecipient, 0n);

      expect(await tournament.accumulatedFees()).to.equal(FEE_PER_ENTRY);
    });
    it("Should track hasJoined independently per player in a native tournament", async function () {
      const id = await createTournament({ isNative: true });

      await tournament.connect(alice).joinTournament(id, { value: ENTRY_FEE });

      expect(await tournament.hasJoined(id, alice.address)).to.equal(true);
      expect(await tournament.hasJoined(id, bob.address)).to.equal(false);
      expect(await tournament.hasJoined(id, carol.address)).to.equal(false);
    });
    it("Should revert InvalidValueSent when native value is attached to a USDm join", async function () {
      const id = await createTournament();

      await expect(
        tournament.connect(alice).joinTournament(id, { value: 1n })
      ).to.be.revertedWithCustomError(tournament, "InvalidValueSent");
    });
    it("Should allow joining in the same block window the tournament starts", async function () {
      const id = await createTournament();
      const t = await tournament.getTournament(id);
      expect(t.startTime).to.be.lte(await time.latest());

      await tournament.connect(alice).joinTournament(id);

      expect(await participantCount(id)).to.equal(1n);
    });
  });
});

// Tournament unit test update

// Tournament fee withdrawal single-call test suite

// Revert assertion on zero fee pool

// FeesWithdrawn event assertion

// Tournament cancellation fee reduction check

// Tournament 5-entry balance accounting invariant

describe("CeloFlashTournament — createTournament (dual-asset)", function () {
  const ENTRY_FEE = ethers.parseEther("10");
  const SEED_AMOUNT = ethers.parseEther("20");
  const DURATION = 3600; // 1 hour (MIN_DURATION)

  // Contract-mirrored constants for boundary assertions.
  const MAX_ENTRY_FEE = ethers.parseEther("100"); // 100e18
  const MIN_DURATION = 3600; // 1 hour
  const MAX_DURATION = 7 * 24 * 3600; // 7 days

  let tournament;
  let usdm;
  let owner;
  let verifier;
  let feeRecipient;
  let creator;
  let other;

  beforeEach(async function () {
    [owner, verifier, feeRecipient, creator, other] = await ethers.getSigners();

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
    await usdm
      .connect(creator)
      .approve(await tournament.getAddress(), ethers.MaxUint256);
  });

  describe("USDm mode — success", function () {
    it("Should pull the seed from the creator via safeTransferFrom", async function () {
      await expect(
        tournament
          .connect(creator)
          .createTournament("USDm Cup", ENTRY_FEE, SEED_AMOUNT, DURATION, false, {
            value: 0n,
          })
      ).to.changeTokenBalances(
        usdm,
        [creator, tournament],
        [-SEED_AMOUNT, SEED_AMOUNT]
      );
    });

    it("Should set prizePool equal to the seed amount", async function () {
      await tournament
        .connect(creator)
        .createTournament("USDm Cup", ENTRY_FEE, SEED_AMOUNT, DURATION, false, {
          value: 0n,
        });

      const t = await tournament.tournaments(0);
      expect(t.prizePool).to.equal(SEED_AMOUNT);
    });
    it("Should record the seedAmount on the tournament struct", async function () {
      await tournament
        .connect(creator)
        .createTournament("USDm Cup", ENTRY_FEE, SEED_AMOUNT, DURATION, false, {
          value: 0n,
        });

      const t = await tournament.tournaments(0);
      expect(t.seedAmount).to.equal(SEED_AMOUNT);
    });
    it("Should flag the tournament as non-native (isNative == false)", async function () {
      await tournament
        .connect(creator)
        .createTournament("USDm Cup", ENTRY_FEE, SEED_AMOUNT, DURATION, false, {
          value: 0n,
        });

      const t = await tournament.tournaments(0);
      expect(t.isNative).to.equal(false);
    });
    it("Should record msg.sender as the tournament creator", async function () {
      await tournament
        .connect(creator)
        .createTournament("USDm Cup", ENTRY_FEE, SEED_AMOUNT, DURATION, false, {
          value: 0n,
        });

      const t = await tournament.tournaments(0);
      expect(t.creator).to.equal(creator.address);
    });
    it("Should store the tournament name verbatim", async function () {
      await tournament
        .connect(creator)
        .createTournament("Weekend USDm Blitz", ENTRY_FEE, SEED_AMOUNT, DURATION, false, {
          value: 0n,
        });

      const t = await tournament.tournaments(0);
      expect(t.name).to.equal("Weekend USDm Blitz");
    });
    it("Should store the entry fee on the tournament struct", async function () {
      await tournament
        .connect(creator)
        .createTournament("USDm Cup", ENTRY_FEE, SEED_AMOUNT, DURATION, false, {
          value: 0n,
        });

      const t = await tournament.tournaments(0);
      expect(t.entryFee).to.equal(ENTRY_FEE);
    });
    it("Should mark a freshly created tournament as Active", async function () {
      await tournament
        .connect(creator)
        .createTournament("USDm Cup", ENTRY_FEE, SEED_AMOUNT, DURATION, false, {
          value: 0n,
        });

      const t = await tournament.tournaments(0);
      // TournamentStatus.Active == 0
      expect(t.status).to.equal(0);
    });
    it("Should set startTime to the creation block and endTime to start + duration", async function () {
      const tx = await tournament
        .connect(creator)
        .createTournament("USDm Cup", ENTRY_FEE, SEED_AMOUNT, DURATION, false, {
          value: 0n,
        });
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      const t = await tournament.tournaments(0);
      expect(t.startTime).to.equal(block.timestamp);
      expect(t.endTime).to.equal(BigInt(block.timestamp) + BigInt(DURATION));
    });
    it("Should allow a zero seed with no token transfer", async function () {
      await expect(
        tournament
          .connect(creator)
          .createTournament("No Seed USDm", ENTRY_FEE, 0n, DURATION, false, {
            value: 0n,
          })
      ).to.changeTokenBalances(usdm, [creator, tournament], [0n, 0n]);

      const t = await tournament.tournaments(0);
      expect(t.prizePool).to.equal(0n);
      expect(t.seedAmount).to.equal(0n);
    });
    it("Should return the newly assigned tournamentId", async function () {
      const returnedId = await tournament
        .connect(creator)
        .createTournament.staticCall("USDm Cup", ENTRY_FEE, SEED_AMOUNT, DURATION, false, {
          value: 0n,
        });

      expect(returnedId).to.equal(0n);
    });
  });

  describe("Native CELO mode — success", function () {
    it("Should accept msg.value equal to the seed and move CELO into the contract", async function () {
      await expect(
        tournament
          .connect(creator)
          .createTournament("CELO Cup", ENTRY_FEE, SEED_AMOUNT, DURATION, true, {
            value: SEED_AMOUNT,
          })
      ).to.changeEtherBalances(
        [creator, tournament],
        [-SEED_AMOUNT, SEED_AMOUNT]
      );
    });
    it("Should set prizePool equal to the native seed amount", async function () {
      await tournament
        .connect(creator)
        .createTournament("CELO Cup", ENTRY_FEE, SEED_AMOUNT, DURATION, true, {
          value: SEED_AMOUNT,
        });

      const t = await tournament.tournaments(0);
      expect(t.prizePool).to.equal(SEED_AMOUNT);
      expect(t.seedAmount).to.equal(SEED_AMOUNT);
    });
    it("Should flag the tournament as native (isNative == true)", async function () {
      await tournament
        .connect(creator)
        .createTournament("CELO Cup", ENTRY_FEE, SEED_AMOUNT, DURATION, true, {
          value: SEED_AMOUNT,
        });

      const t = await tournament.tournaments(0);
      expect(t.isNative).to.equal(true);
    });
    it("Should allow a zero seed with zero msg.value", async function () {
      await expect(
        tournament
          .connect(creator)
          .createTournament("No Seed CELO", ENTRY_FEE, 0n, DURATION, true, {
            value: 0n,
          })
      ).to.changeEtherBalances([creator, tournament], [0n, 0n]);

      const t = await tournament.tournaments(0);
      expect(t.prizePool).to.equal(0n);
      expect(t.isNative).to.equal(true);
    });
    it("Should not move any USDm when creating a native tournament", async function () {
      await expect(
        tournament
          .connect(creator)
          .createTournament("CELO Cup", ENTRY_FEE, SEED_AMOUNT, DURATION, true, {
            value: SEED_AMOUNT,
          })
      ).to.changeTokenBalances(usdm, [creator, tournament], [0n, 0n]);
    });
  });

  describe("Reverts — native value handling", function () {
    it("Should revert InvalidValueSent when msg.value is less than the seed", async function () {
      await expect(
        tournament
          .connect(creator)
          .createTournament("CELO Cup", ENTRY_FEE, SEED_AMOUNT, DURATION, true, {
            value: SEED_AMOUNT - 1n,
          })
      ).to.be.revertedWithCustomError(tournament, "InvalidValueSent");
    });
    it("Should revert InvalidValueSent when msg.value exceeds the seed", async function () {
      await expect(
        tournament
          .connect(creator)
          .createTournament("CELO Cup", ENTRY_FEE, SEED_AMOUNT, DURATION, true, {
            value: SEED_AMOUNT + 1n,
          })
      ).to.be.revertedWithCustomError(tournament, "InvalidValueSent");
    });
    it("Should revert InvalidValueSent when seed is positive but no value is sent", async function () {
      await expect(
        tournament
          .connect(creator)
          .createTournament("CELO Cup", ENTRY_FEE, SEED_AMOUNT, DURATION, true, {
            value: 0n,
          })
      ).to.be.revertedWithCustomError(tournament, "InvalidValueSent");
    });
  });

  describe("Reverts — USDm value handling", function () {
    it("Should revert InvalidValueSent when native value is attached to a USDm tournament", async function () {
      await expect(
        tournament
          .connect(creator)
          .createTournament("USDm Cup", ENTRY_FEE, SEED_AMOUNT, DURATION, false, {
            value: 1n,
          })
      ).to.be.revertedWithCustomError(tournament, "InvalidValueSent");
    });

    it("Should revert InvalidValueSent for a zero-seed USDm tournament with value", async function () {
      await expect(
        tournament
          .connect(creator)
          .createTournament("USDm Cup", ENTRY_FEE, 0n, DURATION, false, {
            value: SEED_AMOUNT,
          })
      ).to.be.revertedWithCustomError(tournament, "InvalidValueSent");
    });
  });

  describe("Reverts — name validation", function () {
    it("Should revert EmptyName when the name is an empty string", async function () {
      await expect(
        tournament
          .connect(creator)
          .createTournament("", ENTRY_FEE, SEED_AMOUNT, DURATION, false, {
            value: 0n,
          })
      ).to.be.revertedWithCustomError(tournament, "EmptyName");
    });
  });

  describe("Reverts — entry fee bounds", function () {
    it("Should revert InvalidEntryFee when entry fee exceeds MAX_ENTRY_FEE", async function () {
      await expect(
        tournament
          .connect(creator)
          .createTournament("USDm Cup", MAX_ENTRY_FEE + 1n, SEED_AMOUNT, DURATION, false, {
            value: 0n,
          })
      ).to.be.revertedWithCustomError(tournament, "InvalidEntryFee");
    });
    it("Should accept an entry fee exactly equal to MAX_ENTRY_FEE (boundary)", async function () {
      await tournament
        .connect(creator)
        .createTournament("USDm Cup", MAX_ENTRY_FEE, SEED_AMOUNT, DURATION, false, {
          value: 0n,
        });

      const t = await tournament.tournaments(0);
      expect(t.entryFee).to.equal(MAX_ENTRY_FEE);
    });
    it("Should accept a zero entry fee (free tournament)", async function () {
      await tournament
        .connect(creator)
        .createTournament("Free USDm", 0n, SEED_AMOUNT, DURATION, false, {
          value: 0n,
        });

      const t = await tournament.tournaments(0);
      expect(t.entryFee).to.equal(0n);
    });
  });

  describe("Reverts — duration bounds", function () {
    it("Should revert InvalidDuration when duration is below MIN_DURATION", async function () {
      await expect(
        tournament
          .connect(creator)
          .createTournament("USDm Cup", ENTRY_FEE, SEED_AMOUNT, MIN_DURATION - 1, false, {
            value: 0n,
          })
      ).to.be.revertedWithCustomError(tournament, "InvalidDuration");
    });
    it("Should accept a duration exactly equal to MIN_DURATION (boundary)", async function () {
      const tx = await tournament
        .connect(creator)
        .createTournament("USDm Cup", ENTRY_FEE, SEED_AMOUNT, MIN_DURATION, false, {
          value: 0n,
        });
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      const t = await tournament.tournaments(0);
      expect(t.endTime - t.startTime).to.equal(BigInt(MIN_DURATION));
      expect(t.startTime).to.equal(block.timestamp);
    });
    it("Should revert InvalidDuration when duration exceeds MAX_DURATION", async function () {
      await expect(
        tournament
          .connect(creator)
          .createTournament("USDm Cup", ENTRY_FEE, SEED_AMOUNT, MAX_DURATION + 1, false, {
            value: 0n,
          })
      ).to.be.revertedWithCustomError(tournament, "InvalidDuration");
    });
    it("Should accept a duration exactly equal to MAX_DURATION (boundary)", async function () {
      await tournament
        .connect(creator)
        .createTournament("USDm Cup", ENTRY_FEE, SEED_AMOUNT, MAX_DURATION, false, {
          value: 0n,
        });

      const t = await tournament.tournaments(0);
      expect(t.endTime - t.startTime).to.equal(BigInt(MAX_DURATION));
    });
    it("Should revert InvalidDuration when duration is zero", async function () {
      await expect(
        tournament
          .connect(creator)
          .createTournament("USDm Cup", ENTRY_FEE, SEED_AMOUNT, 0, false, {
            value: 0n,
          })
      ).to.be.revertedWithCustomError(tournament, "InvalidDuration");
    });
  });

  describe("TournamentCreated event", function () {
    it("Should emit TournamentCreated with all fields for a USDm tournament", async function () {
      const tx = await tournament
        .connect(creator)
        .createTournament("USDm Cup", ENTRY_FEE, SEED_AMOUNT, DURATION, false, {
          value: 0n,
        });
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);
      const start = BigInt(block.timestamp);

      await expect(tx)
        .to.emit(tournament, "TournamentCreated")
        .withArgs(
          0,
          creator.address,
          "USDm Cup",
          ENTRY_FEE,
          SEED_AMOUNT,
          start,
          start + BigInt(DURATION),
          false
        );
    });
    it("Should emit TournamentCreated with isNative true for a native tournament", async function () {
      const tx = await tournament
        .connect(creator)
        .createTournament("CELO Cup", ENTRY_FEE, SEED_AMOUNT, DURATION, true, {
          value: SEED_AMOUNT,
        });
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);
      const start = BigInt(block.timestamp);

      await expect(tx)
        .to.emit(tournament, "TournamentCreated")
        .withArgs(
          0,
          creator.address,
          "CELO Cup",
          ENTRY_FEE,
          SEED_AMOUNT,
          start,
          start + BigInt(DURATION),
          true
        );
    });
    it("Should emit the same startTime and endTime in the event as stored on the struct", async function () {
      const tx = await tournament
        .connect(creator)
        .createTournament("USDm Cup", ENTRY_FEE, SEED_AMOUNT, DURATION, false, {
          value: 0n,
        });

      const t = await tournament.tournaments(0);
      await expect(tx)
        .to.emit(tournament, "TournamentCreated")
        .withArgs(
          0,
          creator.address,
          "USDm Cup",
          ENTRY_FEE,
          SEED_AMOUNT,
          t.startTime,
          t.endTime,
          false
        );
    });
  });

  describe("nextTournamentId sequencing", function () {
    it("Should assign id 0 to the very first tournament", async function () {
      expect(await tournament.nextTournamentId()).to.equal(0n);

      await tournament
        .connect(creator)
        .createTournament("First", ENTRY_FEE, 0n, DURATION, false, { value: 0n });

      const t = await tournament.tournaments(0);
      expect(t.id).to.equal(0n);
    });
    it("Should increment nextTournamentId to 1 after one creation", async function () {
      await tournament
        .connect(creator)
        .createTournament("First", ENTRY_FEE, 0n, DURATION, false, { value: 0n });

      expect(await tournament.nextTournamentId()).to.equal(1n);
    });
    it("Should assign sequential ids 0, 1, 2 across three creations", async function () {
      for (let i = 0; i < 3; i++) {
        await tournament
          .connect(creator)
          .createTournament(`T${i}`, ENTRY_FEE, 0n, DURATION, false, { value: 0n });
      }

      expect((await tournament.tournaments(0)).id).to.equal(0n);
      expect((await tournament.tournaments(1)).id).to.equal(1n);
      expect((await tournament.tournaments(2)).id).to.equal(2n);
      expect(await tournament.nextTournamentId()).to.equal(3n);
    });
    it("Should keep ids sequential across mixed USDm and native creations", async function () {
      await tournament
        .connect(creator)
        .createTournament("USDm", ENTRY_FEE, SEED_AMOUNT, DURATION, false, { value: 0n });
      await tournament
        .connect(creator)
        .createTournament("CELO", ENTRY_FEE, SEED_AMOUNT, DURATION, true, { value: SEED_AMOUNT });
      await tournament
        .connect(creator)
        .createTournament("USDm2", ENTRY_FEE, 0n, DURATION, false, { value: 0n });

      expect((await tournament.tournaments(0)).isNative).to.equal(false);
      expect((await tournament.tournaments(1)).isNative).to.equal(true);
      expect((await tournament.tournaments(2)).isNative).to.equal(false);
      expect(await tournament.nextTournamentId()).to.equal(3n);
    });
  });

  describe("Initial tournament state", function () {
    it("Should leave winner unset and winningScore at zero on creation", async function () {
      await tournament
        .connect(creator)
        .createTournament("USDm Cup", ENTRY_FEE, SEED_AMOUNT, DURATION, false, { value: 0n });

      const t = await tournament.tournaments(0);
      expect(t.winner).to.equal(ethers.ZeroAddress);
      expect(t.winningScore).to.equal(0n);
    });
    it("Should start with a zero participant count", async function () {
      await tournament
        .connect(creator)
        .createTournament("USDm Cup", ENTRY_FEE, SEED_AMOUNT, DURATION, false, { value: 0n });

      const t = await tournament.tournaments(0);
      expect(t.participantCount).to.equal(0n);
    });
  });

});

describe("CeloFlashTournament — claimPrize & cancelTournament", function () {
  const ENTRY_FEE = ethers.parseEther("10");
  const SEED_AMOUNT = ethers.parseEther("20");
  const DURATION = 3600; // 1 hour (MIN_DURATION)
  const PROTOCOL_FEE_BPS = 500n;
  const BPS_DENOMINATOR = 10_000n;

  const FEE_PER_ENTRY = (ENTRY_FEE * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
  const PRIZE_PER_ENTRY = ENTRY_FEE - FEE_PER_ENTRY;
  const SENTINEL = ethers.MaxUint256; // type(uint256).max — "already refunded" marker

  let tournament;
  let usdm;
  let owner;
  let verifier;
  let feeRecipient;
  let creator;
  let players;

  let nonceCounter = 0;

  function uniqueNonce() {
    return ethers.encodeBytes32String(`cp-nonce-${nonceCounter++}`);
  }

  async function signScore(tournamentId, playerAddress, score, nonce) {
    const messageHash = ethers.solidityPackedKeccak256(
      ["uint256", "address", "uint256", "bytes32"],
      [tournamentId, playerAddress, score, nonce]
    );
    return verifier.signMessage(ethers.getBytes(messageHash));
  }

  async function createTournament({ isNative = false, seed = SEED_AMOUNT, entryFee = ENTRY_FEE } = {}) {
    const id = await tournament.nextTournamentId();
    await tournament
      .connect(creator)
      .createTournament("Claim Cup", entryFee, seed, DURATION, isNative, {
        value: isNative ? seed : 0n,
      });
    return id;
  }

  async function join(id, player, isNative) {
    await tournament
      .connect(player)
      .joinTournament(id, { value: isNative ? ENTRY_FEE : 0n });
  }

  async function submit(id, player, score) {
    const nonce = uniqueNonce();
    const sig = await signScore(id, player.address, score, nonce);
    await tournament.connect(player).submitScore(id, score, nonce, sig);
  }

  // Build a finalized tournament with a ranked leaderboard.
  //   scorers: [{ player, score }] — highest score becomes 1st place.
  //   noScoreJoiners: players that pay entry but never submit a score.
  async function finalizedTournament({ isNative = false, scorers = [], noScoreJoiners = [] } = {}) {
    const id = await createTournament({ isNative });
    for (const p of [...scorers.map((s) => s.player), ...noScoreJoiners]) {
      await join(id, p, isNative);
    }
    for (const { player, score } of scorers) {
      await submit(id, player, score);
    }
    await time.increase(DURATION + 1);
    await tournament.finalizeTournament(id);
    return id;
  }

  // Build a cancelled tournament after the given players have joined.
  async function cancelledTournament({ isNative = false, joiners = [] } = {}) {
    const id = await createTournament({ isNative });
    for (const p of joiners) {
      await join(id, p, isNative);
    }
    await tournament.connect(creator).cancelTournament(id);
    return id;
  }

  // Total prize pool for a finalized tournament: seed + prize contribution per joiner.
  function poolFor(joinerCount, seed = SEED_AMOUNT) {
    return seed + PRIZE_PER_ENTRY * BigInt(joinerCount);
  }

  beforeEach(async function () {
    [owner, verifier, feeRecipient, creator, ...players] = await ethers.getSigners();
    players = players.slice(0, 6);

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

  describe("Finalized — winner claims (USDm)", function () {
    it("Should pay the sole winner the exact claimablePrize amount", async function () {
      const id = await finalizedTournament({ scorers: [{ player: players[0], score: 300 }] });
      const expected = poolFor(1);

      expect(await tournament.claimablePrize(id, players[0].address)).to.equal(expected);

      await expect(tournament.connect(players[0]).claimPrize(id)).to.changeTokenBalance(
        usdm,
        players[0],
        expected
      );
    });
    it("Should reduce the contract USDm balance by the amount paid to the winner", async function () {
      const id = await finalizedTournament({ scorers: [{ player: players[0], score: 300 }] });
      const expected = poolFor(1);

      await expect(tournament.connect(players[0]).claimPrize(id)).to.changeTokenBalance(
        usdm,
        tournament,
        -expected
      );
    });
    it("Should zero the winner's claimablePrize after a successful claim", async function () {
      const id = await finalizedTournament({ scorers: [{ player: players[0], score: 300 }] });

      await tournament.connect(players[0]).claimPrize(id);

      expect(await tournament.claimablePrize(id, players[0].address)).to.equal(0n);
    });
    it("Should emit PrizeClaimed with the winner and exact amount", async function () {
      const id = await finalizedTournament({ scorers: [{ player: players[0], score: 300 }] });
      const expected = poolFor(1);

      await expect(tournament.connect(players[0]).claimPrize(id))
        .to.emit(tournament, "PrizeClaimed")
        .withArgs(id, players[0].address, expected);
    });
    // <<END:finalized-winner-usdm>>
  });

  describe("Finalized — prize distribution claims (USDm)", function () {
    // players[0]=1st (300), players[1]=2nd (200), players[2]=3rd (100)
    async function threeWinnerTournament() {
      return finalizedTournament({
        scorers: [
          { player: players[0], score: 300 },
          { player: players[1], score: 200 },
          { player: players[2], score: 100 },
        ],
      });
    }

    it("Should pay 2nd place 25% of the pool", async function () {
      const id = await threeWinnerTournament();
      const pool = poolFor(3);
      const second = (pool * 2500n) / BPS_DENOMINATOR;

      await expect(tournament.connect(players[1]).claimPrize(id)).to.changeTokenBalance(
        usdm,
        players[1],
        second
      );
    });
    it("Should pay 3rd place 15% of the pool", async function () {
      const id = await threeWinnerTournament();
      const pool = poolFor(3);
      const third = (pool * 1500n) / BPS_DENOMINATOR;

      await expect(tournament.connect(players[2]).claimPrize(id)).to.changeTokenBalance(
        usdm,
        players[2],
        third
      );
    });
    it("Should pay 1st place 60% plus any rounding dust", async function () {
      const id = await threeWinnerTournament();
      const pool = poolFor(3);
      const second = (pool * 2500n) / BPS_DENOMINATOR;
      const third = (pool * 1500n) / BPS_DENOMINATOR;
      const first = pool - second - third; // 60% + leftover dust

      await expect(tournament.connect(players[0]).claimPrize(id)).to.changeTokenBalance(
        usdm,
        players[0],
        first
      );
    });

    it("Should drain the pool exactly once fees are withdrawn and all three winners claim", async function () {
      const id = await threeWinnerTournament();
      const contractAddr = await tournament.getAddress();

      await tournament.withdrawFees();
      for (const p of [players[0], players[1], players[2]]) {
        await tournament.connect(p).claimPrize(id);
      }

      expect(await usdm.balanceOf(contractAddr)).to.equal(0n);
    });
    // <<END:finalized-distribution-usdm>>
  });

  describe("Finalized — two-winner split (USDm)", function () {
    async function twoWinnerTournament() {
      return finalizedTournament({
        scorers: [
          { player: players[0], score: 300 },
          { player: players[1], score: 200 },
        ],
      });
    }

    it("Should pay 1st place 70% of the pool with two winners", async function () {
      const id = await twoWinnerTournament();
      const pool = poolFor(2);
      const first = (pool * 7000n) / BPS_DENOMINATOR;

      await expect(tournament.connect(players[0]).claimPrize(id)).to.changeTokenBalance(
        usdm,
        players[0],
        first
      );
    });

    it("Should pay 2nd place the remaining 30% of the pool with two winners", async function () {
      const id = await twoWinnerTournament();
      const pool = poolFor(2);
      const first = (pool * 7000n) / BPS_DENOMINATOR;
      const second = pool - first;

      await expect(tournament.connect(players[1]).claimPrize(id)).to.changeTokenBalance(
        usdm,
        players[1],
        second
      );
    });
    // <<END:finalized-two-winner>>
  });

  describe("Finalized — winner claims (native CELO)", function () {
    it("Should pay the sole native winner via call{value} for the exact amount", async function () {
      const id = await finalizedTournament({
        isNative: true,
        scorers: [{ player: players[0], score: 300 }],
      });
      const expected = poolFor(1);

      await expect(tournament.connect(players[0]).claimPrize(id)).to.changeEtherBalance(
        players[0],
        expected
      );
    });
    it("Should reduce the contract native balance by the amount paid to the winner", async function () {
      const id = await finalizedTournament({
        isNative: true,
        scorers: [{ player: players[0], score: 300 }],
      });
      const expected = poolFor(1);

      await expect(tournament.connect(players[0]).claimPrize(id)).to.changeEtherBalance(
        tournament,
        -expected
      );
    });

    it("Should emit PrizeClaimed for a native winner claim", async function () {
      const id = await finalizedTournament({
        isNative: true,
        scorers: [{ player: players[0], score: 300 }],
      });
      const expected = poolFor(1);

      await expect(tournament.connect(players[0]).claimPrize(id))
        .to.emit(tournament, "PrizeClaimed")
        .withArgs(id, players[0].address, expected);
    });
    // <<END:finalized-winner-native>>
  });

  describe("Finalized — non-winner reverts", function () {
    // players[0..2] score & rank; players[3] joins but never scores.
    async function tournamentWithNonWinner() {
      return finalizedTournament({
        scorers: [
          { player: players[0], score: 300 },
          { player: players[1], score: 200 },
          { player: players[2], score: 100 },
        ],
        noScoreJoiners: [players[3]],
      });
    }

    it("Should revert NoPrizeToClaim for a joined player outside the top three", async function () {
      const id = await tournamentWithNonWinner();

      await expect(
        tournament.connect(players[3]).claimPrize(id)
      ).to.be.revertedWithCustomError(tournament, "NoPrizeToClaim");
    });
    it("Should revert NoPrizeToClaim for an address that never joined", async function () {
      const id = await tournamentWithNonWinner();

      await expect(
        tournament.connect(players[5]).claimPrize(id)
      ).to.be.revertedWithCustomError(tournament, "NoPrizeToClaim");
    });

    it("Should record zero claimablePrize for a non-winning participant", async function () {
      const id = await tournamentWithNonWinner();

      expect(await tournament.claimablePrize(id, players[3].address)).to.equal(0n);
    });

    it("Should move no USDm when a non-winner claim reverts", async function () {
      const id = await tournamentWithNonWinner();

      await expect(
        tournament.connect(players[3]).claimPrize(id)
      ).to.be.revertedWithCustomError(tournament, "NoPrizeToClaim");

      // Balances stay put; the revert leaves the pool intact.
      expect(await usdm.balanceOf(players[3].address)).to.equal(ethers.parseEther("990"));
    });
    // <<END:finalized-non-winner>>
  });

  describe("Finalized — double claim prevention", function () {
    it("Should revert NoPrizeToClaim on a second USDm claim by the winner", async function () {
      const id = await finalizedTournament({ scorers: [{ player: players[0], score: 300 }] });

      await tournament.connect(players[0]).claimPrize(id);

      await expect(
        tournament.connect(players[0]).claimPrize(id)
      ).to.be.revertedWithCustomError(tournament, "NoPrizeToClaim");
    });
    it("Should revert NoPrizeToClaim on a second native claim by the winner", async function () {
      const id = await finalizedTournament({
        isNative: true,
        scorers: [{ player: players[0], score: 300 }],
      });

      await tournament.connect(players[0]).claimPrize(id);

      await expect(
        tournament.connect(players[0]).claimPrize(id)
      ).to.be.revertedWithCustomError(tournament, "NoPrizeToClaim");
    });

    it("Should move no additional USDm on a reverted second claim", async function () {
      const id = await finalizedTournament({ scorers: [{ player: players[0], score: 300 }] });
      await tournament.connect(players[0]).claimPrize(id);
      const balanceAfterFirst = await usdm.balanceOf(players[0].address);

      await expect(
        tournament.connect(players[0]).claimPrize(id)
      ).to.be.revertedWithCustomError(tournament, "NoPrizeToClaim");

      expect(await usdm.balanceOf(players[0].address)).to.equal(balanceAfterFirst);
    });
    // <<END:finalized-double>>
  });

  describe("Active tournament — claim rejected", function () {
    it("Should revert TournamentNotActive when claiming on a still-active tournament", async function () {
      const id = await createTournament();
      await join(id, players[0], false);

      await expect(
        tournament.connect(players[0]).claimPrize(id)
      ).to.be.revertedWithCustomError(tournament, "TournamentNotActive");
    });

    it("Should revert TournamentNotActive when the winner claims before finalization", async function () {
      const id = await createTournament();
      await join(id, players[0], false);
      await submit(id, players[0], 300);
      await time.increase(DURATION + 1); // ended, but NOT finalized yet

      await expect(
        tournament.connect(players[0]).claimPrize(id)
      ).to.be.revertedWithCustomError(tournament, "TournamentNotActive");
    });
    // <<END:active-claim>>
  });

  describe("Cancelled — participant refunds (USDm)", function () {
    it("Should refund a participant the full entry fee via stablecoin transfer", async function () {
      const id = await cancelledTournament({ joiners: [players[0], players[1]] });

      await expect(tournament.connect(players[0]).claimPrize(id)).to.changeTokenBalances(
        usdm,
        [tournament, players[0]],
        [-ENTRY_FEE, ENTRY_FEE]
      );
    });
    it("Should emit PrizeClaimed with the entry fee as the refund amount", async function () {
      const id = await cancelledTournament({ joiners: [players[0]] });

      await expect(tournament.connect(players[0]).claimPrize(id))
        .to.emit(tournament, "PrizeClaimed")
        .withArgs(id, players[0].address, ENTRY_FEE);
    });

    it("Should mark the participant as refunded with the sentinel value", async function () {
      const id = await cancelledTournament({ joiners: [players[0]] });

      await tournament.connect(players[0]).claimPrize(id);

      expect(await tournament.claimablePrize(id, players[0].address)).to.equal(SENTINEL);
    });

    it("Should refund every participant independently", async function () {
      const joiners = [players[0], players[1], players[2]];
      const id = await cancelledTournament({ joiners });

      for (const p of joiners) {
        await expect(tournament.connect(p).claimPrize(id)).to.changeTokenBalance(
          usdm,
          p,
          ENTRY_FEE
        );
      }
    });
    // <<END:cancelled-usdm>>
  });

  describe("Cancelled — participant refunds (native CELO)", function () {
    it("Should refund a native participant via call{value}", async function () {
      const id = await cancelledTournament({ isNative: true, joiners: [players[0]] });

      await expect(tournament.connect(players[0]).claimPrize(id)).to.changeEtherBalance(
        players[0],
        ENTRY_FEE
      );
    });

    it("Should reduce the contract native balance by the refunded entry fee", async function () {
      const id = await cancelledTournament({ isNative: true, joiners: [players[0]] });

      await expect(tournament.connect(players[0]).claimPrize(id)).to.changeEtherBalance(
        tournament,
        -ENTRY_FEE
      );
    });

    it("Should emit PrizeClaimed for a native refund", async function () {
      const id = await cancelledTournament({ isNative: true, joiners: [players[0]] });

      await expect(tournament.connect(players[0]).claimPrize(id))
        .to.emit(tournament, "PrizeClaimed")
        .withArgs(id, players[0].address, ENTRY_FEE);
    });
    // <<END:cancelled-native>>
  });

  describe("Cancelled — double refund prevention", function () {
    it("Should revert NoPrizeToClaim on a second USDm refund", async function () {
      const id = await cancelledTournament({ joiners: [players[0]] });
      await tournament.connect(players[0]).claimPrize(id);

      await expect(
        tournament.connect(players[0]).claimPrize(id)
      ).to.be.revertedWithCustomError(tournament, "NoPrizeToClaim");
    });

    it("Should revert NoPrizeToClaim on a second native refund", async function () {
      const id = await cancelledTournament({ isNative: true, joiners: [players[0]] });
      await tournament.connect(players[0]).claimPrize(id);

      await expect(
        tournament.connect(players[0]).claimPrize(id)
      ).to.be.revertedWithCustomError(tournament, "NoPrizeToClaim");
    });

    it("Should keep the sentinel marker set after the first refund", async function () {
      const id = await cancelledTournament({ joiners: [players[0]] });
      await tournament.connect(players[0]).claimPrize(id);

      await expect(
        tournament.connect(players[0]).claimPrize(id)
      ).to.be.revertedWithCustomError(tournament, "NoPrizeToClaim");

      expect(await tournament.claimablePrize(id, players[0].address)).to.equal(SENTINEL);
    });

    it("Should move no additional USDm on a reverted second refund", async function () {
      const id = await cancelledTournament({ joiners: [players[0]] });
      await tournament.connect(players[0]).claimPrize(id);
      const balanceAfterFirst = await usdm.balanceOf(players[0].address);

      await expect(
        tournament.connect(players[0]).claimPrize(id)
      ).to.be.revertedWithCustomError(tournament, "NoPrizeToClaim");

      expect(await usdm.balanceOf(players[0].address)).to.equal(balanceAfterFirst);
    });
    // <<END:cancelled-double>>
  });

  describe("Cancelled — non-participant reverts", function () {
    it("Should revert NoPrizeToClaim for a non-participant on a cancelled USDm tournament", async function () {
      const id = await cancelledTournament({ joiners: [players[0]] });

      await expect(
        tournament.connect(players[1]).claimPrize(id)
      ).to.be.revertedWithCustomError(tournament, "NoPrizeToClaim");
    });

    it("Should revert NoPrizeToClaim for a non-participant on a cancelled native tournament", async function () {
      const id = await cancelledTournament({ isNative: true, joiners: [players[0]] });

      await expect(
        tournament.connect(players[1]).claimPrize(id)
      ).to.be.revertedWithCustomError(tournament, "NoPrizeToClaim");
    });
    // <<END:cancelled-nonparticipant>>
  });

  describe("cancelTournament — seed refund & fee accounting", function () {
    it("Should refund the USDm seed to the creator on cancellation", async function () {
      const id = await createTournament();

      await expect(tournament.connect(creator).cancelTournament(id)).to.changeTokenBalances(
        usdm,
        [tournament, creator],
        [-SEED_AMOUNT, SEED_AMOUNT]
      );
    });
    it("Should refund the native seed to the creator on cancellation", async function () {
      const id = await createTournament({ isNative: true });

      await expect(tournament.connect(creator).cancelTournament(id)).to.changeEtherBalance(
        creator,
        SEED_AMOUNT
      );
    });

    it("Should not attempt a transfer when the seed is zero", async function () {
      const id = await createTournament({ seed: 0n });

      await expect(tournament.connect(creator).cancelTournament(id)).to.changeTokenBalance(
        usdm,
        creator,
        0n
      );
    });
    it("Should reduce accumulatedFees by the cancelled entries' protocol portion (USDm)", async function () {
      const id = await createTournament();
      await join(id, players[0], false);
      await join(id, players[1], false);
      expect(await tournament.accumulatedFees()).to.equal(FEE_PER_ENTRY * 2n);

      await tournament.connect(creator).cancelTournament(id);

      expect(await tournament.accumulatedFees()).to.equal(0n);
    });

    it("Should reduce accumulatedNativeFees by the cancelled entries' protocol portion", async function () {
      const id = await createTournament({ isNative: true });
      await join(id, players[0], true);
      await join(id, players[1], true);
      expect(await tournament.accumulatedNativeFees()).to.equal(FEE_PER_ENTRY * 2n);

      await tournament.connect(creator).cancelTournament(id);

      expect(await tournament.accumulatedNativeFees()).to.equal(0n);
    });

    it("Should only claw back the cancelled tournament's own fees, not others'", async function () {
      const cancelledId = await createTournament();
      await join(cancelledId, players[0], false);
      await join(cancelledId, players[1], false);

      const survivingId = await createTournament();
      await join(survivingId, players[2], false);

      expect(await tournament.accumulatedFees()).to.equal(FEE_PER_ENTRY * 3n);

      await tournament.connect(creator).cancelTournament(cancelledId);

      // Only the surviving tournament's single entry fee remains.
      expect(await tournament.accumulatedFees()).to.equal(FEE_PER_ENTRY);
    });
    it("Should set the tournament status to Cancelled", async function () {
      const id = await createTournament();

      await tournament.connect(creator).cancelTournament(id);

      // TournamentStatus.Cancelled == 2
      expect((await tournament.tournaments(id)).status).to.equal(2);
    });

    it("Should leave no funds stuck after seed refund plus every USDm refund", async function () {
      const joiners = [players[0], players[1], players[2]];
      const id = await createTournament();
      for (const p of joiners) await join(id, p, false);

      await tournament.connect(creator).cancelTournament(id);
      for (const p of joiners) await tournament.connect(p).claimPrize(id);

      expect(await usdm.balanceOf(await tournament.getAddress())).to.equal(0n);
      expect(await tournament.accumulatedFees()).to.equal(0n);
    });
    // <<END:cancel-accounting>>
  });

  describe("cancelTournament — access control", function () {
    it("Should allow the creator to cancel", async function () {
      const id = await createTournament();

      await tournament.connect(creator).cancelTournament(id);

      expect((await tournament.tournaments(id)).status).to.equal(2);
    });

    it("Should allow the contract owner to cancel", async function () {
      const id = await createTournament();

      await tournament.connect(owner).cancelTournament(id);

      expect((await tournament.tournaments(id)).status).to.equal(2);
    });

    it("Should revert InvalidAddress when a non-creator/non-owner tries to cancel", async function () {
      const id = await createTournament();

      await expect(
        tournament.connect(players[0]).cancelTournament(id)
      ).to.be.revertedWithCustomError(tournament, "InvalidAddress");
    });

    it("Should refund the seed to the creator even when the owner cancels", async function () {
      const id = await createTournament();

      await expect(tournament.connect(owner).cancelTournament(id)).to.changeTokenBalances(
        usdm,
        [tournament, creator],
        [-SEED_AMOUNT, SEED_AMOUNT]
      );
    });
    // <<END:cancel-access>>
  });

  describe("cancelTournament — lifecycle guards", function () {
    it("Should revert TournamentAlreadyFinalized when cancelling a finalized tournament", async function () {
      const id = await finalizedTournament({ scorers: [{ player: players[0], score: 300 }] });

      await expect(
        tournament.connect(creator).cancelTournament(id)
      ).to.be.revertedWithCustomError(tournament, "TournamentAlreadyFinalized");
    });

    it("Should revert TournamentAlreadyFinalized when cancelling an already-cancelled tournament", async function () {
      const id = await createTournament();
      await tournament.connect(creator).cancelTournament(id);

      await expect(
        tournament.connect(creator).cancelTournament(id)
      ).to.be.revertedWithCustomError(tournament, "TournamentAlreadyFinalized");
    });
    // <<END:cancel-lifecycle>>
  });

  describe("TournamentCancelled event", function () {
    it("Should emit TournamentCancelled with the tournament id when the creator cancels", async function () {
      const id = await createTournament();

      await expect(tournament.connect(creator).cancelTournament(id))
        .to.emit(tournament, "TournamentCancelled")
        .withArgs(id);
    });

    it("Should emit TournamentCancelled when the owner cancels", async function () {
      const id = await createTournament({ isNative: true });

      await expect(tournament.connect(owner).cancelTournament(id))
        .to.emit(tournament, "TournamentCancelled")
        .withArgs(id);
    });

    it("Should be queryable by the indexed tournamentId topic", async function () {
      const id = await createTournament();
      await tournament.connect(creator).cancelTournament(id);

      const events = await tournament.queryFilter(
        tournament.filters.TournamentCancelled(id)
      );

      expect(events.length).to.equal(1);
      expect(events[0].args.tournamentId).to.equal(id);
    });
    // <<END:cancelled-event>>
  });

  describe("Finalized — winner state & claim ordering", function () {
    async function threeWinnerTournament() {
      return finalizedTournament({
        scorers: [
          { player: players[0], score: 300 },
          { player: players[1], score: 200 },
          { player: players[2], score: 100 },
        ],
      });
    }

    it("Should record the top scorer as winner with the winning score", async function () {
      const id = await threeWinnerTournament();

      const t = await tournament.tournaments(id);
      expect(t.winner).to.equal(players[0].address);
      expect(t.winningScore).to.equal(300n);
    });
    it("Should let winners claim in any order with unchanged amounts", async function () {
      const id = await threeWinnerTournament();
      const pool = poolFor(3);
      const second = (pool * 2500n) / BPS_DENOMINATOR;
      const third = (pool * 1500n) / BPS_DENOMINATOR;
      const first = pool - second - third;

      // Claim reverse order: 3rd, then 2nd, then 1st.
      await expect(tournament.connect(players[2]).claimPrize(id)).to.changeTokenBalance(
        usdm,
        players[2],
        third
      );
      await expect(tournament.connect(players[1]).claimPrize(id)).to.changeTokenBalance(
        usdm,
        players[1],
        second
      );
      await expect(tournament.connect(players[0]).claimPrize(id)).to.changeTokenBalance(
        usdm,
        players[0],
        first
      );
    });

    it("Should not affect another winner's claimable when one winner claims", async function () {
      const id = await threeWinnerTournament();
      const pool = poolFor(3);
      const second = (pool * 2500n) / BPS_DENOMINATOR;

      await tournament.connect(players[0]).claimPrize(id);

      // 2nd place claimable is untouched by 1st place's claim.
      expect(await tournament.claimablePrize(id, players[1].address)).to.equal(second);
    });
    // <<END:winner-state>>
  });

  describe("Cancelled — balances & refund ordering", function () {
    it("Should hold exactly entryFee per participant after cancellation (USDm)", async function () {
      const joiners = [players[0], players[1], players[2]];
      const id = await cancelledTournament({ joiners });

      // Seed already refunded on cancel; only entry fees remain.
      expect(await usdm.balanceOf(await tournament.getAddress())).to.equal(
        ENTRY_FEE * BigInt(joiners.length)
      );
    });

    it("Should refund participants correctly regardless of claim order", async function () {
      const joiners = [players[0], players[1], players[2]];
      const id = await cancelledTournament({ joiners });

      for (const p of [players[2], players[0], players[1]]) {
        await expect(tournament.connect(p).claimPrize(id)).to.changeTokenBalance(
          usdm,
          p,
          ENTRY_FEE
        );
      }
    });

    it("Should not touch another participant's claim state on refund", async function () {
      const id = await cancelledTournament({ joiners: [players[0], players[1]] });

      await tournament.connect(players[0]).claimPrize(id);

      // players[1] has not been marked as refunded.
      expect(await tournament.claimablePrize(id, players[1].address)).to.not.equal(SENTINEL);
    });
    // <<END:cancel-balances>>
  });

  describe("Full-drain invariants", function () {
    it("Should leave zero native balance after cancel seed refund plus all refunds", async function () {
      const joiners = [players[0], players[1], players[2]];
      const id = await createTournament({ isNative: true });
      for (const p of joiners) await join(id, p, true);

      await tournament.connect(creator).cancelTournament(id);
      for (const p of joiners) await tournament.connect(p).claimPrize(id);

      expect(await ethers.provider.getBalance(await tournament.getAddress())).to.equal(0n);
      expect(await tournament.accumulatedNativeFees()).to.equal(0n);
    });

    it("Should leave zero native balance after finalize, fee withdrawal, and winner claim", async function () {
      const id = await finalizedTournament({
        isNative: true,
        scorers: [{ player: players[0], score: 300 }],
      });

      await tournament.withdrawFees();
      await tournament.connect(players[0]).claimPrize(id);

      expect(await ethers.provider.getBalance(await tournament.getAddress())).to.equal(0n);
    });
    // <<END:full-drain>>
  });

  describe("claimPrize — miscellaneous guards", function () {
    it("Should revert TournamentNotActive for a non-existent tournament id", async function () {
      await expect(
        tournament.connect(players[0]).claimPrize(9999n)
      ).to.be.revertedWithCustomError(tournament, "TournamentNotActive");
    });

    it("Should report zero claimable for a cancelled participant before they claim", async function () {
      const id = await cancelledTournament({ joiners: [players[0]] });

      // Refund is derived from entryFee, not pre-seeded into claimablePrize.
      expect(await tournament.claimablePrize(id, players[0].address)).to.equal(0n);
    });
    it("Should not pay the fee recipient anything on a winner claim", async function () {
      const id = await finalizedTournament({ scorers: [{ player: players[0], score: 300 }] });

      await expect(tournament.connect(players[0]).claimPrize(id)).to.changeTokenBalance(
        usdm,
        feeRecipient,
        0n
      );
    });

    it("Should match the PrizeClaimed amount to the claimablePrize view for 2nd place", async function () {
      const id = await finalizedTournament({
        scorers: [
          { player: players[0], score: 300 },
          { player: players[1], score: 200 },
          { player: players[2], score: 100 },
        ],
      });
      const claimable = await tournament.claimablePrize(id, players[1].address);

      await expect(tournament.connect(players[1]).claimPrize(id))
        .to.emit(tournament, "PrizeClaimed")
        .withArgs(id, players[1].address, claimable);
    });
    // <<END:misc-guards>>
  });

  describe("Finalized — native distribution & event queries", function () {
    it("Should split 70/30 to two native winners on claim", async function () {
      const id = await finalizedTournament({
        isNative: true,
        scorers: [
          { player: players[0], score: 300 },
          { player: players[1], score: 200 },
        ],
      });
      const pool = poolFor(2);
      const first = (pool * 7000n) / BPS_DENOMINATOR;
      const second = pool - first;

      await expect(tournament.connect(players[0]).claimPrize(id)).to.changeEtherBalance(
        players[0],
        first
      );
      await expect(tournament.connect(players[1]).claimPrize(id)).to.changeEtherBalance(
        players[1],
        second
      );
    });

    it("Should expose PrizeClaimed via an indexed tournamentId query", async function () {
      const id = await finalizedTournament({ scorers: [{ player: players[0], score: 300 }] });
      await tournament.connect(players[0]).claimPrize(id);

      const events = await tournament.queryFilter(tournament.filters.PrizeClaimed(id));

      expect(events.length).to.equal(1);
      expect(events[0].args.player).to.equal(players[0].address);
      expect(events[0].args.amount).to.equal(poolFor(1));
    });
    // <<END:native-dist>>
  });

  describe("Finalized — pool composition & partial winners", function () {
    it("Should include no-score joiners' contributions in the sole winner's prize", async function () {
      // 1 scorer + 2 non-scoring joiners => single winner takes the whole 3-entry pool.
      const id = await finalizedTournament({
        scorers: [{ player: players[0], score: 300 }],
        noScoreJoiners: [players[1], players[2]],
      });
      const expected = poolFor(3);

      expect(await tournament.claimablePrize(id, players[0].address)).to.equal(expected);
      await expect(tournament.connect(players[0]).claimPrize(id)).to.changeTokenBalance(
        usdm,
        players[0],
        expected
      );
    });

    it("Should revert NoPrizeToClaim for a joined non-scorer in a two-winner tournament", async function () {
      const id = await finalizedTournament({
        scorers: [
          { player: players[0], score: 300 },
          { player: players[1], score: 200 },
        ],
        noScoreJoiners: [players[2]],
      });

      await expect(
        tournament.connect(players[2]).claimPrize(id)
      ).to.be.revertedWithCustomError(tournament, "NoPrizeToClaim");
    });
    // <<END:pool-composition>>
  });

  describe("Cross-tournament isolation & native sentinel", function () {
    it("Should keep refund state isolated between two cancelled tournaments", async function () {
      const idA = await cancelledTournament({ joiners: [players[0]] });
      const idB = await cancelledTournament({ joiners: [players[0]] });

      await tournament.connect(players[0]).claimPrize(idA);

      // Refunding in A must not mark the player refunded in B.
      expect(await tournament.claimablePrize(idA, players[0].address)).to.equal(SENTINEL);
      expect(await tournament.claimablePrize(idB, players[0].address)).to.equal(0n);

      // The player can still claim their B refund.
      await expect(tournament.connect(players[0]).claimPrize(idB)).to.changeTokenBalance(
        usdm,
        players[0],
        ENTRY_FEE
      );
    });

    it("Should set the sentinel marker after a native refund", async function () {
      const id = await cancelledTournament({ isNative: true, joiners: [players[0]] });

      await tournament.connect(players[0]).claimPrize(id);

      expect(await tournament.claimablePrize(id, players[0].address)).to.equal(SENTINEL);
    });
    // <<END:isolation-sentinel>>
  });

  describe("cancelTournament — native isolation & owner-triggered refunds", function () {
    it("Should only claw back the cancelled native tournament's own fees", async function () {
      const cancelledId = await createTournament({ isNative: true });
      await join(cancelledId, players[0], true);
      await join(cancelledId, players[1], true);

      const survivingId = await createTournament({ isNative: true });
      await join(survivingId, players[2], true);

      expect(await tournament.accumulatedNativeFees()).to.equal(FEE_PER_ENTRY * 3n);

      await tournament.connect(creator).cancelTournament(cancelledId);

      expect(await tournament.accumulatedNativeFees()).to.equal(FEE_PER_ENTRY);
    });

    it("Should let participants claim refunds after the owner cancels (USDm)", async function () {
      const joiners = [players[0], players[1]];
      const id = await createTournament();
      for (const p of joiners) await join(id, p, false);

      await tournament.connect(owner).cancelTournament(id);

      for (const p of joiners) {
        await expect(tournament.connect(p).claimPrize(id)).to.changeTokenBalance(
          usdm,
          p,
          ENTRY_FEE
        );
      }
    });

    it("Should hold exactly entryFee per participant after a native cancellation", async function () {
      const joiners = [players[0], players[1], players[2]];
      const id = await cancelledTournament({ isNative: true, joiners });

      expect(await ethers.provider.getBalance(await tournament.getAddress())).to.equal(
        ENTRY_FEE * BigInt(joiners.length)
      );
    });
    // <<END:native-isolation>>
  });

  describe("Finalized — claimable view accuracy", function () {
    async function threeWinnerTournament() {
      return finalizedTournament({
        scorers: [
          { player: players[0], score: 300 },
          { player: players[1], score: 200 },
          { player: players[2], score: 100 },
        ],
      });
    }

    it("Should assign the 60% share plus dust to 1st place in the claimable view", async function () {
      const id = await threeWinnerTournament();
      const pool = poolFor(3);
      const second = (pool * 2500n) / BPS_DENOMINATOR;
      const third = (pool * 1500n) / BPS_DENOMINATOR;
      const first = pool - second - third;

      expect(await tournament.claimablePrize(id, players[0].address)).to.equal(first);
    });

    it("Should have the three claimable shares sum to the full pool", async function () {
      const id = await threeWinnerTournament();
      const pool = poolFor(3);

      const first = await tournament.claimablePrize(id, players[0].address);
      const second = await tournament.claimablePrize(id, players[1].address);
      const third = await tournament.claimablePrize(id, players[2].address);

      expect(first + second + third).to.equal(pool);
    });
    // <<END:claimable-view>>
  });

  describe("Cancelled — native double refund is a no-op", function () {
    it("Should move no additional CELO on a reverted second native refund", async function () {
      // Two joiners so the contract still holds one refund's worth of CELO
      // after the first participant is refunded once.
      const id = await cancelledTournament({ isNative: true, joiners: [players[0], players[1]] });
      await tournament.connect(players[0]).claimPrize(id);

      const balanceAfterFirst = await ethers.provider.getBalance(await tournament.getAddress());

      await expect(
        tournament.connect(players[0]).claimPrize(id)
      ).to.be.revertedWithCustomError(tournament, "NoPrizeToClaim");

      // The reverted second refund leaves the contract's native balance untouched.
      expect(await ethers.provider.getBalance(await tournament.getAddress())).to.equal(
        balanceAfterFirst
      );
    });
    // <<END:native-double-noop>>
  });

  // __CLAIM_TESTS_MARKER__
});

describe("CeloFlashTournament — Leaderboard (insertion sort boundaries)", function () {
  const DURATION = 3600; // 1 hour (MIN_DURATION)

  // Ten distinct ascending scores for players[0..9]; submitting them in order
  // produces a full board sorted 1000 → 100 with players in reverse order.
  const FILL_SCORES = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];

  // Fixed "random" submission order used by the ordering tests.
  const RANDOM_SCORES = [730, 120, 990, 450, 310, 860, 40, 670, 555, 205];

  let tournament;
  let usdm;
  let owner;
  let verifier;
  let feeRecipient;
  let creator;
  let players;

  let lbNonceCounter = 0;

  function uniqueNonce() {
    return ethers.encodeBytes32String(`lb-nonce-${lbNonceCounter++}`);
  }

  async function signScore(tournamentId, playerAddress, score, nonce) {
    const messageHash = ethers.solidityPackedKeccak256(
      ["uint256", "address", "uint256", "bytes32"],
      [tournamentId, playerAddress, score, nonce]
    );
    return verifier.signMessage(ethers.getBytes(messageHash));
  }

  async function submit(tournamentId, player, score) {
    const nonce = uniqueNonce();
    const signature = await signScore(tournamentId, player.address, score, nonce);
    return tournament.connect(player).submitScore(tournamentId, score, nonce, signature);
  }

  // Free tournament: no entry fee or seed, so no token funding is needed
  // and the leaderboard logic is exercised in isolation.
  async function createFreeTournament() {
    const id = await tournament.nextTournamentId();
    await tournament
      .connect(creator)
      .createTournament("Leaderboard Cup", 0n, 0n, DURATION, false, { value: 0n });
    return id;
  }

  async function joinAll(tournamentId, joiners) {
    for (const player of joiners) {
      await tournament.connect(player).joinTournament(tournamentId);
    }
  }

  function expectDescending(lb) {
    for (let i = 1; i < lb.length; i++) {
      expect(lb[i - 1].score).to.be.gte(lb[i].score);
    }
  }

  function boardScores(lb) {
    return lb.map((entry) => entry.score);
  }

  function boardPlayers(lb) {
    return lb.map((entry) => entry.player);
  }

  // Fills the board with players[0..9] submitting FILL_SCORES in ascending
  // order, leaving a full 10-entry leaderboard sorted 1000 → 100.
  async function fillBoard(tournamentId) {
    for (let i = 0; i < 10; i++) {
      await submit(tournamentId, players[i], FILL_SCORES[i]);
    }
  }

  // Fresh deployment per test — leaderboard state must start empty.
  beforeEach(async function () {
    const signers = await ethers.getSigners();
    [owner, verifier, feeRecipient, creator] = signers;
    players = signers.slice(4, 16);

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
  });

  describe("Basics & single participant", function () {
    it("Should return an empty leaderboard before any score is submitted", async function () {
      const id = await createFreeTournament();
      await joinAll(id, [players[0]]);

      const lb = await tournament.getLeaderboard(id);

      expect(lb.length).to.equal(0);
    });

    it("Should hold exactly one entry after a single participant submits", async function () {
      const id = await createFreeTournament();
      await joinAll(id, [players[0]]);

      await submit(id, players[0], 500);

      const lb = await tournament.getLeaderboard(id);
      expect(lb.length).to.equal(1);
    });

    it("Should record the submitter's address and score on the entry", async function () {
      const id = await createFreeTournament();
      await joinAll(id, [players[0]]);

      await submit(id, players[0], 500);

      const [entry] = await tournament.getLeaderboard(id);
      expect(entry.player).to.equal(players[0].address);
      expect(entry.score).to.equal(500n);
    });

    it("Should stamp submittedAt with the submission block timestamp", async function () {
      const id = await createFreeTournament();
      await joinAll(id, [players[0]]);

      await submit(id, players[0], 500);
      const submissionTime = await time.latest();

      const [entry] = await tournament.getLeaderboard(id);
      expect(entry.submittedAt).to.equal(submissionTime);
    });
    // <<END:lb-basics>>
  });

  describe("Descending order maintenance", function () {
    it("Should keep two entries sorted when submitted high-then-low", async function () {
      const id = await createFreeTournament();
      await joinAll(id, players.slice(0, 2));

      await submit(id, players[0], 900);
      await submit(id, players[1], 100);

      const lb = await tournament.getLeaderboard(id);
      expect(boardScores(lb)).to.deep.equal([900n, 100n]);
    });

    it("Should re-sort two entries submitted low-then-high", async function () {
      const id = await createFreeTournament();
      await joinAll(id, players.slice(0, 2));

      await submit(id, players[0], 100);
      await submit(id, players[1], 900);

      const lb = await tournament.getLeaderboard(id);
      expect(boardScores(lb)).to.deep.equal([900n, 100n]);
      expect(boardPlayers(lb)).to.deep.equal([players[1].address, players[0].address]);
    });

    it("Should maintain descending order after every one of ten submissions", async function () {
      const id = await createFreeTournament();
      await joinAll(id, players.slice(0, 10));

      for (let i = 0; i < 10; i++) {
        await submit(id, players[i], RANDOM_SCORES[i]);
        expectDescending(await tournament.getLeaderboard(id));
      }
    });

    it("Should fully sort ten scores submitted in random order", async function () {
      const id = await createFreeTournament();
      await joinAll(id, players.slice(0, 10));

      for (let i = 0; i < 10; i++) {
        await submit(id, players[i], RANDOM_SCORES[i]);
      }

      const expected = [...RANDOM_SCORES]
        .sort((a, b) => b - a)
        .map((score) => BigInt(score));
      expect(boardScores(await tournament.getLeaderboard(id))).to.deep.equal(expected);
    });

    it("Should reverse ten strictly ascending submissions into descending order", async function () {
      const id = await createFreeTournament();
      await joinAll(id, players.slice(0, 10));

      await fillBoard(id);

      const expected = [...FILL_SCORES].reverse().map((score) => BigInt(score));
      expect(boardScores(await tournament.getLeaderboard(id))).to.deep.equal(expected);
    });

    it("Should preserve ten strictly descending submissions as-is", async function () {
      const id = await createFreeTournament();
      await joinAll(id, players.slice(0, 10));

      const descending = [...FILL_SCORES].reverse();
      for (let i = 0; i < 10; i++) {
        await submit(id, players[i], descending[i]);
      }

      const lb = await tournament.getLeaderboard(id);
      expect(boardScores(lb)).to.deep.equal(descending.map((score) => BigInt(score)));
      expect(boardPlayers(lb)).to.deep.equal(players.slice(0, 10).map((p) => p.address));
    });

    it("Should append a below-minimum score while the board is not yet full", async function () {
      const id = await createFreeTournament();
      await joinAll(id, players.slice(0, 4));

      await submit(id, players[0], 900);
      await submit(id, players[1], 800);
      await submit(id, players[2], 700);
      await submit(id, players[3], 5);

      const lb = await tournament.getLeaderboard(id);
      expect(lb.length).to.equal(4);
      expect(lb[3].player).to.equal(players[3].address);
      expect(lb[3].score).to.equal(5n);
    });
    // <<END:lb-ordering>>
  });

  describe("Top-10 cap and replacement", function () {
    it("Should cap the board at exactly ten entries once ten players submit", async function () {
      const id = await createFreeTournament();
      await joinAll(id, players.slice(0, 10));

      await fillBoard(id);

      expect((await tournament.getLeaderboard(id)).length).to.equal(10);
    });

    it("Should not add an 11th player whose score is below the entire board", async function () {
      const id = await createFreeTournament();
      await joinAll(id, players.slice(0, 11));
      await fillBoard(id);

      await submit(id, players[10], 50);

      const lb = await tournament.getLeaderboard(id);
      expect(lb.length).to.equal(10);
      expect(boardPlayers(lb)).to.not.include(players[10].address);
    });
    // <<END:lb-cap>>
  });

  // <<END:leaderboard-suite>>
});
