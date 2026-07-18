const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("CeloFlashTournament — Extended Fee & Accounting Coverage", function () {
  const ENTRY_FEE = ethers.parseEther("10");
  const SEED_AMOUNT = ethers.parseEther("20");
  const DURATION = 3600; // MIN_DURATION
  const PROTOCOL_FEE_BPS = 500n;
  const BPS_DENOMINATOR = 10_000n;
  const FEE_PER_ENTRY = (ENTRY_FEE * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
  const PRIZE_PER_ENTRY = ENTRY_FEE - FEE_PER_ENTRY;

  let tournament, usdm, owner, verifier, feeRecipient, creator, players;
  let nonceCounter = 0;
  const uniqueNonce = () => ethers.encodeBytes32String(`x-nonce-${nonceCounter++}`);

  async function signScore(id, addr, score, nonce) {
    const h = ethers.solidityPackedKeccak256(
      ["uint256", "address", "uint256", "bytes32"],
      [id, addr, score, nonce]
    );
    return verifier.signMessage(ethers.getBytes(h));
  }

  async function createTournament({ isNative = false, seed = SEED_AMOUNT, entryFee = ENTRY_FEE } = {}) {
    const id = await tournament.nextTournamentId();
    await tournament
      .connect(creator)
      .createTournament("Extended", entryFee, seed, DURATION, isNative, {
        value: isNative ? seed : 0n,
      });
    return id;
  }

  async function joinAll(id, joiners, isNative) {
    for (const p of joiners) {
      await tournament.connect(p).joinTournament(id, { value: isNative ? ENTRY_FEE : 0n });
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

    for (const p of players) {
      await usdm.mint(p.address, ethers.parseEther("1000"));
      await usdm.connect(p).approve(await tournament.getAddress(), ethers.MaxUint256);
    }
  });

  it("emits exactly one FeesWithdrawn event for a native-only fee pool", async function () {
    const id = await createTournament({ isNative: true });
    await joinAll(id, players, true);

    expect(await tournament.accumulatedFees()).to.equal(0);
    expect(await tournament.accumulatedNativeFees()).to.equal(FEE_PER_ENTRY * 5n);

    const receipt = await (await tournament.withdrawFees()).wait();
    const feeEvents = receipt.logs
      .map((log) => {
        try {
          return tournament.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .filter((p) => p && p.name === "FeesWithdrawn");

    expect(feeEvents.length).to.equal(1);
    expect(feeEvents[0].args.isNative).to.equal(true);
    expect(feeEvents[0].args.amount).to.equal(FEE_PER_ENTRY * 5n);
  });

  it("routes USDm fees to a rotated feeRecipient", async function () {
    const id = await createTournament();
    await joinAll(id, players, false);
    const expectedFees = FEE_PER_ENTRY * 5n;

    await tournament.connect(owner).setFeeRecipient(players[0].address);

    await expect(tournament.withdrawFees()).to.changeTokenBalances(
      usdm,
      [feeRecipient, players[0]],
      [0n, expectedFees]
    );
    expect(await tournament.accumulatedFees()).to.equal(0);
  });

  it("routes native fees to a rotated feeRecipient", async function () {
    const id = await createTournament({ isNative: true });
    await joinAll(id, players, true);
    const expectedFees = FEE_PER_ENTRY * 5n;

    await tournament.connect(owner).setFeeRecipient(players[0].address);

    await expect(tournament.withdrawFees()).to.changeEtherBalances(
      [feeRecipient, players[0]],
      [0n, expectedFees]
    );
    expect(await tournament.accumulatedNativeFees()).to.equal(0);
  });
});
