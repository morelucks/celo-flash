const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CeloFlashSavings", function () {
  let savingsContract;
  let mockStablecoin;
  let mockAToken;
  let mockAavePool;
  let owner;
  let player;
  let player2;
  let approvedSource;
  let unapprovedSource;

  beforeEach(async function () {
    [owner, player, player2, approvedSource, unapprovedSource] = await ethers.getSigners();

    // Deploy Mock USDm
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockStablecoin = await MockERC20.deploy("Mock USDm", "USDm", 18);
    await mockStablecoin.waitForDeployment();

    // Deploy Mock aUSDm
    mockAToken = await MockERC20.deploy("Mock aUSDm", "aUSDm", 18);
    await mockAToken.waitForDeployment();

    // Deploy Mock Aave Pool
    const MockAavePool = await ethers.getContractFactory("MockAavePool");
    mockAavePool = await MockAavePool.deploy(await mockStablecoin.getAddress(), await mockAToken.getAddress());
    await mockAavePool.waitForDeployment();

    // Deploy CeloFlashSavings
    const CeloFlashSavings = await ethers.getContractFactory("CeloFlashSavings");
    savingsContract = await CeloFlashSavings.deploy(
      await mockStablecoin.getAddress(),
      await mockAavePool.getAddress(),
      await mockAToken.getAddress()
    );
    await savingsContract.waitForDeployment();

    // Mint stablecoin to player, player2, and approved source for testing
    await mockStablecoin.mint(player.address, ethers.parseEther("1000"));
    await mockStablecoin.mint(player2.address, ethers.parseEther("1000"));
    await mockStablecoin.mint(approvedSource.address, ethers.parseEther("1000"));

    // Approve savings contract to spend player's, player2's, and source's tokens
    await mockStablecoin.connect(player).approve(await savingsContract.getAddress(), ethers.MaxUint256);
    await mockStablecoin.connect(player2).approve(await savingsContract.getAddress(), ethers.MaxUint256);
    await mockStablecoin.connect(approvedSource).approve(await savingsContract.getAddress(), ethers.MaxUint256);
  });

  describe("Constructor", function () {
    it("Should set the correct stablecoin address", async function () {
      expect(await savingsContract.stablecoin()).to.equal(await mockStablecoin.getAddress());
    });

    it("Should set the correct aave pool and aToken address", async function () {
      expect(await savingsContract.aavePool()).to.equal(await mockAavePool.getAddress());
      expect(await savingsContract.aToken()).to.equal(await mockAToken.getAddress());
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
      const errorMsg = "OwnableUnauthorizedAccount";
      await expect(
        savingsContract.connect(player).setApprovedSource(approvedSource.address, true)
      ).to.be.revertedWithCustomError(savingsContract, errorMsg);
    });
  });

  describe("USDm Deposits & Aave Integration", function () {
    it("Should allow player to deposit USDm directly and supply to Aave", async function () {
      const depositAmount = ethers.parseEther("50");

      await expect(savingsContract.connect(player).deposit(player.address, depositAmount))
        .to.emit(savingsContract, "SavingsDeposited")
        .withArgs(player.address, await mockStablecoin.getAddress(), depositAmount, anyTimestamp => true);

      expect(await savingsContract.usdmBalances(player.address)).to.equal(depositAmount);
      expect(await savingsContract.totalUSDmLocked()).to.equal(depositAmount);
      
      // Verification of Aave State:
      // aToken (aUSDm) should be minted to the CeloFlashSavings contract
      expect(await mockAToken.balanceOf(await savingsContract.getAddress())).to.equal(depositAmount);
      // Underlying USDm should be held by the Mock Aave Pool
      expect(await mockStablecoin.balanceOf(await mockAavePool.getAddress())).to.equal(depositAmount);
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

  describe("USDm Yield Routing & Withdrawals", function () {
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

    it("Should accrue yield and allow withdrawing principal + yield", async function () {
      const savingsAddr = await savingsContract.getAddress();
      
      // Simulate Aave yield generation: Mint 10 more aUSDm to the savings contract
      const yieldAmount = ethers.parseEther("10");
      await mockAToken.mint(savingsAddr, yieldAmount);

      // Verify that the player's balance has dynamically increased to reflect the yield
      const expectedTotal = depositAmount + yieldAmount;
      expect(await savingsContract.usdmBalances(player.address)).to.equal(expectedTotal);
      expect(await savingsContract.totalUSDmLocked()).to.equal(expectedTotal);

      // Withdraw the entire principal + yield
      const initialPlayerBalance = await mockStablecoin.balanceOf(player.address);
      await expect(savingsContract.connect(player).withdraw(expectedTotal))
        .to.emit(savingsContract, "SavingsWithdrawn")
        .withArgs(player.address, await mockStablecoin.getAddress(), expectedTotal, anyTimestamp => true);

      // Verify balances after full withdrawal
      expect(await savingsContract.usdmBalances(player.address)).to.equal(0);
      expect(await savingsContract.totalUSDmLocked()).to.equal(0);

      const finalPlayerBalance = await mockStablecoin.balanceOf(player.address);
      expect(finalPlayerBalance - initialPlayerBalance).to.equal(expectedTotal);
    });

    it("Should distribute accrued yield proportionally to multiple depositors", async function () {
      const savingsAddr = await savingsContract.getAddress();
      
      // Player 2 deposits same amount
      await savingsContract.connect(player2).deposit(player2.address, depositAmount);

      // Total locked is now 200 USDm
      expect(await savingsContract.totalUSDmLocked()).to.equal(depositAmount * 2n);

      // Simulate yield: Mint 20 aUSDm yield to the savings contract
      const yieldAmount = ethers.parseEther("20");
      await mockAToken.mint(savingsAddr, yieldAmount);

      // Yield should be split 50/50: 10 USDm each
      const expectedBalance = depositAmount + ethers.parseEther("10");
      expect(await savingsContract.usdmBalances(player.address)).to.equal(expectedBalance);
      expect(await savingsContract.usdmBalances(player2.address)).to.equal(expectedBalance);

      // Player 1 withdraws all
      await savingsContract.connect(player).withdraw(expectedBalance);
      
      // Player 2's balance should still be correct
      expect(await savingsContract.usdmBalances(player2.address)).to.equal(expectedBalance);
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

  describe("Token Rescue (Admin Only)", function () {
    let randomToken;

    beforeEach(async function () {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      randomToken = await MockERC20.deploy("Random Token", "RND", 18);
      await randomToken.waitForDeployment();
      
      // Transfer some random tokens to the savings contract
      await randomToken.mint(await savingsContract.getAddress(), ethers.parseEther("100"));
    });

    it("Should allow the owner to rescue ERC20 tokens", async function () {
      const rescueAmount = ethers.parseEther("100");
      const savingsAddr = await savingsContract.getAddress();

      await expect(savingsContract.connect(owner).rescueTokens(await randomToken.getAddress(), player.address, rescueAmount))
        .to.emit(savingsContract, "TokensRescued")
        .withArgs(await randomToken.getAddress(), player.address, rescueAmount);

      expect(await randomToken.balanceOf(savingsAddr)).to.equal(0);
      expect(await randomToken.balanceOf(player.address)).to.equal(rescueAmount);
    });

    it("Should allow the owner to rescue native CELO", async function () {
      const depositAmount = ethers.parseEther("1");
      const savingsAddr = await savingsContract.getAddress();

      // Send native CELO to contract without calling depositCELO
      await owner.sendTransaction({
        to: savingsAddr,
        value: depositAmount,
      });

      const initialPlayerBalance = await ethers.provider.getBalance(player.address);

      await expect(savingsContract.connect(owner).rescueTokens(ethers.ZeroAddress, player.address, depositAmount))
        .to.emit(savingsContract, "TokensRescued")
        .withArgs(ethers.ZeroAddress, player.address, depositAmount);

      const finalPlayerBalance = await ethers.provider.getBalance(player.address);
      expect(finalPlayerBalance - initialPlayerBalance).to.equal(depositAmount);
    });

    it("Should revert if non-owner tries to rescue tokens", async function () {
      const errorMsg = "OwnableUnauthorizedAccount";
      await expect(
        savingsContract.connect(player).rescueTokens(await randomToken.getAddress(), player.address, ethers.parseEther("10"))
      ).to.be.revertedWithCustomError(savingsContract, errorMsg);
    });

    it("Should revert rescue if amount is zero or destination address is zero", async function () {
      await expect(
        savingsContract.connect(owner).rescueTokens(await randomToken.getAddress(), ethers.ZeroAddress, ethers.parseEther("10"))
      ).to.be.revertedWithCustomError(savingsContract, "InvalidAddress");

      await expect(
        savingsContract.connect(owner).rescueTokens(await randomToken.getAddress(), player.address, 0)
      ).to.be.revertedWithCustomError(savingsContract, "ZeroAmount");
    });
  });
});
