const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CeloFlashStore", function () {
  let store;
  let mockUSDm;
  let owner, revenue, player1, player2;

  const INITIAL_BALANCE = ethers.parseEther("1000");

  beforeEach(async function () {
    [owner, revenue, player1, player2] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockERC20");
    mockUSDm = await MockToken.deploy("Mock USDm", "USDm", 18);
    await mockUSDm.waitForDeployment();

    const Store = await ethers.getContractFactory("CeloFlashStore");
    store = await Store.deploy(
      await mockUSDm.getAddress(),
      revenue.address
    );
    await store.waitForDeployment();

    for (const player of [player1, player2]) {
      await mockUSDm.mint(player.address, INITIAL_BALANCE);
      await mockUSDm
        .connect(player)
        .approve(await store.getAddress(), ethers.MaxUint256);
    }
  });

  describe("Deployment", function () {
    it("should set correct initial values", async function () {
      expect(await store.stablecoin()).to.equal(await mockUSDm.getAddress());
      expect(await store.revenueRecipient()).to.equal(revenue.address);
    });

    it("should initialize default item prices", async function () {
      // PowerupShield = type 1
      const [price, active, maxPerTx] = await store.getItem(1);
      expect(price).to.equal(ethers.parseEther("0.08"));
      expect(active).to.be.true;
      expect(maxPerTx).to.equal(10);
    });
  });

  describe("Purchase Items", function () {
    it("should allow purchasing a single power-up", async function () {
      const balBefore = await mockUSDm.balanceOf(player1.address);
      await store.connect(player1).purchaseItem(1, 1); // Shield x1
      const balAfter = await mockUSDm.balanceOf(player1.address);

      expect(balBefore - balAfter).to.equal(ethers.parseEther("0.08"));
      expect(await store.getPlayerPurchaseCount(player1.address, 1)).to.equal(1);
    });

    it("should allow purchasing multiple items", async function () {
      await store.connect(player1).purchaseItem(6, 5); // ScoreMultiplier x5
      expect(await store.getPlayerPurchaseCount(player1.address, 6)).to.equal(5);
    });

    it("should emit ItemPurchased event", async function () {
      await expect(store.connect(player1).purchaseItem(0, 2))
        .to.emit(store, "ItemPurchased")
        .withArgs(0, player1.address, 0, 2, ethers.parseEther("0.16"));
    });

    it("should revert on zero quantity", async function () {
      await expect(
        store.connect(player1).purchaseItem(1, 0)
      ).to.be.revertedWithCustomError(store, "InvalidQuantity");
    });

    it("should revert if exceeds max per tx", async function () {
      await expect(
        store.connect(player1).purchaseItem(1, 11) // maxPerTx = 10
      ).to.be.revertedWithCustomError(store, "ExceedsMaxPerTx");
    });

    it("should revert on inactive item", async function () {
      await store.setItem(1, ethers.parseEther("0.08"), false, 10);
      await expect(
        store.connect(player1).purchaseItem(1, 1)
      ).to.be.revertedWithCustomError(store, "ItemNotActive");
    });

    it("should track total revenue", async function () {
      await store.connect(player1).purchaseItem(3, 1); // PowerupBundle: $0.20
      expect(await store.totalRevenue()).to.equal(ethers.parseEther("0.20"));
    });
  });

  describe("Admin Functions", function () {
    it("should update item price", async function () {
      await store.setItem(1, ethers.parseEther("0.15"), true, 20);
      const [price, active, maxPerTx] = await store.getItem(1);
      expect(price).to.equal(ethers.parseEther("0.15"));
      expect(maxPerTx).to.equal(20);
    });

    it("should withdraw revenue", async function () {
      await store.connect(player1).purchaseItem(3, 1);
      const balBefore = await mockUSDm.balanceOf(revenue.address);
      await store.withdrawRevenue();
      const balAfter = await mockUSDm.balanceOf(revenue.address);
      expect(balAfter).to.be.gt(balBefore);
    });

    it("should pause and unpause", async function () {
      await store.pause();
      await expect(
        store.connect(player1).purchaseItem(1, 1)
      ).to.be.revertedWithCustomError(store, "EnforcedPause");

      await store.unpause();
      await store.connect(player1).purchaseItem(1, 1);
    });

    it("should only allow owner to set items", async function () {
      await expect(
        store.connect(player1).setItem(1, 0, false, 0)
      ).to.be.revertedWithCustomError(store, "OwnableUnauthorizedAccount");
    });
  });
});
