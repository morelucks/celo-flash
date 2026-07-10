# GitHub Issues: AI Savings Coach & Round-Up Integration

Use these 10 professional-grade issues to track, implement, and deploy the AI Savings Coach ("Acorns for Celo Flash") project for the hackathon.

---

### Issue 1: [Smart Contract] Design and Deploy `CeloFlashSavings.sol`
**Description:**
Create the on-chain vault where user savings are held. The contract should allow users to lock USDm (and optionally CELO), query their balance, and withdraw their saved funds.

**Tasks:**
- [ ] Implement `deposit(address user, uint256 amount)` (only callable by approved sources or direct player).
- [ ] Implement `withdraw(uint256 amount)` with ReentrancyGuard.
- [ ] Include events: `SavingsDeposited(address indexed user, uint256 amount, uint256 timestamp)` and `SavingsWithdrawn(address indexed user, uint256 amount)`.
- [ ] Deploy contract to Celo Alfajores Testnet/Mainnet and verify on block explorer.

**Acceptance Criteria:**
- Contract is fully verified on Celoscan/Blockscout.
- Automated tests verify that users cannot withdraw more than their balance.

---

### Issue 2: [DeFi Integration] Add Yield-Generation Routing (Aave v3)
**Description:**
Maximize savings utility by routing deposited USDm into Aave V3 on Celo to earn yield while players are saving.

**Tasks:**
- [ ] Integrate Aave V3 Pool interface (`supply` and `withdraw`).
- [ ] In `CeloFlashSavings.sol`, when a deposit occurs, automatically supply the USDm to the Aave Pool.
- [ ] Map the claimable yield back to the user's principal balance.
- [ ] Implement rescue function for stuck tokens (owner-only).

**Acceptance Criteria:**
- Depositing USDm successfully mints interest-bearing Aave tokens (aUSDm) held by the contract.
- Withdrawal burns the corresponding aUSDm and returns principal + accrued yield to the player.

---

### Issue 3: [Frontend] Implement ERC-8021 Transaction Attribution Suffix
**Description:**
To be tracked on the hackathon leaderboard, all transactions must append the ERC-8021 attribution code to the transaction calldata.

**Tasks:**
- [ ] Write `getAttributionSuffix(tag)` utility helper in JavaScript/TypeScript.
- [ ] Ensure formatting conforms to ERC-8021 (Codes Length + Code Ascii Hex + Schema ID `00` + ERC Marker `80218021802180218021802180218021`).
- [ ] Add unit tests verifying suffix length and marker validity.

**Acceptance Criteria:**
- Suffix correctly appends to dummy data string and returns valid hex structure.

---

### Issue 4: [Frontend] Wire `CeloFlashStore.sol` to On-Chain Payments
**Description:**
Migrate the `StoreScreen.jsx` component from using local storage simulation (`setCash`) to actual smart contract calls via the user's connected wallet (MetaMask/MiniPay).

**Tasks:**
- [ ] Load `CeloFlashStore` ABI and address.
- [ ] Implement approve/transfer allowance flow for USDm before store purchases.
- [ ] Call `purchaseItem(ItemType, quantity)` on the store contract.
- [ ] Append the ERC-8021 attribution tag suffix to the purchase transactions.

**Acceptance Criteria:**
- Purchasing an item triggers a wallet prompt in MiniPay.
- On-chain event is emitted and frontend UI updates with the purchased powerups.

---

### Issue 5: [Frontend] Create "AI Savings Coach" Chat Interface
**Description:**
Build a conversational drawer/overlay where the AI Savings Coach interacts with the user to establish goals and coach them on saving.

**Tasks:**
- [ ] Design a clean, responsive chat window in the UI.
- [ ] Set up state management for conversational messages (stored locally).
- [ ] Program conversational flows for setting goals (e.g. "Save $10 for spawner skin", "Save $50 for rent").
- [ ] Store active goals and targets in user context/state.

**Acceptance Criteria:**
- Player can set a goal via natural language chat.
- Goal state (target and current progress) is persistent across sessions.

---

### Issue 6: [Frontend] Implement Auto-Round-Up Core Calculation Logic
**Description:**
Integrate the calculation logic that detects item prices in `StoreScreen` and calculates the required round-up amount.

**Tasks:**
- [ ] Add an "Enable AI Round-Up Coach" switch in `StoreScreen.jsx`.
- [ ] Calculate the delta to the next whole dollar (or custom threshold) for any purchase.
  - *Example: $0.04 Multiplier + $0.96 Round-up = $1.00 total.*
- [ ] Display the round-up amount dynamically underneath the buy button.

**Acceptance Criteria:**
- Toggling the coach switch displays the correct round-up delta for all items.

---

### Issue 7: [Frontend] Coordinate Multi-Contract Transaction Bundling
**Description:**
When a player makes a purchase with "Round-Up" enabled, execute both the store payment and the savings deposit on-chain.

**Tasks:**
- [ ] Implement a function to execute two transactions sequentially (1. Store Purchase, 2. Deposit to `CeloFlashSavings`).
- [ ] Ensure that if the store purchase succeeds, the round-up is automatically pushed to the savings contract.
- [ ] Append the ERC-8021 attribution suffix to *both* transactions.

**Acceptance Criteria:**
- Buying a $0.04 item with round-up enabled executes the purchase and sends $0.96 to the savings contract.

---

### Issue 8: [Backend] Build the Agent Nudge & Progress Service
**Description:**
Create the notification system that acts as the "coach." It calculates metrics and sends motivating messages to players based on their actions.

**Tasks:**
- [ ] Track total round-ups saved per player.
- [ ] Generate coach prompts (e.g., *"You've saved $4.50 this week playing Celo Flash! You are 45% closer to your Goal."*).
- [ ] Integrate lightweight LLM (or structured templates) to make nudges feel personalized and conversational.

**Acceptance Criteria:**
- Coach updates pop up on the home screen after a game session if savings have increased.

---

### Issue 9: [Metadata] Register Agent with EIP-8004 Standard Compliance
**Description:**
To officially register the Savings Coach as an on-chain agent, deploy its metadata using the EIP-8004 spec.

**Tasks:**
- [ ] Draft an EIP-8004 compliant metadata JSON (spec version `#registration-v1`, `services` array, `endpoint` fields).
- [ ] Pin the metadata JSON to IPFS.
- [ ] Call `register(ipfsUrl)` on the ERC-8004 Identity Registry on Celo Mainnet (`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`).

**Acceptance Criteria:**
- Agent registration returns a valid `agentId`.
- No validation warnings on `8004scan.io`.

---

### Issue 10: [Testing & GTM] End-to-End Integration & Leaderboard Check
**Description:**
Perform final system tests to verify transaction flows, leaderboard tracking, and prepare the project for hackathon submission.

**Tasks:**
- [ ] Test the full game flow (wagers, store purchases, round-ups) on Celo mainnet.
- [ ] Confirm transactions are picked up by the hackathon attribution dashboard using your tag.
- [ ] Submit the final project using the Celo Builders skill CLI:
  ```bash
  npx skills add https://celobuilders.xyz
  # Ask the agent:
  "Help me submit my project to the Celo Agentic Payments & DeFAI Hackathon."
  ```

**Acceptance Criteria:**
- Tagged transactions are visible on-chain.
- Project is successfully registered and submitted via the skill.
