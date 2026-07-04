import React, { useState } from 'react';
import { useGameState } from '../context/GameStateContext';
import { playSound } from '../utils/audio';

export default function TourneysScreen({ onOpenPlayModal, onOpenCreateModal }) {
  const { tournaments, soundEnabled } = useGameState();
  const [filterType, setFilterType] = useState('upcoming');

  const handleFilterChange = (filter) => {
    playSound('click', soundEnabled);
    setFilterType(filter);
  };

  const handleJoinClick = (tourney) => {
    playSound('click', soundEnabled);
    onOpenPlayModal(tourney);
  };

  // Tournament lists based on filters
  let filteredList = [];
  if (filterType === 'upcoming') {
    filteredList = tournaments.filter(t => t.entry > 0);
  } else if (filterType === 'live') {
    filteredList = tournaments;
  } else if (filterType === 'mine') {
    filteredList = tournaments.filter(t => t.isUserCreated);
  } else if (filterType === 'past') {
    filteredList = tournaments.filter(t => t.highScore > 10000);
  } else if (filterType === 'earner') {
    filteredList = tournaments.filter(t => t.pot >= 20);
  }

  // Find trending tournaments (underdogs and free cup, or any user created ones)
  const trendingList = tournaments.slice(0, 3);

  return (
    <div className="screen active" id="screen-tourneys">
      <div className="tourney-header">
        <div>
          <h2 className="screen-title">Tournaments</h2>
          <p className="tourney-subtitle">Compete for USDm or CELO prize pools.</p>
        </div>
        <button 
          className="create-tourney-btn" 
          id="btn-create-tourney-modal"
          onClick={() => { playSound('click', soundEnabled); onOpenCreateModal(); }}
        >
          <span className="plus-icon">+</span> Create
        </button>
      </div>

      <div className="tourney-section-title">🔥 Trending Tournaments</div>
      
      {/* Horizontal Tourney Cards Scroll */}
      <div className="tourney-scroll-row" id="trending-tourneys-container">
        {trendingList.map((t) => (
          <div key={t.id} className={`tourney-card-horizontal ${t.id === 'tourney-underdogs' ? 'gradient-border' : ''}`}>
            <div className="tourney-card-header">
              <div className={`tourney-avatar ${t.avatarClass}`}>{t.emoji}</div>
              <span className={`tourney-tag-ends ${t.id === 'tourney-free' ? 'red-bg' : ''}`}>
                {t.id === 'tourney-free' ? 'Ends in 1h 15m' : `Ends in ${t.ends}`}
              </span>
            </div>
            <h3 className="tourney-card-title">{t.title}</h3>
            <p className="tourney-card-meta">{t.tag}</p>
            <div className="tourney-card-footer">
              <div className="tourney-pricing">
                <span className="entry-price">
                  {t.entry === 0 ? 'Free entry' : t.assetType === 'CELO' ? `${t.entry.toFixed(2)} CELO entry` : `$${t.entry.toFixed(2)} entry`}
                </span>
                <span className="pool-size">{t.assetType === 'CELO' ? `${t.pot.toFixed(2)} CELO` : `$${t.pot.toFixed(2)}`} TOTAL POT</span>
              </div>
              <button 
                className="join-tourney-arrow-btn" 
                onClick={() => handleJoinClick(t)}
              >
                →
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Tourney Filter Tabs */}
      <div className="tourney-filters">
        {['upcoming', 'live', 'mine', 'past', 'earner'].map((filter) => (
          <button
            key={filter}
            className={`filter-pill ${filterType === filter ? 'active' : ''}`}
            onClick={() => handleFilterChange(filter)}
          >
            {filter === 'earner' ? '💰 Earner' : filter.charAt(0).toUpperCase() + filter.slice(1)}
          </button>
        ))}
      </div>

      {/* Filtered List Content */}
      <div className="tourney-list-container" id="filtered-tourneys-list">
        {filteredList.length === 0 ? (
          <div className="empty-state">
            <p>No tournaments scheduled in this category. Create one — it goes live at least 2h after creation.</p>
            <span className="help-circle">?</span>
          </div>
        ) : (
          <div className="tourneys-vertical-list">
            {filteredList.map((t) => (
              <div 
                key={t.id} 
                className="tourney-card-vertical" 
                onClick={() => handleJoinClick(t)}
                style={{ cursor: 'pointer' }}
              >
                <div className="tourney-avatar-container">
                  <div className={`tourney-avatar ${t.avatarClass}`}>{t.emoji}</div>
                </div>
                <div className="tourney-info-vertical">
                  <h4>{t.title}</h4>
                  <div className="tourney-row-details">
                    <span>Pool: {t.assetType === 'CELO' ? `${t.pot.toFixed(2)} CELO` : `$${t.pot.toFixed(2)}`}</span>
                    <span>•</span>
                    <span>Entry: {t.entry === 0 ? 'Free' : t.assetType === 'CELO' ? `${t.entry.toFixed(2)} CELO` : `$${t.entry.toFixed(2)}`}</span>
                  </div>
                </div>
                <div className="tourney-status-vertical">
                  <span className="high-score-tag">Best: {t.highScore}</span>
                  <span className="ends-tag">{t.ends} left</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
