import React, { useState } from 'react';
import { useGameState } from '../context/GameStateContext';
import { useWallet } from '../hooks/useWallet';
import { playSound } from '../utils/audio';
import ConnectModal from './ConnectModal';

import { isMiniPay } from '../utils/minipay';

export default function Header({ onOpenSwap }) {
  const { points, cash, soundEnabled, setSoundEnabled, userAddress } = useGameState();
  const { connectWallet, disconnectWallet } = useWallet();
  const [isConnectOpen, setIsConnectOpen] = useState(false);

  const handleSoundToggle = () => {
    const nextSound = !soundEnabled;
    setSoundEnabled(nextSound);
    // Play sound immediately after enabling to verify
    playSound('click', nextSound);
  };

  const handleConnect = (e) => {
    e.stopPropagation();
    playSound('click', soundEnabled);
    setIsConnectOpen(true);
  };

  const handleDisconnect = (e) => {
    e.stopPropagation();
    playSound('click', soundEnabled);
    disconnectWallet();
  };

  const isRunningInMiniPay = isMiniPay();

  const formatAddress = (address) => {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  return (
    <>
      {/* Mini-App Header */}
      <div className="app-header">
        <div className="app-info">
          <div className="app-logo">
            <img src="/logos/logo_celo_flash.png" alt="Celo Flash" className="celo-logo-svg" />
          </div>
          <div className="app-title-group">
            <h1 className="app-title">Celo Flash</h1>
            {userAddress ? (
              <div className="wallet-connected-group">
                <span className="wallet-status-badge connected">
                  🟢 {formatAddress(userAddress)}
                </span>
                <button 
                  className="disconnect-header-btn" 
                  onClick={handleDisconnect}
                  title="Disconnect Wallet"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button 
                className="wallet-status-badge disconnected connect-header-btn" 
                onClick={handleConnect}
              >
                🔴 Connect Wallet
              </button>
            )}
          </div>
        </div>
        <div className="app-actions">
          {isRunningInMiniPay && (
            <span className="minipay-indicator-badge">⚡ MiniPay Active</span>
          )}
          <button 
            className="action-btn" 
            onClick={handleSoundToggle} 
            aria-label="Toggle Sound"
          >
            {soundEnabled ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                <line x1="23" y1="9" x2="17" y2="15"></line>
                <line x1="17" y1="9" x2="23" y2="15"></line>
              </svg>
            )}
          </button>
        </div>
      </div>

      <ConnectModal 
        isOpen={isConnectOpen} 
        onClose={() => setIsConnectOpen(false)} 
        soundEnabled={soundEnabled} 
      />
    </>
  );
}
