import React, { useState, useEffect, useRef } from 'react';
import { useGameState } from '../context/GameStateContext';
import { playSound } from '../utils/audio';

export default function GameScreen({ onOpenStore }) {
  const {
    score,
    setScore,
    timer,
    setTimer,
    bestScore,
    setBestScore,
    points,
    setPoints,
    difficulty,
    setDifficulty,
    playing,
    setPlaying,
    soundEnabled,
    character,
    powerups,
    setPowerups,
    activePowerups,
    setActivePowerups,
    gamesPlayed,
    setGamesPlayed,
    selectedTourney,
    setSelectedTourney,
    submitTournamentScore
  } = useGameState();

  const [showStartOverlay, setShowStartOverlay] = useState(true);
  const [showGameOverOverlay, setShowGameOverOverlay] = useState(false);
  const [pointsEarned, setPointsEarned] = useState(0);

  const canvasRef = useRef(null);

  // Initial stats values to show
  const displayScore = score;
  const displayTimer = timer;

  const handleStartGame = () => {
    playSound('click', soundEnabled);
    
    // Deduct wager if applicable
    if (difficulty.includes('wager')) {
      if (points < 10) {
        alert("Insufficient $CELO Points balance! Wager costs 10 $CELO.");
        return;
      }
      setPoints(prev => prev - 10);
    }

    setScore(0);
    setTimer(30);
    setPlaying(true);
    setShowStartOverlay(false);
    setShowGameOverOverlay(false);
  };

  const handleRestartGame = () => {
    playSound('click', soundEnabled);
    setShowGameOverOverlay(false);
    setShowStartOverlay(true);
  };

  const handlePowerupClick = (type) => {
    if (playing) return; // Cannot toggle during active gameplay
    if ((powerups[type] || 0) <= 0) {
      playSound('click', soundEnabled);
      alert(`You do not own any ${type} power-ups! Buy some from the Store.`);
      return;
    }

    playSound('powerup', soundEnabled);
    // Toggle active power-up state
    const nextState = !activePowerups[type];
    setActivePowerups(prev => ({
      ...prev,
      [type]: nextState
    }));

    // Deduct 1 power-up when activating
    if (nextState) {
      setPowerups(prev => ({
        ...prev,
        [type]: prev[type] - 1
      }));
    } else {
      // Refund if deactivated before starting
      setPowerups(prev => ({
        ...prev,
        [type]: prev[type] + 1
      }));
    }
  };

  return (
    <div className="screen active" id="screen-game">
      {/* Game HUD */}
      <div className="game-hud">
        <div className="hud-item">
          <span className="hud-label">Score:</span>
          <span className="hud-value" id="hud-score">{displayScore.toLocaleString()}</span>
        </div>
        <div className="hud-item">
          <span className="hud-label">Time:</span>
          <span className="hud-value" id="hud-timer">{displayTimer}s</span>
        </div>
        <div className="hud-item">
          <span className="hud-label">Best:</span>
          <span className="hud-value" id="hud-best">{bestScore.toLocaleString()}</span>
        </div>
      </div>

      {/* Main Gameplay Area */}
      <div className="game-board-container">
        <div className="notch-cutout"></div>
        
        {/* Game Start Overlay */}
        {showStartOverlay && (
          <div className="game-overlay" id="game-start-overlay">
            <h2 className="game-main-title">flash CELO</h2>
            <p className="game-rules">Collect CELOs <span className="celo-dot"></span> • Avoid bombs 💣</p>
            
            <div className="difficulty-wrapper">
              <select 
                id="difficulty-select" 
                className="custom-select"
                value={difficulty}
                onChange={(e) => { playSound('click', soundEnabled); setDifficulty(e.target.value); }}
              >
                <option value="easy">Free • Easy</option>
                <option value="hard">Free • Hard</option>
                <option value="wager-easy">Wager 10 $CELO • Easy</option>
                <option value="wager-hard">Wager 10 $CELO • Hard</option>
              </select>
            </div>

            <button className="start-btn" id="btn-start-game" onClick={handleStartGame}>
              click to Start
            </button>

            <div className="powerups-section">
              <h3 className="section-title">Power Ups</h3>
              <div className="powerups-row">
                {['magnet', 'shield', 'clock'].map((type) => {
                  const hasStock = (powerups[type] || 0) > 0;
                  const isActive = activePowerups[type];
                  const icon = type === 'magnet' ? '🧲' : type === 'shield' ? '🛡️' : '⏰';
                  const title = type.toUpperCase() + (hasStock ? ` (Owned: ${powerups[type]})` : ' (LOCKED - Buy in Store)');

                  return (
                    <div 
                      key={type}
                      className={`powerup-slot ${isActive ? 'active' : ''}`} 
                      id={`powerup-${type}`} 
                      title={title}
                      onClick={() => handlePowerupClick(type)}
                    >
                      <span className="powerup-badge">{icon}</span>
                      {!hasStock && !isActive && <span className="lock-indicator">🔒</span>}
                      {hasStock && <span className="count-badge">{powerups[type]}</span>}
                    </div>
                  );
                })}
              </div>
              <button className="store-redirect-btn" id="btn-get-powerups" onClick={() => { playSound('click', soundEnabled); onOpenStore(); }}>
                🛍️ Get from Store
              </button>
            </div>

            {/* Flashino Badge */}
            <div className="flashino-badge">
              <div className="flashino-icon">⚡</div>
              <span>CELOFLASH</span>
            </div>
          </div>
        )}

        {/* Game Over Overlay */}
        {showGameOverOverlay && (
          <div className="game-overlay" id="game-over-overlay">
            <h2 className="game-main-title">Game Over</h2>
            <div className="score-results">
              <div className="result-row">
                <span>Score:</span>
                <span id="final-score" className="purple-highlight">{displayScore.toLocaleString()}</span>
              </div>
              {displayScore > bestScore && (
                <div className="result-row" id="high-score-row">
                  <span className="gold-text">🏆 New High Score!</span>
                </div>
              )}
              <div className="result-row">
                <span>Earned:</span>
                <span><span id="earned-points" className="gold-text">+{pointsEarned.toLocaleString()}</span> Points</span>
              </div>
            </div>
            <button className="start-btn" id="btn-restart-game" onClick={handleRestartGame}>
              Play Again
            </button>
          </div>
        )}

        {/* Canvas for Arcade Game */}
        <canvas ref={canvasRef} id="game-canvas" width="350" height="480"></canvas>
      </div>
    </div>
  );
}
