import React from 'react';
import { useGameState } from '../context/GameStateContext';
import { playSound } from '../utils/audio';

export default function Header({ onOpenSwap }) {
  const { points, cash, soundEnabled, setSoundEnabled } = useGameState();

  const handleSoundToggle = () => {
    const nextSound = !soundEnabled;
    setSoundEnabled(nextSound);
    // Play sound immediately after enabling to verify
    playSound('click', nextSound);
  };

  return (
    <>
      {/* Mini-App Header */}
      <div className="app-header">
        <div className="app-info">
          <div className="app-logo">
            <svg className="celo-logo-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="celo-gold-grad" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#E5BB38" />
                  <stop offset="100%" stopColor="#FCFF52" />
                </linearGradient>
                <linearGradient id="celo-green-grad" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#105B37" />
                  <stop offset="100%" stopColor="#35D07F" />
                </linearGradient>
              </defs>
              <circle cx="38" cy="50" r="22" fill="none" stroke="url(#celo-gold-grad)" strokeWidth="8" />
              <circle cx="62" cy="50" r="22" fill="none" stroke="url(#celo-green-grad)" strokeWidth="8" />
            </svg>
          </div>
          <div className="app-title-group">
            <h1 className="app-title">Celo Flash</h1>
            <span className="app-subtitle">by luckify</span>
          </div>
        </div>
        <div className="app-actions">
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
          <button className="action-btn" aria-label="Options" onClick={() => playSound('click', soundEnabled)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="5" r="1"></circle>
              <circle cx="12" cy="12" r="1"></circle>
              <circle cx="12" cy="19" r="1"></circle>
            </svg>
          </button>
          <button className="action-btn" aria-label="Minimize" onClick={() => playSound('click', soundEnabled)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          <button className="action-btn close-btn" aria-label="Close" onClick={() => playSound('click', soundEnabled)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>

      {/* Token / Balance Info Bar */}
      <div className="balance-bar">
        <button className="balance-action buy-celo-btn" onClick={onOpenSwap}>
          <span className="plus-icon">+</span> BUY $CELO
        </button>
        <span className="balance-pill fee-pill">🟢 FREE</span>
        <span className="balance-pill points-pill">✨ <span>{points.toLocaleString()}</span></span>
        <span className="balance-pill wallet-pill">💵 $<span>{cash.toFixed(2)}</span></span>
      </div>
    </>
  );
}
