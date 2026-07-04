import React, { useState } from 'react';
import { useGameState } from '../context/GameStateContext';
import { playSound } from '../utils/audio';
import avatarUrl from '../assets/avatar.png';

export default function MeScreen() {
  const { cash, points, gamesPlayed, setCurrentTab, soundEnabled } = useGameState();
  const [statsTab, setStatsTab] = useState('usage');

  const handleFindTournament = () => {
    playSound('click', soundEnabled);
    setCurrentTab('tourneys');
  };

  const handleShare = () => {
    playSound('click', soundEnabled);
    // Simple Web Share API or copy link
    if (navigator.share) {
      navigator.share({
        title: 'Celo Flash',
        text: 'Play Celo Flash with me and speed into the Celo economy!',
        url: window.location.origin
      }).catch(err => console.log(err));
    } else {
      navigator.clipboard.writeText(window.location.origin);
      alert('Share link copied to clipboard!');
    }
  };

  return (
    <div className="screen active" id="screen-me">
      <div className="profile-card">
        <div className="profile-header">
          <div className="profile-avatar-container">
            <img src={avatarUrl} alt="luckify Avatar" className="profile-avatar" id="me-avatar-img" />
          </div>
          <div className="profile-meta">
            <h3 className="profile-handle">@luckify</h3>
            <span className="profile-fid">fid 1104338</span>
          </div>
          <button className="share-btn" onClick={handleShare}>
            <svg className="share-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
              <polyline points="16 6 12 2 8 6"></polyline>
              <line x1="12" y1="2" x2="12" y2="15"></line>
            </svg>
            Share
          </button>
        </div>

        {/* Tier Status Info */}
        <div className="tier-status">
          <div className="tier-header">
            <span className="tier-dot"></span>
            <span className="tier-name">Tier 5</span>
            <span className="tier-sub">0 wins • global rank #109</span>
          </div>
          <div className="tier-progress-bg">
            <div className="tier-progress-bar" style={{ width: '20%' }}></div>
          </div>
          <div className="tier-footer">
            <span>Tier 5</span>
            <span>1 to Tier 4</span>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="stats-grid">
          <div className="stat-box">
            <span className="stat-value" id="stats-usdm">${cash.toFixed(2)}</span>
            <span className="stat-label">USDm WON</span>
          </div>
          <div className="stat-box">
            <span className="stat-value" id="stats-celo">{points.toLocaleString()}</span>
            <span className="stat-label">POINTS</span>
          </div>
          <div className="stat-box">
            <span className="stat-value" id="stats-played">{gamesPlayed}</span>
            <span className="stat-label">PLAYED</span>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="profile-actions">
        <button className="profile-action-row" id="btn-profile-find-tourney" onClick={handleFindTournament}>
          <span>Find a tournament to join</span>
          <span className="arrow-right">→</span>
        </button>
      </div>

      {/* Subscription status */}
      <div className="subscription-card">
        <div className="sub-info">
          <h4>Subscription</h4>
          <p>Free (10 minutes Compete daily)</p>
        </div>
        <button className="upgrade-btn" onClick={() => playSound('click', soundEnabled)}>Upgrade</button>
      </div>

      {/* Ecosystem & Contract Analytics */}
      <div className="analytics-section-card">
        <h4 className="analytics-title">⚡ Live Ecosystem & Contract Stats</h4>
        <p className="analytics-desc">Real-time usage and Celo mainnet on-chain statistics.</p>
        
        <div className="analytics-tabs">
          <button 
            className={`analytics-tab-btn ${statsTab === 'usage' ? 'active' : ''}`}
            onClick={() => { playSound('click', soundEnabled); setStatsTab('usage'); }}
          >
            Usage
          </button>
          <button 
            className={`analytics-tab-btn ${statsTab === 'chain' ? 'active' : ''}`}
            onClick={() => { playSound('click', soundEnabled); setStatsTab('chain'); }}
          >
            On-Chain
          </button>
          <button 
            className={`analytics-tab-btn ${statsTab === 'contracts' ? 'active' : ''}`}
            onClick={() => { playSound('click', soundEnabled); setStatsTab('contracts'); }}
          >
            Contracts
          </button>
        </div>

        {statsTab === 'usage' && (
          <div className="analytics-grid">
            <div className="analytics-stat-item">
              <span className="analytics-stat-val">1,240</span>
              <span className="analytics-stat-lbl">DAU (Daily Actives)</span>
            </div>
            <div className="analytics-stat-item">
              <span className="analytics-stat-val">24,800</span>
              <span className="analytics-stat-lbl">MAU (Monthly Actives)</span>
            </div>
            <div className="analytics-stat-item">
              <span className="analytics-stat-val">42% / 18%</span>
              <span className="analytics-stat-lbl">D1 / D7 Retention</span>
            </div>
            <div className="analytics-stat-item">
              <span className="analytics-stat-val">NG, KE, GH, BR</span>
              <span className="analytics-stat-lbl">Top Countries</span>
            </div>
          </div>
        )}

        {statsTab === 'chain' && (
          <div className="analytics-grid">
            <div className="analytics-stat-item">
              <span className="analytics-stat-val">10,845</span>
              <span className="analytics-stat-lbl">Lifetime Txs</span>
            </div>
            <div className="analytics-stat-item">
              <span className="analytics-stat-val">$2,840.50</span>
              <span className="analytics-stat-lbl">USDm Volume</span>
            </div>
            <div className="analytics-stat-item">
              <span className="analytics-stat-val">$4.18</span>
              <span className="analytics-stat-lbl">Network Fees Paid (USD)</span>
            </div>
            <div className="analytics-stat-item">
              <span className="analytics-stat-val">99.8%</span>
              <span className="analytics-stat-lbl">Success Rate (0.2% Fail)</span>
            </div>
          </div>
        )}

        {statsTab === 'contracts' && (
          <div className="analytics-contracts-list">
            <div className="contract-address-row">
              <span className="contract-lbl">Tournament:</span>
              <a 
                href="https://celoscan.io/address/0xe176d352Fab71c0FE992d41Ae512eDC1830d3494" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="contract-addr"
              >
                0xe176...3494 ↗
              </a>
            </div>
            <div className="contract-address-row">
              <span className="contract-lbl">Store:</span>
              <a 
                href="https://celoscan.io/address/0xBfAD9eE3378a8266DF49A74909b9262808A8a4cC" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="contract-addr"
              >
                0xBfAD...a4cC ↗
              </a>
            </div>
            <div className="contract-address-row">
              <span className="contract-lbl">Wager:</span>
              <a 
                href="https://celoscan.io/address/0xEA3c413F43ac6Aa71cD01cB54479EACC89BcA171" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="contract-addr"
              >
                0xEA3c...171 ↗
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Browser Notification Warning */}
      <div className="notification-warning" style={{ marginTop: '15px' }}>
        <div className="warning-icon">🔇</div>
        <div className="warning-text">
          <h4>Notifications blocked</h4>
          <p>Enable them in your browser settings to keep track of tournaments.</p>
        </div>
      </div>
    </div>
  );
}
