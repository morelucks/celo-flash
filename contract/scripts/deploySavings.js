const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying CeloFlashSavings with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "CELO");

  // USDM (Mountain Protocol) on Celo Mainnet: 0x59D9356E565Ab3A36dD77763Fc0d87fEaf85508C
  let defaultUSDM = "0x59D9356E565Ab3A36dD77763Fc0d87fEaf85508C";
  if (network.name === "alfajores") {
    defaultUSDM = "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1"; // Alfajores testnet token (cUSD)
  }
  const USDM_ADDRESS = process.env.USDM_ADDRESS || defaultUSDM;

  console.log("\n─── Configuration ───");
  console.log("USDm Address:     ", USDM_ADDRESS);
  console.log("────────────────────\n");

  const Savings = await ethers.getContractFactory("CeloFlashSavings");
  const savings = await Savings.deploy(USDM_ADDRESS);
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
