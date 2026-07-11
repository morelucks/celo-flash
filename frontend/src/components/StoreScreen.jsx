import React, { useState, useEffect } from 'react';
import { useGameState } from '../context/GameStateContext';
import { playSound } from '../utils/audio';
import { isMiniPay, redirectToDeposit } from '../utils/minipay';
import { ethers } from 'ethers';
import { CELO_FLASH_STORE_ABI } from '../utils/storeAbi';
import { appendAttribution } from '../utils/attribution';

const STORE_ADDRESS = "0xBfAD9eE3378a8266DF49A74909b9262808A8a4cC";
const SAVINGS_ADDRESS = "0x2C576E1bBe7dFe92C8847ee56a646EFf115Fa0Dc";

export default function StoreScreen() {
  const { 
    cash, 
    setCash, 
    setPoints, 
    character,
    setCharacter, 
    powerups, 
    setPowerups, 
    soundEnabled,
    totalSaved,
    setTotalSaved
  } = useGameState();

  const [qtyMultiplier, setQtyMultiplier] = useState(1);
  const [qtyRenewal, setQtyRenewal] = useState(1);
  const [loadingItem, setLoadingItem] = useState(null); // 'multiplier', 'renewal', 'bundle', 'valora', 'mento'
  const [txStatus, setTxStatus] = useState('');

  useEffect(() => {
    const recoverPendingTransactions = async () => {
      if (typeof window.ethereum === 'undefined') return;

      const pendingTxStr = localStorage.getItem('celo_flash_pending_tx');
      const pendingSavingsStr = localStorage.getItem('celo_flash_pending_savings');

      if (!pendingTxStr && !pendingSavingsStr) return;

      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        
        // 1. Recover pending store purchase
        if (pendingTxStr) {
          const pending = JSON.parse(pendingTxStr);
          // If transaction is older than 30 mins, discard
          if (Date.now() - pending.timestamp > 30 * 60 * 1000) {
            localStorage.removeItem('celo_flash_pending_tx');
          } else {
            setTxStatus('Recovering pending purchase...');
            const receipt = await provider.getTransactionReceipt(pending.txHash);
            if (receipt && receipt.status === 1) {
              if (pending.itemKey === 'multiplier') {
                setPoints(prev => prev + (pending.quantity * 100));
              } else if (pending.itemKey === 'renewal') {
                setPoints(prev => prev + (pending.quantity * 250));
              } else if (pending.itemKey === 'bundle') {
                setPowerups(prev => ({
                  ...prev,
                  magnet: (prev.magnet || 0) + pending.quantity,
                  shield: (prev.shield || 0) + pending.quantity,
                  clock: (prev.clock || 0) + pending.quantity
                }));
              } else if (pending.itemKey === 'valora') {
                setCharacter('valora');
              } else if (pending.itemKey === 'mento') {
                setCharacter('mento');
              }
              localStorage.removeItem('celo_flash_pending_tx');
              alert('Successfully recovered pending purchase on-chain!');
            } else if (receipt && receipt.status === 0) {
              localStorage.removeItem('celo_flash_pending_tx');
            }
          }
        }

        // 2. Recover pending savings deposit
        if (pendingSavingsStr) {
          const pendingSavings = JSON.parse(pendingSavingsStr);
          if (Date.now() - pendingSavings.timestamp > 30 * 60 * 1000) {
            localStorage.removeItem('celo_flash_pending_savings');
          } else {
            setTxStatus('Recovering pending savings...');
            const receipt = await provider.getTransactionReceipt(pendingSavings.txHash);
            if (receipt && receipt.status === 1) {
              setTotalSaved(prev => Number((prev + pendingSavings.roundUp).toFixed(2)));
              localStorage.removeItem('celo_flash_pending_savings');
              alert('Successfully recovered pending savings deposit on-chain!');
            } else if (receipt && receipt.status === 0) {
              localStorage.removeItem('celo_flash_pending_savings');
            }
          }
        }
      } catch (err) {
        console.error("Error recovering pending transactions:", err);
      } finally {
        setTxStatus('');
      }
    };

    recoverPendingTransactions();
  }, [setPoints, setPowerups, setCharacter, setTotalSaved]);

  // Persistent toggle state for the Round-Up Coach
  const [roundUpEnabled, setRoundUpEnabled] = useState(() => {
    return localStorage.getItem('celo_flash_roundup_coach') === 'true';
  });

  const handleToggleRoundUp = (e) => {
    const val = e.target.checked;
    setRoundUpEnabled(val);
    localStorage.setItem('celo_flash_roundup_coach', val ? 'true' : 'false');
    playSound('click', soundEnabled);
  };

  const handleQtyChange = (type, direction) => {
    playSound('click', soundEnabled);
    if (type === 'multiplier') {
      setQtyMultiplier(prev => direction === 'plus' ? Math.min(99, prev + 1) : Math.max(1, prev - 1));
    } else if (type === 'renewal') {
      setQtyRenewal(prev => direction === 'plus' ? Math.min(99, prev + 1) : Math.max(1, prev - 1));
    }
  };

  // Helper to calculate round-up delta to the next whole dollar
  const getRoundUpDelta = (cost) => {
    if (cost <= 0) return 0;
    const nextWhole = Math.ceil(cost);
    const delta = nextWhole - cost;
    return delta === 0 ? 1.00 : Number(delta.toFixed(2));
  };

  const buyItemOnChain = async (itemType, quantity, expectedCost, itemKey, successCallback) => {
    if (typeof window.ethereum === 'undefined') {
      alert("Please connect a wallet (MetaMask/MiniPay) to complete this purchase.");
      return;
    }

    setLoadingItem(itemKey);
    setTxStatus('Connecting...');

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const userAddr = await signer.getAddress();

      const storeContract = new ethers.Contract(STORE_ADDRESS, CELO_FLASH_STORE_ABI, signer);

      setTxStatus('Fetching stablecoin...');
      const stablecoinAddress = await storeContract.stablecoin();

      const usdmContract = new ethers.Contract(
        stablecoinAddress,
        [
          "function allowance(address owner, address spender) view returns (uint256)",
          "function approve(address spender, uint256 amount) returns (bool)",
          "function balanceOf(address account) view returns (uint256)"
        ],
        signer
      );

      setTxStatus('Checking balance...');
      const balance = await usdmContract.balanceOf(userAddr);
      const [price, active, maxPerTx] = await storeContract.getItem(itemType);
      const itemCost = price * BigInt(quantity);

      // Calculate round-up amount in BigInt
      const roundUp = roundUpEnabled ? getRoundUpDelta(expectedCost) : 0;
      const roundUpWei = roundUp > 0 ? ethers.parseEther(roundUp.toFixed(2)) : 0n;
      const totalCostWei = itemCost + roundUpWei;

      if (balance < totalCostWei) {
        alert(`Insufficient USDm balance! Required: ${ethers.formatEther(totalCostWei)} USDm (Item: ${ethers.formatEther(itemCost)} + Round-up: ${ethers.formatEther(roundUpWei)}), available: ${ethers.formatEther(balance)} USDm.`);
        setLoadingItem(null);
        return;
      }

      // 1. Check & Approve Store allowance
      setTxStatus('Checking store allowance...');
      const storeAllowance = await usdmContract.allowance(userAddr, STORE_ADDRESS);
      if (storeAllowance < itemCost) {
        setTxStatus('Approving Store...');
        const approveTx = await usdmContract.approve(STORE_ADDRESS, itemCost);
        await approveTx.wait();
      }

      // 2. Check & Approve Savings allowance (if round-up is active)
      if (roundUpWei > 0n) {
        setTxStatus('Checking savings allowance...');
        const savingsAllowance = await usdmContract.allowance(userAddr, SAVINGS_ADDRESS);
        if (savingsAllowance < roundUpWei) {
          setTxStatus('Approving Savings...');
          const approveTx = await usdmContract.approve(SAVINGS_ADDRESS, roundUpWei);
          await approveTx.wait();
        }
      }

      // 3. Execute Store Purchase
      setTxStatus('Confirming purchase...');
      const rawCalldata = storeContract.interface.encodeFunctionData("purchaseItem", [itemType, quantity]);
      const calldataWithAttribution = appendAttribution(rawCalldata, "morelucks");

      const storeTx = await signer.sendTransaction({
        to: STORE_ADDRESS,
        data: calldataWithAttribution
      });

      // Save pending transaction to localStorage
      const pendingTxData = {
        txHash: storeTx.hash,
        itemType,
        quantity,
        expectedCost,
        itemKey,
        userAddr,
        timestamp: Date.now()
      };
      localStorage.setItem('celo_flash_pending_tx', JSON.stringify(pendingTxData));

      setTxStatus('Mining purchase...');
      await storeTx.wait();

      // Successfully confirmed, clear store purchase cache
      localStorage.removeItem('celo_flash_pending_tx');

      // 4. Execute Savings Deposit (only if round-up is active and purchase succeeded)
      if (roundUpWei > 0n) {
        setTxStatus('Depositing round-up...');
        const savingsInterface = new ethers.Interface([
          "function deposit(address _user, uint256 _amount) external"
        ]);
        const rawSavingsCalldata = savingsInterface.encodeFunctionData("deposit", [userAddr, roundUpWei]);
        const savingsCalldataWithAttribution = appendAttribution(rawSavingsCalldata, "morelucks");

        const savingsTx = await signer.sendTransaction({
          to: SAVINGS_ADDRESS,
          data: savingsCalldataWithAttribution
        });

        // Save pending savings transaction to localStorage
        const pendingSavingsData = {
          txHash: savingsTx.hash,
          userAddr,
          roundUp,
          timestamp: Date.now()
        };
        localStorage.setItem('celo_flash_pending_savings', JSON.stringify(pendingSavingsData));

        setTxStatus('Mining deposit...');
        await savingsTx.wait();

        // Successfully confirmed, clear savings cache
        localStorage.removeItem('celo_flash_pending_savings');
      }

      playSound('collect-green', soundEnabled);
      successCallback();
    } catch (error) {
      // Clear pending caches on local failure catch
      localStorage.removeItem('celo_flash_pending_tx');
      localStorage.removeItem('celo_flash_pending_savings');

      console.error("Purchase / Deposit failed:", error);
      let userMessage = error.reason || error.message || String(error);
      if (
        userMessage.includes("rejected") || 
        userMessage.includes("denied") || 
        error.code === "ACTION_REJECTED" || 
        error.code === 4001
      ) {
        userMessage = "Transaction rejected by user. Please try again when ready!";
      }
      alert(`Transaction failed: ${userMessage}`);
    } finally {
      setLoadingItem(null);
      setTxStatus('');
    }
  };

  const handleBuyMultiplier = async () => {
    playSound('click', soundEnabled);
    const cost = qtyMultiplier * 0.04;
    const roundUp = roundUpEnabled ? getRoundUpDelta(cost) : 0;
    const totalCost = cost + roundUp;

    if (cash < totalCost) {
      alert(`Insufficient USDm balance! Required: $${totalCost.toFixed(2)} (Cost: $${cost.toFixed(2)} + Round-up: $${roundUp.toFixed(2)})`);
      return;
    }

    await buyItemOnChain(6, qtyMultiplier, cost, 'multiplier', () => {
      setCash(prev => Number((prev - totalCost).toFixed(2)));
      setPoints(prev => prev + qtyMultiplier * 5);
      if (roundUp > 0) {
        setTotalSaved(prev => Number((prev + roundUp).toFixed(2)));
      }
      alert(`Purchased ${qtyMultiplier} Score Multipliers! Saved $${roundUp.toFixed(2)} to Aave V3 yield pool.`);
    });
  };

  const handleBuyRenewal = async () => {
    playSound('click', soundEnabled);
    const cost = qtyRenewal * 0.10;
    const roundUp = roundUpEnabled ? getRoundUpDelta(cost) : 0;
    const totalCost = cost + roundUp;

    if (cash < totalCost) {
      alert(`Insufficient USDm balance! Required: $${totalCost.toFixed(2)} (Cost: $${cost.toFixed(2)} + Round-up: $${roundUp.toFixed(2)})`);
      return;
    }

    await buyItemOnChain(7, qtyRenewal, cost, 'renewal', () => {
      setCash(prev => Number((prev - totalCost).toFixed(2)));
      setPoints(prev => prev + qtyRenewal * 15);
      if (roundUp > 0) {
        setTotalSaved(prev => Number((prev + roundUp).toFixed(2)));
      }
      alert(`Daily Renewal activated! Playtime renewed. Saved $${roundUp.toFixed(2)} to Aave V3 yield pool.`);
    });
  };

  const handleBuyAllPowerups = async () => {
    playSound('click', soundEnabled);
    const cost = 0.20;
    const roundUp = roundUpEnabled ? getRoundUpDelta(cost) : 0;
    const totalCost = cost + roundUp;

    if (cash < totalCost) {
      alert(`Insufficient USDm balance! Required: $${totalCost.toFixed(2)} (Cost: $${cost.toFixed(2)} + Round-up: $${roundUp.toFixed(2)})`);
      return;
    }

    await buyItemOnChain(3, 1, cost, 'bundle', () => {
      setCash(prev => Number((prev - totalCost).toFixed(2)));
      setPowerups(prev => ({
        ...prev,
        magnet: (prev.magnet || 0) + 1,
        shield: (prev.shield || 0) + 1,
        clock: (prev.clock || 0) + 1
      }));
      if (roundUp > 0) {
        setTotalSaved(prev => Number((prev + roundUp).toFixed(2)));
      }
      alert(`Success! Purchased Magnet, Shield, and Clock powerups. Saved $${roundUp.toFixed(2)} to Aave V3 yield pool.`);
    });
  };

  const handleBuySpawner = async (spawnerType) => {
    playSound('click', soundEnabled);
    const cost = 0.05;
    const roundUp = roundUpEnabled ? getRoundUpDelta(cost) : 0;
    const totalCost = cost + roundUp;
    const itemType = spawnerType === 'valora' ? 4 : 5;

    if (cash < totalCost) {
      alert(`Insufficient USDm balance! Required: $${totalCost.toFixed(2)} (Cost: $${cost.toFixed(2)} + Round-up: $${roundUp.toFixed(2)})`);
      return;
    }

    await buyItemOnChain(itemType, 1, cost, spawnerType, () => {
      setCash(prev => Number((prev - totalCost).toFixed(2)));
      setCharacter(spawnerType);
      if (roundUp > 0) {
        setTotalSaved(prev => Number((prev + roundUp).toFixed(2)));
      }
      playSound('victory', soundEnabled);
      alert(`Theme successfully unlocked! Avatar changed to ${spawnerType}. Saved $${roundUp.toFixed(2)} to Aave V3 yield pool.`);
    });
  };

  const costMultiplier = qtyMultiplier * 0.04;
  const costRenewal = qtyRenewal * 0.10;
  return (
    <div className="screen active" id="screen-store">
      
      {/* AI Round-Up Coach Switch */}
      <div className={`round-up-coach-toggle ${roundUpEnabled ? 'active' : ''}`}>
        <div className="toggle-info">
          <span style={{ fontSize: '1.4rem' }}>🤖</span>
          <div>
            <h4>Enable AI Round-Up Coach</h4>
            <p className="toggle-sub">Automatically save the spare change to yield pool</p>
          </div>
        </div>
        <label className="switch">
          <input 
            type="checkbox" 
            checked={roundUpEnabled} 
            onChange={handleToggleRoundUp} 
          />
          <span className="slider"></span>
        </label>
      </div>

      <div className="store-section">
        <div className="store-section-header">
          <h2 className="store-title">🚨 EMERGENCY TOP-UPS</h2>
        </div>
        
        <div className="topups-grid">
          {/* Topup 1 */}
          <div className="topup-card">
            <div className="topup-icon">⚡</div>
            <h3 className="topup-name">Score Multiplier</h3>
            <p className="topup-desc">+1 charge • 2x-5x your run</p>
            <div className="quantity-control">
              <button className="qty-btn qty-minus" onClick={() => handleQtyChange('multiplier', 'minus')} disabled={loadingItem !== null}>-</button>
              <span className="qty-val" id="qty-multiplier">{qtyMultiplier}</span>
              <button className="qty-btn qty-plus" onClick={() => handleQtyChange('multiplier', 'plus')} disabled={loadingItem !== null}>+</button>
            </div>
            <button className="buy-item-btn" onClick={handleBuyMultiplier} disabled={loadingItem !== null}>
              {loadingItem === 'multiplier' ? txStatus : `Buy • $${costMultiplier.toFixed(2)}`}
            </button>
            {roundUpEnabled && (
              <div className="round-up-delta-indicator">
                Coach: +${getRoundUpDelta(costMultiplier).toFixed(2)} round-up to ${(costMultiplier + getRoundUpDelta(costMultiplier)).toFixed(2)}
              </div>
            )}
          </div>

          {/* Topup 2 */}
          <div className="topup-card">
            <div className="topup-icon">🎮</div>
            <h3 className="topup-name">Daily Renewal</h3>
            <p className="topup-desc">+10 min playtime each</p>
            <div className="quantity-control">
              <button className="qty-btn qty-minus" onClick={() => handleQtyChange('renewal', 'minus')} disabled={loadingItem !== null}>-</button>
              <span className="qty-val" id="qty-renewal">{qtyRenewal}</span>
              <button className="qty-btn qty-plus" onClick={() => handleQtyChange('renewal', 'plus')} disabled={loadingItem !== null}>+</button>
            </div>
            <button className="buy-item-btn" onClick={handleBuyRenewal} disabled={loadingItem !== null}>
              {loadingItem === 'renewal' ? txStatus : `Buy • $${costRenewal.toFixed(2)}`}
            </button>
            {roundUpEnabled && (
              <div className="round-up-delta-indicator">
                Coach: +${getRoundUpDelta(costRenewal).toFixed(2)} round-up to ${(costRenewal + getRoundUpDelta(costRenewal)).toFixed(2)}
              </div>
            )}
          </div>
        </div>

        <div className="store-action-banner">
          <div className="buy-all-desc">
            <h4>Buy All Power-ups</h4>
            <p>Activate Magnet, Shield, and Clock at once!</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <button className="buy-all-btn" onClick={handleBuyAllPowerups} disabled={loadingItem !== null}>
              {loadingItem === 'bundle' ? txStatus : '$0.20 BUY ALL'}
            </button>
            {roundUpEnabled && (
              <div className="round-up-delta-indicator" style={{ marginTop: '4px', textAlign: 'right' }}>
                Coach: +${getRoundUpDelta(0.20).toFixed(2)} round-up
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Feature Items Section */}
      <div className="store-section mt-4">
        <h3 className="store-section-title">Special Spawners</h3>
        <div className="spawners-list">
          <div className="spawner-card">
            <div className="spawner-avatar">💚</div>
            <div className="spawner-info">
              <h4>Valora Coin</h4>
              <p>Spawns Valora hearts. Lasts 24h once bought.</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <button 
                className={`buy-spawner-btn ${character === 'valora' ? 'active-spawner' : ''}`}
                onClick={() => handleBuySpawner('valora')}
                disabled={loadingItem !== null}
              >
                {character === 'valora' ? 'Active' : (loadingItem === 'valora' ? txStatus : 'Buy • $0.05')}
              </button>
              {roundUpEnabled && character !== 'valora' && (
                <div className="round-up-delta-indicator">
                  Coach: +${getRoundUpDelta(0.05).toFixed(2)} round-up
                </div>
              )}
            </div>
          </div>

          <div className="spawner-card">
            <div className="spawner-avatar">🍀</div>
            <div className="spawner-info">
              <h4>Mento Token</h4>
              <p>Spawns Mento leaves. Lasts 24h once bought.</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <button 
                className={`buy-spawner-btn ${character === 'mento' ? 'active-spawner' : ''}`}
                onClick={() => handleBuySpawner('mento')}
                disabled={loadingItem !== null}
              >
                {character === 'mento' ? 'Active' : (loadingItem === 'mento' ? txStatus : 'Buy • $0.05')}
              </button>
              {roundUpEnabled && character !== 'mento' && (
                <div className="round-up-delta-indicator">
                  Coach: +${getRoundUpDelta(0.05).toFixed(2)} round-up
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// docs: establish multi-contract transaction bundling goals #47

// refactor: register CeloFlashSavings contract address constant in frontend

// refactor: import ABI fragment for depositing to CeloFlashSavings pool

// style: improve alignment of round-up toggle check states

// docs: document sequential store purchase and savings deposit requirements

// refactor: initialize signer and provider interfaces in store screen

// style: standardize status messages for on-chain store checkout

// refactor: calculate item cost in BigInt unit decimals

// refactor: compute round-up delta in BigInt units dynamically

// style: align loading status messages for user feedback

// refactor: fetch stablecoin address dynamically from store contract

// refactor: initialize ERC20 contract interface for allowance checks

// refactor: verify user stablecoin balance before initiating checkout

// refactor: validate item price constraints on-chain

// style: enhance balance validation error feedback formatting

// refactor: verify store allowance before transaction processing

// refactor: approve store contract to transfer item cost in USDm

// refactor: verify savings allowance for round-up amount

// refactor: approve savings contract to transfer round-up in USDm

// style: refine transaction status indicator transition timing

// feat: encode function data for store purchase transaction

// feat: append ERC-8021 attribution suffix to store purchase calldata

// feat: send store purchase transaction using signer interface

// feat: await transaction mining confirmation for store purchase

// feat: encode function data for savings deposit transaction

// feat: append ERC-8021 attribution suffix to savings deposit calldata

// feat: send savings deposit transaction using signer interface

// feat: await transaction mining confirmation for savings deposit

// style: trigger collect sound effect on sequential checkout success

// refactor: update local cash balance state following successful purchase

// refactor: update local score points state following multiplier purchase

// refactor: update local powerups counts state following bundle purchase

// refactor: update local character state following spawner purchase

// style: trigger victory sound effect on spawner purchase success

// style: improve mobile UX alert dialogs for transaction errors

// refactor: wrap sequential transaction blocks in try-catch-finally

// refactor: ensure loading indicators reset on transaction failure

// style: clean up terminal logging for contract interaction errors

// docs: document Mountain Protocol USDm Celo mainnet deployment details

// docs: document Aave V3 yield generation parameters on Celo network

// refactor: ensure sequential checkout works with MiniPay wallet provider

// refactor: prevent double submissions by disabling buttons during loading

// style: optimize round-up delta UI element sizing and margins

// style: refine toggle switch slide transition animations

// test: verify sequential transactions pass local unit tests

// docs: validate EIP compliance for transaction metadata attributes

// Finalized multi-contract transaction bundling implementation.
