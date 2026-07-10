const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying CeloFlashSavings with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "CELO");

  // USDM (Mountain Protocol) on Celo Mainnet: 0x59D9356E565Ab3A36dD77763Fc0d87fEaf85508C
  let defaultUSDM = "0x59D9356E565Ab3A36dD77763Fc0d87fEaf85508C";
  let defaultAavePool = "0x7a12dCfd73C1B4cddf294da4cFce75FcaBBa314C"; // Aave V3 Celo Mainnet Pool
  let defaultAToken = "0x0000000000000000000000000000000000000000"; // Should be configured via env for mainnet

  if (network.name === "alfajores") {
    defaultUSDM = "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1"; // Alfajores testnet token (cUSD)
    defaultAavePool = "0x0000000000000000000000000000000000000000";
    defaultAToken = "0x0000000000000000000000000000000000000000";
  }

  const USDM_ADDRESS = process.env.USDM_ADDRESS || defaultUSDM;
  const AAVE_POOL_ADDRESS = process.env.AAVE_POOL_ADDRESS || defaultAavePool;
  const AAVE_ATOKEN_ADDRESS = process.env.AAVE_ATOKEN_ADDRESS || defaultAToken;

  console.log("\n─── Configuration ───");
  console.log("USDm Address:     ", USDM_ADDRESS);
  console.log("Aave Pool Address:", AAVE_POOL_ADDRESS);
  console.log("aUSDm Address:    ", AAVE_ATOKEN_ADDRESS);
  console.log("────────────────────\n");

  const Savings = await ethers.getContractFactory("CeloFlashSavings");
  const savings = await Savings.deploy(USDM_ADDRESS, AAVE_POOL_ADDRESS, AAVE_ATOKEN_ADDRESS);
  await savings.waitForDeployment();
  const savingsAddr = await savings.getAddress();

  console.log("\n═══════════════════════════════════════════");
  console.log("  DEPLOYMENT COMPLETE ⚡");
  console.log("═══════════════════════════════════════════");
  console.log("  CeloFlashSavings: ", savingsAddr);
  console.log("═══════════════════════════════════════════\n");

  console.log("Add to your .env or frontend config:");
  console.log(`REACT_APP_SAVINGS_ADDRESS=${savingsAddr}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
