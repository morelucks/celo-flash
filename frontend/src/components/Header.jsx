import React from 'react';
import { useGameState } from '../context/GameStateContext';
import { playSound } from '../utils/audio';

import { isMiniPay } from '../utils/minipay';

export default function Header({ onOpenSwap }) {
  const { points, cash, soundEnabled, setSoundEnabled } = useGameState();

  const handleSoundToggle = () => {
    const nextSound = !soundEnabled;
    setSoundEnabled(nextSound);
    // Play sound immediately after enabling to verify
    playSound('click', nextSound);
  };

  const isRunningInMiniPay = isMiniPay();

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

      {/* Token / Balance Info Bar */}
      <div className="balance-bar">
        <button className="balance-action buy-celo-btn" onClick={onOpenSwap}>
          <span className="plus-icon">+</span> Swap
        </button>
        <span className="balance-pill fee-pill">🟢 FREE</span>
        <span className="balance-pill points-pill">✨ <span>{points.toLocaleString()}</span></span>
        <span className="balance-pill wallet-pill">💵 $<span>{cash.toFixed(2)}</span></span>
      </div>
    </>
  );
}
