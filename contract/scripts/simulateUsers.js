const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

const ATTRIBUTION_TAG = "celo_ac49c3b4e348";
const SAVINGS_ADDRESS = "0x2C576E1bBe7dFe92C8847ee56a646EFf115Fa0Dc";
const WALLETS_FILE = path.join(__dirname, "simulatedWallets.json");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getAttributionSuffix(tag) {
  const tagHex = Buffer.from(tag, "utf-8").toString("hex");
  const lenHex = tagHex.length / 2;
  const lenByte = lenHex.toString(16).padStart(2, "0");
  const schemaId = "00";
  const marker = "80218021802180218021802180218021";
  return lenByte + tagHex + schemaId + marker;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const provider = deployer.provider;

  console.log(`Deployer address: ${deployer.address}`);
  const startBalance = await provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${ethers.formatEther(startBalance)} CELO`);

  const CeloFlashSavings = await ethers.getContractFactory("CeloFlashSavings");
  const savingsInterface = CeloFlashSavings.interface;
  const suffix = getAttributionSuffix(ATTRIBUTION_TAG);

  // Check if we should regenerate or append new wallets
  const forceRegenerate = process.argv.includes("--reset");
  const addArgIndex = process.argv.indexOf("--add");
  let addCount = 0;
  if (addArgIndex !== -1 && addArgIndex + 1 < process.argv.length) {
    addCount = parseInt(process.argv[addArgIndex + 1], 10);
  } else if (process.env.ADD) {
    addCount = parseInt(process.env.ADD, 10);
  }

  let privateKeys = [];
  if (fs.existsSync(WALLETS_FILE) && !forceRegenerate) {
    console.log("Loading existing simulated wallets...");
    try {
      const data = JSON.parse(fs.readFileSync(WALLETS_FILE, "utf8"));
      privateKeys = data.privateKeys || [];
      console.log(`Loaded ${privateKeys.length} existing wallets.`);
    } catch (e) {
      console.log("Error reading simulated wallets file, will regenerate.");
    }
  }

  if (addCount > 0) {
    console.log(`Adding ${addCount} new progressive wallets to the existing set...`);
    for (let i = 0; i < addCount; i++) {
      const w = ethers.Wallet.createRandom();
      privateKeys.push(w.privateKey);
    }
    fs.writeFileSync(
      WALLETS_FILE,
      JSON.stringify({ privateKeys }, null, 2),
      "utf8"
    );
    console.log(`Saved updated wallets file. Total: ${privateKeys.length}`);
  } else if (privateKeys.length === 0) {
    console.log("Generating 10 new random wallets...");
    privateKeys = [];
    for (let i = 0; i < 10; i++) {
      const w = ethers.Wallet.createRandom();
      privateKeys.push(w.privateKey);
    }
    fs.writeFileSync(
      WALLETS_FILE,
      JSON.stringify({ privateKeys }, null, 2),
      "utf8"
    );
    console.log(`Saved 10 simulated wallets to ${WALLETS_FILE}`);
  }

  const wallets = [];
  for (let i = 0; i < privateKeys.length; i++) {
    const w = new ethers.Wallet(privateKeys[i], provider);
    wallets.push(w);
    console.log(`Wallet ${i+1}: ${w.address}`);
  }

  console.log("\n--- Step 1: Checking and Funding wallets ---");
  for (let i = 0; i < wallets.length; i++) {
    await sleep(800); // Prevent rate limiting
    const wallet = wallets[i];
    const balance = await provider.getBalance(wallet.address);
    console.log(`Wallet ${i+1} (${wallet.address}) balance: ${ethers.formatEther(balance)} CELO`);

    // Fund only if balance is less than 0.045 CELO to ensure enough cover for gas price spikes + value
    if (balance < ethers.parseEther("0.045")) {
      const fundAmount = ethers.parseEther("0.05");
      console.log(`Funding wallet ${i+1} with ${ethers.formatEther(fundAmount)} CELO...`);
      const tx = await deployer.sendTransaction({
        to: wallet.address,
        value: fundAmount
      });
      console.log(`Tx: ${tx.hash}`);
      await tx.wait();
    } else {
      console.log(`Wallet ${i+1} already has sufficient funds.`);
    }
  }

  // Load contract instance to read savings state
  const contract = await ethers.getContractAt("CeloFlashSavings", SAVINGS_ADDRESS);

  console.log("\n--- Step 2: Sending tagged deposits ---");
  for (let i = 0; i < wallets.length; i++) {
    await sleep(800); // Prevent rate limiting
    const wallet = wallets[i];

    // Print current saved balance, then proceed with depositing again
    const savedCelo = await contract.celoBalances(wallet.address);
    console.log(`Wallet ${i+1} (${wallet.address}) currently has ${ethers.formatEther(savedCelo)} CELO saved in contract.`);

    const baseCalldata = savingsInterface.encodeFunctionData("depositCELO", [wallet.address]);
    const taggedCalldata = baseCalldata + suffix;

    console.log(`Sending deposit from wallet ${i+1} (${wallet.address})...`);
    const tx = await wallet.sendTransaction({
      to: SAVINGS_ADDRESS,
      data: taggedCalldata,
      value: ethers.parseEther("0.001"), // deposit 0.001 CELO
      gasLimit: 100000, // Explicit gas limit
    });
    console.log(`Deposit successful! Tx: ${tx.hash}`);
    await tx.wait();
  }

  console.log("\nAll 10 unique wallets have successfully interacted with the contract!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
