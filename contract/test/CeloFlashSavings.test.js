const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CeloFlashSavings", function () {
  let savingsContract;
  let mockStablecoin;
  let owner;
  let player;
  let approvedSource;
  let unapprovedSource;

  beforeEach(async function () {
    [owner, player, approvedSource, unapprovedSource] = await ethers.getSigners();

    // Deploy Mock USDm
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockStablecoin = await MockERC20.deploy("Mock USDm", "USDm", 18);
    await mockStablecoin.waitForDeployment();

    // Deploy CeloFlashSavings
    const CeloFlashSavings = await ethers.getContractFactory("CeloFlashSavings");
    savingsContract = await CeloFlashSavings.deploy(await mockStablecoin.getAddress());
    await savingsContract.waitForDeployment();

    // Mint stablecoin to player and approved source for testing
    await mockStablecoin.mint(player.address, ethers.parseEther("1000"));
    await mockStablecoin.mint(approvedSource.address, ethers.parseEther("1000"));

    // Approve savings contract to spend player's and source's tokens
    await mockStablecoin.connect(player).approve(await savingsContract.getAddress(), ethers.MaxUint256);
    await mockStablecoin.connect(approvedSource).approve(await savingsContract.getAddress(), ethers.MaxUint256);
  });

  describe("Constructor", function () {
    it("Should set the correct stablecoin address", async function () {
      expect(await savingsContract.stablecoin()).to.equal(await mockStablecoin.getAddress());
    });

    it("Should set the deployer as owner", async function () {
      expect(await savingsContract.owner()).to.equal(owner.address);
    });
  });

  describe("Approved Sources", function () {
    it("Should allow owner to approve a source", async function () {
      await expect(savingsContract.setApprovedSource(approvedSource.address, true))
        .to.emit(savingsContract, "SourceApprovalUpdated")
        .withArgs(approvedSource.address, true);

      expect(await savingsContract.approvedSources(approvedSource.address)).to.be.true;
    });

    it("Should allow owner to revoke approval", async function () {
      await savingsContract.setApprovedSource(approvedSource.address, true);
      await expect(savingsContract.setApprovedSource(approvedSource.address, false))
        .to.emit(savingsContract, "SourceApprovalUpdated")
        .withArgs(approvedSource.address, false);

      expect(await savingsContract.approvedSources(approvedSource.address)).to.be.false;
    });

    it("Should revert if non-owner tries to approve source", async function () {
      const CeloFlashSavings = await ethers.getContractFactory("CeloFlashSavings");
      const errorMsg = "OwnableUnauthorizedAccount";
      await expect(
        savingsContract.connect(player).setApprovedSource(approvedSource.address, true)
      ).to.be.revertedWithCustomError(savingsContract, errorMsg);
    });
  });

  describe("USDm Deposits", function () {
    it("Should allow player to deposit USDm directly", async function () {
      const depositAmount = ethers.parseEther("50");

      await expect(savingsContract.connect(player).deposit(player.address, depositAmount))
        .to.emit(savingsContract, "SavingsDeposited")
        .withArgs(player.address, await mockStablecoin.getAddress(), depositAmount, anyTimestamp => true);

      expect(await savingsContract.usdmBalances(player.address)).to.equal(depositAmount);
      expect(await savingsContract.totalUSDmLocked()).to.equal(depositAmount);
    });

    it("Should allow approved source to deposit on behalf of player", async function () {
      const depositAmount = ethers.parseEther("10");
      await savingsContract.setApprovedSource(approvedSource.address, true);

      await expect(savingsContract.connect(approvedSource).deposit(player.address, depositAmount))
        .to.emit(savingsContract, "SavingsDeposited")
        .withArgs(player.address, await mockStablecoin.getAddress(), depositAmount, anyTimestamp => true);

      expect(await savingsContract.usdmBalances(player.address)).to.equal(depositAmount);
    });

    it("Should revert if unapproved source tries to deposit on behalf of player", async function () {
      const depositAmount = ethers.parseEther("10");

      await expect(
        savingsContract.connect(unapprovedSource).deposit(player.address, depositAmount)
      ).to.be.revertedWithCustomError(savingsContract, "Unauthorized");
    });

    it("Should revert deposit of zero amount", async function () {
      await expect(
        savingsContract.connect(player).deposit(player.address, 0)
      ).to.be.revertedWithCustomError(savingsContract, "ZeroAmount");
    });
  });

  describe("CELO Deposits", function () {
    it("Should allow player to deposit CELO", async function () {
      const depositAmount = ethers.parseEther("2");

      await expect(savingsContract.connect(player).depositCELO(player.address, { value: depositAmount }))
        .to.emit(savingsContract, "SavingsDeposited")
        .withArgs(player.address, ethers.ZeroAddress, depositAmount, anyTimestamp => true);

      expect(await savingsContract.celoBalances(player.address)).to.equal(depositAmount);
      expect(await savingsContract.totalCELOLocked()).to.equal(depositAmount);
    });

    it("Should credit sender if native CELO is received via fallback", async function () {
      const depositAmount = ethers.parseEther("1.5");

      const tx = await player.sendTransaction({
        to: await savingsContract.getAddress(),
        value: depositAmount,
      });

      await expect(tx)
        .to.emit(savingsContract, "SavingsDeposited")
        .withArgs(player.address, ethers.ZeroAddress, depositAmount, anyTimestamp => true);

      expect(await savingsContract.celoBalances(player.address)).to.equal(depositAmount);
    });

    it("Should revert CELO deposit of zero amount", async function () {
      await expect(
        savingsContract.connect(player).depositCELO(player.address, { value: 0 })
      ).to.be.revertedWithCustomError(savingsContract, "ZeroAmount");
    });
  });

  describe("USDm Withdrawals", function () {
    const depositAmount = ethers.parseEther("100");

    beforeEach(async function () {
      await savingsContract.connect(player).deposit(player.address, depositAmount);
    });

    it("Should allow player to withdraw their USDm savings", async function () {
      const withdrawAmount = ethers.parseEther("40");
      const expectedBalance = depositAmount - withdrawAmount;

      await expect(savingsContract.connect(player).withdraw(withdrawAmount))
        .to.emit(savingsContract, "SavingsWithdrawn")
        .withArgs(player.address, await mockStablecoin.getAddress(), withdrawAmount, anyTimestamp => true);

      expect(await savingsContract.usdmBalances(player.address)).to.equal(expectedBalance);
      expect(await savingsContract.totalUSDmLocked()).to.equal(expectedBalance);
    });

    it("Should revert if player tries to withdraw more USDm than their balance", async function () {
      const excessAmount = ethers.parseEther("150");

      await expect(
        savingsContract.connect(player).withdraw(excessAmount)
      ).to.be.revertedWithCustomError(savingsContract, "InsufficientBalance");
    });
  });

  describe("CELO Withdrawals", function () {
    const depositAmount = ethers.parseEther("5");

    beforeEach(async function () {
      await savingsContract.connect(player).depositCELO(player.address, { value: depositAmount });
    });

    it("Should allow player to withdraw their CELO savings", async function () {
      const withdrawAmount = ethers.parseEther("2");
      const expectedBalance = depositAmount - withdrawAmount;

      await expect(savingsContract.connect(player).withdrawCELO(withdrawAmount))
        .to.emit(savingsContract, "SavingsWithdrawn")
        .withArgs(player.address, ethers.ZeroAddress, withdrawAmount, anyTimestamp => true);

      expect(await savingsContract.celoBalances(player.address)).to.equal(expectedBalance);
      expect(await savingsContract.totalCELOLocked()).to.equal(expectedBalance);
    });

    it("Should revert if player tries to withdraw more CELO than their balance", async function () {
      const excessAmount = ethers.parseEther("10");

      await expect(
        savingsContract.connect(player).withdrawCELO(excessAmount)
      ).to.be.revertedWithCustomError(savingsContract, "InsufficientBalance");
    });
  });

  describe("Pause / Unpause", function () {
    it("Should stop deposits when paused", async function () {
      await savingsContract.pause();

      await expect(
        savingsContract.connect(player).deposit(player.address, ethers.parseEther("10"))
      ).to.be.revertedWithCustomError(savingsContract, "EnforcedPause");

      await expect(
        savingsContract.connect(player).depositCELO(player.address, { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(savingsContract, "EnforcedPause");
    });

    it("Should allow deposits after unpausing", async function () {
      await savingsContract.pause();
      await savingsContract.unpause();

      const depositAmount = ethers.parseEther("10");
      await expect(savingsContract.connect(player).deposit(player.address, depositAmount))
        .to.emit(savingsContract, "SavingsDeposited");
    });
  });
});
