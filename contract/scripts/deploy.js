const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "CELO");

  // ─────────────────────────────────────────────
  // Configuration — update these for your deployment
  // ─────────────────────────────────────────────

  // USDM (Mountain Protocol) on Celo Mainnet: 0x59D9356E565Ab3A36dD77763Fc0d87fEaf85508C
  let defaultUSDM = "0x59D9356E565Ab3A36dD77763Fc0d87fEaf85508C";
  if (network.name === "alfajores") {
    defaultUSDM = "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1"; // Alfajores testnet token
  }
  const USDM_ADDRESS = process.env.USDM_ADDRESS || defaultUSDM;
  
  // Score verifier: the backend address that signs score attestations
  const SCORE_VERIFIER = process.env.SCORE_VERIFIER || deployer.address;
  
  // Fee & revenue recipient
  const FEE_RECIPIENT = process.env.FEE_RECIPIENT || deployer.address;
  
  // Treasury for wager house edge
  const TREASURY = process.env.TREASURY || deployer.address;
  
  // Wager score threshold (minimum score to win)
  const SCORE_THRESHOLD = process.env.SCORE_THRESHOLD || 5000;

  console.log("\n─── Configuration ───");
  console.log("USDm Address:     ", USDM_ADDRESS);
  console.log("Score Verifier:   ", SCORE_VERIFIER);
  console.log("Fee Recipient:    ", FEE_RECIPIENT);
  console.log("Treasury:         ", TREASURY);
  console.log("Score Threshold:  ", SCORE_THRESHOLD);
  console.log("────────────────────\n");

  // ─────────────────────────────────────────────
  // 1. Deploy CeloFlashTournament
  // ─────────────────────────────────────────────
  console.log("1/3 Deploying CeloFlashTournament...");
  const Tournament = await ethers.getContractFactory("CeloFlashTournament");
  const tournament = await Tournament.deploy(
    USDM_ADDRESS,
    SCORE_VERIFIER,
    FEE_RECIPIENT
  );
  await tournament.waitForDeployment();
  const tournamentAddr = await tournament.getAddress();
  console.log("   ✅ CeloFlashTournament deployed at:", tournamentAddr);

  // ─────────────────────────────────────────────
  // 2. Deploy CeloFlashStore
  // ─────────────────────────────────────────────
  console.log("2/3 Deploying CeloFlashStore...");
  const Store = await ethers.getContractFactory("CeloFlashStore");
  const store = await Store.deploy(
    USDM_ADDRESS,
    FEE_RECIPIENT
  );
  await store.waitForDeployment();
  const storeAddr = await store.getAddress();
  console.log("   ✅ CeloFlashStore deployed at:", storeAddr);

  // ─────────────────────────────────────────────
  // 3. Deploy CeloFlashWager
  // ─────────────────────────────────────────────
  console.log("3/3 Deploying CeloFlashWager...");
  const Wager = await ethers.getContractFactory("CeloFlashWager");
  const wager = await Wager.deploy(
    SCORE_VERIFIER,
    TREASURY,
    SCORE_THRESHOLD
  );
  await wager.waitForDeployment();
  const wagerAddr = await wager.getAddress();
  console.log("   ✅ CeloFlashWager deployed at:", wagerAddr);

  // ─────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════");
  console.log("  DEPLOYMENT COMPLETE ⚡");
  console.log("═══════════════════════════════════════════");
  console.log("  CeloFlashTournament: ", tournamentAddr);
  console.log("  CeloFlashStore:      ", storeAddr);
  console.log("  CeloFlashWager:      ", wagerAddr);
  console.log("═══════════════════════════════════════════\n");

  // Output for .env / frontend config
  console.log("Add to your .env or frontend config:");
  console.log(`REACT_APP_TOURNAMENT_ADDRESS=${tournamentAddr}`);
  console.log(`REACT_APP_STORE_ADDRESS=${storeAddr}`);
  console.log(`REACT_APP_WAGER_ADDRESS=${wagerAddr}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
