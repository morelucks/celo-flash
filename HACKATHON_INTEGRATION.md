# Hackathon Integration Guide: Agentic Payments & DeFAI

This guide outlines exactly how to integrate the **Agentic Payments & DeFAI Hackathon** requirements into the Celo Flash project.

---

## 1. Register & Obtain Attribution Tag (Day 1)

Attribution tags are based on **ERC-8021**. To get tracked on the live leaderboard for the **Most Revenue Generated** and **Most x402 Payments** tracks, you must register your project.

### CLI Registration Steps
Run the following command in your terminal to install the Celo Builders skill:
```bash
npx skills add https://celobuilders.xyz
```
Then ask your AI coding agent (or run the interactive prompt) to register you by providing:
1. **Project Name:** `Celo Flash`
2. **Public GitHub Repo:** `https://github.com/.../celo-flash` (Update with your actual URL)
3. **Telegram Handle:** `@your_telegram`

You will instantly receive your unique attribution tag (e.g., `celo_flash_123456`).

---

## 2. Implement Transaction Attribution (ERC-8021)

To attribute transactions on-chain, you must append your attribution tag to the transaction's `calldata` (the `data` field in web3 transactions). 

Because the tag is appended to the very end of the calldata, it **does not interfere with smart contract execution** (EVM contracts ignore trailing data).

### How the Calldata Suffix is Constructed
The suffix follows this byte structure:
$$\text{Original Calldata} + [\text{Codes Length}] + [\text{Codes (Tag)}] + [\text{Schema ID}] + [\text{ERC Marker}]$$

Where:
* **ERC Marker (16 bytes):** Fixed hex `80218021802180218021802180218021` (identifies it as ERC-8021).
* **Schema ID (1 byte):** `00` (representing Schema 0).
* **Codes:** The ASCII representation of your assigned tag (e.g., `celo_flash_123456`).
* **Codes Length (1 byte):** The length in bytes of the tag.

#### Javascript Suffix Generator (Zero Dependencies)
You can include this helper directly in your frontend (e.g., in a utility file or context):

```javascript
/**
 * Generates an ERC-8021 compliant calldata suffix for Celo transaction attribution.
 * @param {string} tag - Your assigned hackathon tag (e.g., 'celo_flash_123456')
 * @returns {string} The hex suffix to append to transaction data.
 */
export function getAttributionSuffix(tag) {
  // Convert ASCII tag string to hex
  const tagHex = Array.from(tag)
    .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');
  
  const lengthByte = (tagHex.length / 2).toString(16).padStart(2, '0');
  const schemaId = '00';
  const ercMarker = '80218021802180218021802180218021';
  
  return lengthByte + tagHex + schemaId + ercMarker;
}
```

### Usage Example with `window.ethereum`
When calling your contracts (e.g., purchasing a spawner in the store or joining a tournament), append the suffix to your transaction data:

```javascript
const attributionTag = "celo_flash_YOUR_TAG"; // Replace with your registered tag
const suffix = getAttributionSuffix(attributionTag);

// Example contract call payload:
const transactionParameters = {
  to: STORE_CONTRACT_ADDRESS, // CeloFlashStore address
  from: userAddress,
  data: originalCalldata + suffix, // Append suffix directly
};

// Send transaction via MiniPay/MetaMask
const txHash = await window.ethereum.request({
  method: 'eth_sendTransaction',
  params: [transactionParameters],
});
```

---

## 3. Wire Up Frontend to Smart Contracts

Currently, screens like `StoreScreen.jsx` and `TourneysScreen.jsx` use mock client-side state. To count volume/revenue for the hackathon, you must route these interactions through your deployed smart contracts (`CeloFlashStore.sol` and `CeloFlashTournament.sol`) on Celo (Mainnet or Alfajores).

### A. Store Purchases (`CeloFlashStore.sol`)
Modify `handleBuySpawner` or power-up handlers in `StoreScreen.jsx` to call `purchaseItem(ItemType itemType, uint256 quantity)`:
* **ItemTypes:**
  * `0`: PowerupMagnet
  * `1`: PowerupShield
  * `2`: PowerupClock
  * `3`: PowerupBundle
  * `4`: SpawnerValora
  * `5`: SpawnerMento
  * `6`: ScoreMultiplier
  * `7`: DailyRenewal

### B. Tournament Actions (`CeloFlashTournament.sol`)
* **Join:** Call `joinTournament(uint256 tournamentId)`.
* **Submit Score:** Call `submitScore(uint256 tournamentId, uint256 score, bytes32 nonce, bytes signature)`.

---

## 4. Track-Specific Integrations

### Track 2: Most x402 Payments
If you want to support pay-per-request micropayments, you can configure your backend API to settle stablecoins using Celo's x402 facilitator.
* **Server-side response:** Return HTTP `402 Payment Required` with headers pointing to the USDm token address (`0x765DE816845861e75A25fCA122bb6898B8B1282a` on Mainnet) or USDC/USDT.
* **Client-side:** Make API requests using `@coinbase/x402` or manual signing wrapper to automatically handle payment headers.

### Track 3 & 4: Askbots and Aigora
If you are developing a DeFAI judge agent:
1. Register your agent on [askbots.ai](https://askbots.ai).
2. Register your agent on [aigora.org](https://aigora.org/) and submit feedback.
3. Submit the project metadata with EIP-8004 metadata compliance using the Celo Builders skill.

---

## 5. Submit Your Project
Once the app is live and transactions are tagged, submit using the Celo Builders skill:
```bash
# Ask your AI coding agent:
"Help me submit my project to the Celo Agentic Payments & DeFAI Hackathon."
```
This will guide you to choice selection, questionnaire filling, and tweeting validation.
