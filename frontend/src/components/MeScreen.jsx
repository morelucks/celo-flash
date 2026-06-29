import React from 'react';
import { useGameState } from '../context/GameStateContext';
import { playSound } from '../utils/audio';
import avatarUrl from '../assets/avatar.png';

export default function MeScreen() {
  const { cash, points, gamesPlayed, setCurrentTab, soundEnabled } = useGameState();

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
            <span className="stat-label">CELO</span>
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

      {/* Browser Notification Warning */}
      <div className="notification-warning">
        <div className="warning-icon">🔇</div>
        <div className="warning-text">
          <h4>Notifications blocked</h4>
          <p>Enable them in your browser settings to keep track of tournaments.</p>
        </div>
      </div>
    </div>
  );
}
