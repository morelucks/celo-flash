import React, { useState } from 'react';
import { playSound } from '../utils/audio';
import { useWallet } from '../hooks/useWallet';
import { useGameState } from '../context/GameStateContext';
import { isMiniPay } from '../utils/minipay';

/**
 * Connect Modal — dual-mode:
 * • Inside MiniPay → directly connects the injected wallet
 * • Outside MiniPay → opens the Privy login flow (Google, email, wallets)
 */
export default function ConnectModal({ isOpen, onClose, soundEnabled }) {
  const { connectWallet, isPrivyAuthenticated } = useWallet();
  const { userAddress } = useGameState();
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');

  if (!isOpen) return null;

  const handleClose = () => {
    playSound('click', soundEnabled);
    onClose();
  };

  // Inside MiniPay — connect directly via injected provider
  const handleMiniPayConnect = async () => {
    playSound('click', soundEnabled);
    setLoading(true);
    setLoadingText('Connecting MiniPay wallet...');
    try {
      const address = await connectWallet();
      if (address) {
        onClose();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // Outside MiniPay — open Privy login (handles Google, email, WalletConnect)
  const handlePrivyLogin = async () => {
    playSound('click', soundEnabled);
    setLoading(true);
    setLoadingText('Opening Privy login...');
    try {
      await connectWallet(); // This calls login() which opens Privy modal
      // Privy handles the UI — we close our modal and let Privy take over
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const isInMiniPay = isMiniPay();

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-card privy-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header privy-modal-header">
          <div className="privy-logo-group">
            <span className="privy-logo-icon">👤</span>
            <span className="privy-logo-text">{isInMiniPay ? 'MiniPay' : 'Privy'}</span>
          </div>
          <button className="close-modal-btn" onClick={handleClose}>×</button>
        </div>

        <div className="modal-body privy-modal-body">
          {loading ? (
            <div className="connect-loading-container">
              <div className="spinner"></div>
              <p className="loading-text">{loadingText}</p>
            </div>
          ) : isInMiniPay ? (
            /* ── MiniPay Mode ── */
            <>
              <h2 className="privy-title">Connect MiniPay</h2>
              <p className="privy-subtitle">Your MiniPay wallet will be connected automatically</p>

              <div className="privy-primary-options">
                <button className="privy-google-btn" onClick={handleMiniPayConnect}>
                  <span style={{ fontSize: '1.2rem' }}>⚡</span>
                  <span>Connect MiniPay Wallet</span>
                </button>
              </div>

              <div className="privy-footer">
                <span>Powered by Opera MiniPay</span>
              </div>
            </>
          ) : (
            /* ── Privy Mode (social login + wallets) ── */
            <>
              <h2 className="privy-title">Log in or sign up</h2>
              <p className="privy-subtitle">to connect to Celo Flash</p>

              <div className="privy-primary-options">
                <button className="privy-google-btn" onClick={handlePrivyLogin}>
                  <svg className="google-icon-svg" viewBox="0 0 24 24" width="18" height="18">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                  </svg>
                  <span>Continue with Google</span>
                </button>
              </div>

              <div className="privy-divider">
                <span>or connect a wallet</span>
              </div>

              <div className="privy-wallet-options">
                <button className="privy-wallet-btn" onClick={handlePrivyLogin}>
                  <span className="wallet-icon">🦊</span>
                  <span className="wallet-name">MetaMask</span>
                </button>
                <button className="privy-wallet-btn" onClick={handlePrivyLogin}>
                  <span className="wallet-icon">🔗</span>
                  <span className="wallet-name">WalletConnect</span>
                </button>
              </div>

              <div className="privy-footer">
                <span>Secured by Privy</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
