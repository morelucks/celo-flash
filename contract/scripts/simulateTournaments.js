const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

const TOURNAMENT_ADDRESS = "0xe176d352Fab71c0FE992d41Ae512eDC1830d3494";
const WALLETS_FILE = path.join(__dirname, "simulatedWallets.json");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const [deployer] = await ethers.getSigners();
  const provider = deployer.provider;

  console.log(`Deployer / Verifier address: ${deployer.address}`);
  const startBalance = await provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${ethers.formatEther(startBalance)} CELO`);

  // Load contract instance
  const tournamentContract = await ethers.getContractAt("CeloFlashTournament", TOURNAMENT_ADDRESS);

  // Check verifier address on-chain
  const verifierOnChain = await tournamentContract.scoreVerifier();
  console.log(`Verifier address on-chain: ${verifierOnChain}`);

  // Load simulated wallets
  if (!fs.existsSync(WALLETS_FILE)) {
    console.error(`Simulated wallets file not found at: ${WALLETS_FILE}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(WALLETS_FILE, "utf8"));
  const privateKeys = data.privateKeys || [];
  console.log(`Loaded ${privateKeys.length} simulated private keys.`);

  if (privateKeys.length === 0) {
    console.error("No private keys found in simulatedWallets.json");
    process.exit(1);
  }

  const wallets = privateKeys.slice(0, 5).map(pk => new ethers.Wallet(pk, provider));
  console.log(`Using 5 simulated wallets for tournament matchmaking and score submission.`);

  // 1. Create a native tournament
  console.log("\n--- Step 1: Creating native CELO tournament ---");
  const tournamentName = `Arcade Cup - Sim ${Date.now().toString().slice(-4)}`;
  const entryFee = ethers.parseEther("0.01"); // 0.01 CELO
  const seedAmount = ethers.parseEther("0.05"); // 0.05 CELO
  const durationSecs = 3600; // 1 hour

  console.log(`Creating tournament "${tournamentName}"...`);
  const createTx = await tournamentContract.createTournament(
    tournamentName,
    entryFee,
    seedAmount,
    durationSecs,
    true, // isNative = true
    { value: seedAmount }
  );
  console.log(`Tx sent: ${createTx.hash}`);
  const receipt = await createTx.wait();
  console.log("Tournament created successfully on-chain!");

  // Read nextTournamentId to get the ID of the created tournament
  const nextId = await tournamentContract.nextTournamentId();
  const tournamentId = nextId - 1n;
  console.log(`Active Tournament ID: ${tournamentId}`);

  const tInfo = await tournamentContract.getTournament(tournamentId);
  console.log(`Tournament info from contract:
    id: ${tInfo.id}
    name: ${tInfo.name}
    entryFee: ${ethers.formatEther(tInfo.entryFee)} CELO
    seedAmount: ${ethers.formatEther(tInfo.seedAmount)} CELO
    prizePool: ${ethers.formatEther(tInfo.prizePool)} CELO
    startTime: ${tInfo.startTime}
    endTime: ${tInfo.endTime}
    isNative: ${tInfo.isNative}
    status: ${tInfo.status}
  `);

  // 2. Fund and Join
  console.log("\n--- Step 2: Funding and joining simulated players ---");
  for (let i = 0; i < wallets.length; i++) {
    const player = wallets[i];
    const balance = await provider.getBalance(player.address);
    console.log(`Player ${i+1} (${player.address}) balance: ${ethers.formatEther(balance)} CELO`);

    // Fund player if they don't have enough CELO for gas + entry fee
    if (balance < ethers.parseEther("0.1")) {
      const fundAmount = ethers.parseEther("0.12");
      console.log(`Funding Player ${i+1} with ${ethers.formatEther(fundAmount)} CELO...`);
      const fundTx = await deployer.sendTransaction({
        to: player.address,
        value: fundAmount
      });
      await fundTx.wait();
      console.log(`Funding confirmed for Player ${i+1}.`);
    }

    // Join tournament
    console.log(`Player ${i+1} joining tournament ${tournamentId}...`);
    const joinTx = await tournamentContract.connect(player).joinTournament(
      tournamentId,
      { value: entryFee }
    );
    await joinTx.wait();
    console.log(`Player ${i+1} joined successfully! Tx: ${joinTx.hash}`);
    await sleep(500);
  }

  // 3. Submit Scores with Server Attestations
  console.log("\n--- Step 3: Simulating gameplay & submitting attested scores ---");
  for (let i = 0; i < wallets.length; i++) {
    const player = wallets[i];
    const score = Math.floor(5000 + Math.random() * 15000); // Score between 5000 and 20000
    const nonce = ethers.randomBytes(32);

    // Build signed message payload
    const messageHash = ethers.solidityPackedKeccak256(
      ["uint256", "address", "uint256", "bytes32"],
      [tournamentId, player.address, score, nonce]
    );

    // Score attestation signed by the verifier (deployer)
    const signature = await deployer.signMessage(ethers.getBytes(messageHash));

    console.log(`Submitting score of ${score} for Player ${i+1} (${player.address})...`);
    const scoreTx = await tournamentContract.connect(player).submitScore(
      tournamentId,
      score,
      nonce,
      signature
    );
    await scoreTx.wait();
    console.log(`Score submitted! Tx: ${scoreTx.hash}`);
    await sleep(500);
  }

  // 4. View Leaderboard
  console.log("\n--- Step 4: Displaying final tournament leaderboard ---");
  const leaderboard = await tournamentContract.getLeaderboard(tournamentId);
  console.log(`Leaderboard for Tournament #${tournamentId}:`);
  leaderboard.forEach((entry, index) => {
    console.log(` Rank ${index + 1}: ${entry.player} - Score: ${entry.score.toString()} (Submitted: ${new Date(Number(entry.submittedAt) * 1000).toLocaleString()})`);
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
