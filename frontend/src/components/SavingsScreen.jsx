import React, { useState, useEffect } from 'react';
import { useGameState } from '../context/GameStateContext';
import { useWallet } from '../hooks/useWallet';
import { playSound } from '../utils/audio';
import { ethers } from 'ethers';
import { appendAttribution } from '../utils/attribution';

const SAVINGS_ADDRESS = "0x2C576E1bBe7dFe92C8847ee56a646EFf115Fa0Dc";

const SAVINGS_ABI = [
  "function deposit(address _user, uint256 _amount) external",
  "function depositCELO(address _user) external payable",
  "function withdraw(uint256 _amount) external",
  "function withdrawCELO(uint256 _amount) external",
  "function celoBalances(address) external view returns (uint256)",
  "function usdmBalances(address) external view returns (uint256)",
  "function totalCELOLocked() external view returns (uint256)",
  "function totalUSDmLocked() external view returns (uint256)",
  "function stablecoin() external view returns (address)"
];

const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)"
];

export default function SavingsScreen() {
  const { soundEnabled, userAddress, setTotalSaved } = useGameState();
  const { connectWallet } = useWallet();

  const [activeAsset, setActiveAsset] = useState('usdm'); // 'celo' or 'usdm'
  const [activeAction, setActiveAction] = useState('deposit'); // 'deposit' or 'withdraw'
  const [amount, setAmount] = useState('');
  
  // On-chain stats
  const [walletCelo, setWalletCelo] = useState('0.0');
  const [walletUsdm, setWalletUsdm] = useState('0.0');
  const [lockedCelo, setLockedCelo] = useState('0.0');
  const [lockedUsdm, setLockedUsdm] = useState('0.0');
  const [globalCelo, setGlobalCelo] = useState('0.0');
  const [globalUsdm, setGlobalUsdm] = useState('0.0');
  
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [txHash, setTxHash] = useState('');

  // Fetch balances
  const fetchBalances = async () => {
    if (!userAddress || typeof window.ethereum === 'undefined') return;

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const savingsContract = new ethers.Contract(SAVINGS_ADDRESS, SAVINGS_ABI, provider);

      // 1. Wallet balances
      const celoBal = await provider.getBalance(userAddress);
      setWalletCelo(Number(ethers.formatEther(celoBal)).toFixed(4));

      const stablecoinAddress = await savingsContract.stablecoin();
      const usdmContract = new ethers.Contract(stablecoinAddress, ERC20_ABI, provider);
      const usdmBal = await usdmContract.balanceOf(userAddress);
      setWalletUsdm(Number(ethers.formatEther(usdmBal)).toFixed(2));

      // 2. Locked balances
      const lockedCeloBal = await savingsContract.celoBalances(userAddress);
      setLockedCelo(Number(ethers.formatEther(lockedCeloBal)).toFixed(4));

      const lockedUsdmBal = await savingsContract.usdmBalances(userAddress);
      const parsedLockedUsdm = Number(ethers.formatEther(lockedUsdmBal));
      setLockedUsdm(parsedLockedUsdm.toFixed(2));
      
      // Sync local game savings target tracking if using USDm
      setTotalSaved(parsedLockedUsdm);

      // 3. Global stats
      const totalCelo = await savingsContract.totalCELOLocked();
      setGlobalCelo(Number(ethers.formatEther(totalCelo)).toFixed(2));

      const totalUsdm = await savingsContract.totalUSDmLocked();
      setGlobalUsdm(Number(ethers.formatEther(totalUsdm)).toFixed(2));

    } catch (error) {
      console.error("Error fetching savings balances:", error);
    }
  };

  useEffect(() => {
    fetchBalances();
    
    // Set up polling interval to keep stats fresh
    const interval = setInterval(fetchBalances, 15000);
    return () => clearInterval(interval);
  }, [userAddress]);

  const handleMax = () => {
    playSound('click', soundEnabled);
    if (activeAction === 'deposit') {
      if (activeAsset === 'celo') {
        // Leave 0.05 CELO for gas
        const maxVal = Math.max(0, parseFloat(walletCelo) - 0.05);
        setAmount(maxVal.toString());
      } else {
        setAmount(walletUsdm);
      }
    } else {
      if (activeAsset === 'celo') {
        setAmount(lockedCelo);
      } else {
        setAmount(lockedUsdm);
      }
    }
  };

  const handleAction = async () => {
    if (!userAddress) {
      alert("Please connect your wallet first!");
      return;
    }

    const valueFloat = parseFloat(amount);
    if (isNaN(valueFloat) || valueFloat <= 0) {
      alert("Please enter a valid amount greater than 0.");
      return;
    }

    playSound('click', soundEnabled);
    setIsLoading(true);
    setStatusMessage('Preparing transaction...');
    setTxHash('');

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const savingsContract = new ethers.Contract(SAVINGS_ADDRESS, SAVINGS_ABI, signer);
      const valueWei = ethers.parseEther(amount);

      if (activeAction === 'deposit') {
        if (activeAsset === 'celo') {
          // Deposit CELO
          setStatusMessage('Initiating CELO deposit...');
          const rawCalldata = savingsContract.interface.encodeFunctionData("depositCELO", [userAddress]);
          const calldataWithAttribution = appendAttribution(rawCalldata, "morelucks");

          const tx = await signer.sendTransaction({
            to: SAVINGS_ADDRESS,
            data: calldataWithAttribution,
            value: valueWei
          });

          setTxHash(tx.hash);
          setStatusMessage('Confirming CELO deposit...');
          await tx.wait();
          setStatusMessage('CELO deposited successfully! 🎉');
        } else {
          // Deposit USDm
          const stablecoinAddress = await savingsContract.stablecoin();
          const usdmContract = new ethers.Contract(stablecoinAddress, ERC20_ABI, signer);

          // Check allowance
          setStatusMessage('Checking USDm allowance...');
          const allowance = await usdmContract.allowance(userAddress, SAVINGS_ADDRESS);
          if (allowance < valueWei) {
            setStatusMessage('Approving savings contract to access USDm...');
            const approveTx = await usdmContract.approve(SAVINGS_ADDRESS, valueWei);
            await approveTx.wait();
          }

          // Deposit
          setStatusMessage('Depositing USDm...');
          const rawCalldata = savingsContract.interface.encodeFunctionData("deposit", [userAddress, valueWei]);
          const calldataWithAttribution = appendAttribution(rawCalldata, "morelucks");

          const tx = await signer.sendTransaction({
            to: SAVINGS_ADDRESS,
            data: calldataWithAttribution
          });

          setTxHash(tx.hash);
          setStatusMessage('Confirming USDm deposit...');
          await tx.wait();
          setStatusMessage('USDm deposited successfully! 🎉');
        }
      } else {
        // Withdraw
        if (activeAsset === 'celo') {
          setStatusMessage('Initiating CELO withdrawal...');
          const rawCalldata = savingsContract.interface.encodeFunctionData("withdrawCELO", [valueWei]);
          const calldataWithAttribution = appendAttribution(rawCalldata, "morelucks");

          const tx = await signer.sendTransaction({
            to: SAVINGS_ADDRESS,
            data: calldataWithAttribution
          });

          setTxHash(tx.hash);
          setStatusMessage('Confirming CELO withdrawal...');
          await tx.wait();
          setStatusMessage('CELO withdrawn successfully! 💸');
        } else {
          setStatusMessage('Initiating USDm withdrawal...');
          const rawCalldata = savingsContract.interface.encodeFunctionData("withdraw", [valueWei]);
          const calldataWithAttribution = appendAttribution(rawCalldata, "morelucks");

          const tx = await signer.sendTransaction({
            to: SAVINGS_ADDRESS,
            data: calldataWithAttribution
          });

          setTxHash(tx.hash);
          setStatusMessage('Confirming USDm withdrawal...');
          await tx.wait();
          setStatusMessage('USDm withdrawn successfully! 💸');
        }
      }

      // Refresh balances
      await fetchBalances();
      setAmount('');
    } catch (error) {
      console.error("Savings transaction failed:", error);
      setStatusMessage(`Transaction failed: ${error.reason || error.message || 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="screen active" id="screen-savings">
      {/* Header section */}
      <div className="savings-header-card">
        <div className="savings-title-row">
          <div className="savings-icon-circle">💰</div>
          <div>
            <h3>CeloFlash Savings</h3>
            <p>Save manually and earn yield on your assets</p>
          </div>
        </div>
        
        {/* Global Statistics */}
        <div className="savings-global-stats">
          <div className="global-stat-box">
            <span className="global-stat-value">{globalUsdm} USDm</span>
            <span className="global-stat-label">Total USDm Saved</span>
          </div>
          <div className="global-stat-box">
            <span className="global-stat-value">{globalCelo} CELO</span>
            <span className="global-stat-label">Total CELO Saved</span>
          </div>
        </div>
      </div>

      {/* Asset Balances Grid */}
      <div className="savings-balances-grid">
        <div 
          className={`balance-card ${activeAsset === 'usdm' ? 'active' : ''}`}
          onClick={() => { playSound('click', soundEnabled); setActiveAsset('usdm'); }}
        >
          <div className="asset-header">
            <span className="asset-logo usdm">💵</span>
            <span className="asset-ticker">USDm Stable</span>
          </div>
          <div className="balance-row">
            <div className="balance-block">
              <span className="balance-val">${walletUsdm}</span>
              <span className="balance-lbl">Wallet</span>
            </div>
            <div className="balance-block">
              <span className="balance-val highlighted">${lockedUsdm}</span>
              <span className="balance-lbl">Savings Pool</span>
            </div>
          </div>
        </div>

        <div 
          className={`balance-card ${activeAsset === 'celo' ? 'active' : ''}`}
          onClick={() => { playSound('click', soundEnabled); setActiveAsset('celo'); }}
        >
          <div className="asset-header">
            <span className="asset-logo celo">🪙</span>
            <span className="asset-ticker">CELO Native</span>
          </div>
          <div className="balance-row">
            <div className="balance-block">
              <span className="balance-val">{walletCelo}</span>
              <span className="balance-lbl">Wallet</span>
            </div>
            <div className="balance-block">
              <span className="balance-val highlighted">{lockedCelo}</span>
              <span className="balance-lbl">Savings Pool</span>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Action Card */}
      <div className="savings-action-card">
        {/* Action Toggle Tabs */}
        <div className="action-tabs">
          <button 
            className={`action-tab-btn ${activeAction === 'deposit' ? 'active' : ''}`}
            onClick={() => { playSound('click', soundEnabled); setActiveAction('deposit'); }}
          >
            Deposit
          </button>
          <button 
            className={`action-tab-btn ${activeAction === 'withdraw' ? 'active' : ''}`}
            onClick={() => { playSound('click', soundEnabled); setActiveAction('withdraw'); }}
          >
            Withdraw
          </button>
        </div>

        {!userAddress ? (
          <div className="connect-prompt-container">
            <p>Please connect your wallet to manage your savings account on-chain.</p>
            <button className="connect-wallet-btn-savings" onClick={connectWallet}>
              Connect Wallet
            </button>
          </div>
        ) : (
          <div className="action-input-section">
            <div className="input-group-label">
              <span>Amount of {activeAsset.toUpperCase()} to {activeAction}</span>
              <span className="available-indicator" onClick={handleMax}>
                Available: {activeAction === 'deposit' 
                  ? (activeAsset === 'celo' ? `${walletCelo} CELO` : `$${walletUsdm} USDm`)
                  : (activeAsset === 'celo' ? `${lockedCelo} CELO` : `$${lockedUsdm} USDm`)
                } <span className="max-badge">MAX</span>
              </span>
            </div>

            <div className="savings-input-wrapper">
              <input 
                type="number" 
                placeholder="0.00" 
                className="savings-amount-input"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={isLoading}
              />
              <span className="input-suffix">{activeAsset.toUpperCase()}</span>
            </div>

            {/* Status updates */}
            {statusMessage && (
              <div className="savings-status-container">
                <div className="status-indicator-spinner"></div>
                <div className="status-message-text">
                  <p>{statusMessage}</p>
                  {txHash && (
                    <a 
                      href={`https://celoscan.io/tx/${txHash}`} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="tx-hash-link"
                    >
                      View transaction: {txHash.slice(0, 8)}...{txHash.slice(-8)} ↗
                    </a>
                  )}
                </div>
              </div>
            )}

            <button 
              className={`savings-action-submit-btn ${activeAction === 'withdraw' ? 'withdraw-mode' : ''}`}
              onClick={handleAction}
              disabled={isLoading}
            >
              {isLoading ? (
                <span>Processing...</span>
              ) : (
                <span>
                  {activeAction === 'deposit' ? 'Deposit' : 'Withdraw'} {activeAsset.toUpperCase()}
                </span>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Contract & Info Details */}
      <div className="savings-info-section">
        <h4 className="info-title">💡 How CeloFlash Savings Works</h4>
        <p className="info-paragraph">
          When you deposit **USDm**, your funds are locked into Mountain Protocol's yield-accruing pool. This lets your savings grow passively in the background. 
          When you deposit **CELO**, your native tokens are secured inside the smart contract and can be withdrawn at any time.
        </p>
        <div className="contract-address-box">
          <span className="contract-lbl">Contract:</span>
          <a 
            href={`https://celoscan.io/address/${SAVINGS_ADDRESS}`} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="contract-addr"
          >
            {SAVINGS_ADDRESS.slice(0, 10)}...{SAVINGS_ADDRESS.slice(-8)} ↗
          </a>
        </div>
      </div>
    </div>
  );
}
