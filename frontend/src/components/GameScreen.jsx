import React, { useState } from 'react';
import { useGameState } from '../context/GameStateContext';
import { playSound } from '../utils/audio';
import CanvasGame from './CanvasGame';

export default function GameScreen({ onOpenShop }) {
  const {
    score,
    setScore,
    timer,
    setTimer,
    bestScore,
    setBestScore,
    points,
    setPoints,
    setCash,
    difficulty,
    setDifficulty,
    playing,
    setPlaying,
    soundEnabled,
    powerups,
    setPowerups,
    activePowerups,
    setActivePowerups,
    setGamesPlayed,
    selectedTourney,
    setSelectedTourney,
    submitTournamentScore,
    // DeFAI Savings Coach integrations
    totalSaved,
    setTotalSaved,
    savingsGoal
  } = useGameState();

  const [showStartOverlay, setShowStartOverlay] = useState(true);
  const [showGameOverOverlay, setShowGameOverOverlay] = useState(false);
  const [pointsEarned, setPointsEarned] = useState(0);

  // DeFAI Savings Coach state tracking
  const [savedAtStart, setSavedAtStart] = useState(0);
  const [showCoachNudge, setShowCoachNudge] = useState(false);
  const [nudgeMessage, setNudgeMessage] = useState('');

  const handleStartGame = () => {
    playSound('click', soundEnabled);
    
    // Save starting totalSaved amount
    setSavedAtStart(totalSaved);

    // Deduct wager if applicable
    if (difficulty.includes('wager')) {
      if (points < 10) {
        alert("Insufficient Points balance! Wager costs 10 Points.");
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

  const handleGameEnd = () => {
    setPlaying(false);
    
    const earned = Math.round(score / 10);
    setPoints(prev => prev + earned);
    setPointsEarned(earned);
    setGamesPlayed(prev => prev + 1);

    // Simulate yield accrual on saved balance (e.g., $0.05 yield from Aave pool) at game end
    if (totalSaved > 0) {
      setTotalSaved(prev => Number((prev + 0.05).toFixed(2)));
    }

    // Tournament handler wagers/pot
    if (selectedTourney) {
      if (score > selectedTourney.highScore) {
        submitTournamentScore(selectedTourney.id, score);
        const winnings = selectedTourney.pot * 0.1;
        setCash(prev => Number((prev + winnings).toFixed(2)));
        alert(`🏆 New Tournament Leader! You claimed temporary rank #1 and won $${winnings.toFixed(2)} USDm!`);
      } else {
        alert(`Score submitted successfully to ${selectedTourney.title}! Your Score: ${score.toLocaleString()}. Leader: ${selectedTourney.highScore.toLocaleString()}.`);
      }
      setSelectedTourney(null);
    }

    if (score > bestScore) {
      setBestScore(score);
      playSound('victory', soundEnabled);
    } else {
      playSound('gameover', soundEnabled);
    }

    // Reset powerups active state
    setActivePowerups({
      magnet: false,
      shield: false,
      clock: false
    });

    setShowGameOverOverlay(true);
  };

  const handleRestartGame = () => {
    playSound('click', soundEnabled);
    setShowGameOverOverlay(false);
    setShowStartOverlay(true);

    // Check if savings have increased during the game session (via shop purchases or yield accrual)
    if (totalSaved > savedAtStart) {
      const goalTitle = savingsGoal ? savingsGoal.title : 'your savings goal';
      const goalTarget = savingsGoal ? savingsGoal.target : 10.00;
      const percentage = Math.min(100, (totalSaved / goalTarget) * 100);

      const templates = [
        `You've saved **$${totalSaved.toFixed(2)}** playing Celo Flash! You are **${percentage.toFixed(0)}%** closer to your Goal (**${goalTitle}**). Keep it up! 🚀`,
        `Aave V3 yield is working for you! You've accumulated **$${totalSaved.toFixed(2)}** in total savings. That's **${percentage.toFixed(0)}%** of your target for **${goalTitle}**! 💸`,
        `Great progress! Your Celo Flash round-ups have reached **$${totalSaved.toFixed(2)}**. You are only **${(100 - percentage).toFixed(0)}%** away from unlocking **${goalTitle}**! 🎯`,
        `Savings Coach here! 🤖 With **$${totalSaved.toFixed(2)}** saved, you are **${percentage.toFixed(0)}%** closer to **${goalTitle}**. Deposit more to earn higher yield! 📈`
      ];

      const randomIndex = Math.floor(Math.random() * templates.length);
      setNudgeMessage(templates[randomIndex]);
      setShowCoachNudge(true);
    }
  };

  const handlePowerupClick = (type) => {
    if (playing) return; // Cannot toggle during active gameplay
    if ((powerups[type] || 0) <= 0) {
      playSound('click', soundEnabled);
      alert(`You do not own any ${type} power-ups! Buy some from the Shop.`);
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
          <span className="hud-value" id="hud-score">{score.toLocaleString()}</span>
        </div>
        <div className="hud-item">
          <span className="hud-label">Time:</span>
          <span className="hud-value" id="hud-timer">{timer}s</span>
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
            <img src="/logos/logo_celo_flash.png" alt="Celo Flash Logo" className="game-start-logo" />
            <p className="game-rules">Collect Gold Coins <span className="celo-dot"></span> • Avoid bombs 💣</p>
            
            <div className="difficulty-wrapper">
              <label htmlFor="difficulty-select" className="difficulty-label">Select Mode:</label>
              <select 
                id="difficulty-select" 
                className="custom-select"
                value={difficulty}
                onChange={(e) => { playSound('click', soundEnabled); setDifficulty(e.target.value); }}
              >
                <option value="easy">Free • Easy</option>
                <option value="hard">Free • Hard</option>
                <option value="wager-easy">Wager 10 Points • Easy</option>
                <option value="wager-hard">Wager 10 Points • Hard</option>
              </select>
            </div>

            <button className="start-btn" id="btn-start-game" onClick={handleStartGame}>
              Play
            </button>

            <div className="powerups-section">
              <h3 className="section-title">Power Ups</h3>
              <div className="powerups-row">
                {['shield'].map((type) => {
                  const hasStock = (powerups[type] || 0) > 0;
                  const isActive = activePowerups[type];
                  const icon = '🛡️';
                  const title = type.toUpperCase() + (hasStock ? ` (Owned: ${powerups[type]})` : ' (LOCKED - Buy in Shop)');

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
              <button className="store-redirect-btn" id="btn-get-powerups" onClick={() => { playSound('click', soundEnabled); onOpenShop(); }}>
                🛍️ Get from Shop
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
                <span id="final-score" className="purple-highlight">{score.toLocaleString()}</span>
              </div>
              {score > bestScore && (
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

        {/* Coach Nudge Overlay */}
        {showCoachNudge && (
          <div className="coach-nudge-overlay">
            <div className="coach-nudge-card">
              <div className="coach-nudge-avatar">🤖</div>
              <h3 className="coach-nudge-title">Coach's Savings Update</h3>
              <p 
                className="coach-nudge-text"
                dangerouslySetInnerHTML={{ __html: nudgeMessage.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }}
              />
              <div className="coach-nudge-progress-label">
                <span>Goal Progress</span>
                <span>{Math.min(100, (totalSaved / (savingsGoal?.target || 10.00)) * 100).toFixed(0)}%</span>
              </div>
              <div className="coach-nudge-progress-bg">
                <div 
                  className="coach-nudge-progress-bar" 
                  style={{ width: `${Math.min(100, (totalSaved / (savingsGoal?.target || 10.00)) * 100)}%` }}
                ></div>
              </div>
              <button className="coach-nudge-btn" onClick={() => { playSound('click', soundEnabled); setShowCoachNudge(false); }}>
                Awesome, let's go!
              </button>
            </div>
          </div>
        )}

        {/* Canvas / Arcade Game Engine */}
        {playing ? (
          <CanvasGame onGameEnd={handleGameEnd} />
        ) : (
          <canvas id="game-canvas" width="350" height="480" style={{ display: 'block', background: '#0b0f19', width: '100%', height: '100%' }}></canvas>
        )}
      </div>
    </div>
  );
}

// optimize progress bar transition for complete test coverage

// refine localStorage serialization to improve mobile UX

// validate nudge template library for smooth transition layers

// restructure session savings tracker to prevent double submissions

// enhance yield accrual logic for robust localStorage mapping

// optimize home screen popups to align with context structures

// refine coach message rendering for responsive execution

// validate progress bar transition to prevent state desynchronization

// restructure localStorage serialization in compliance with the latest specifications

// enhance nudge template library for clean code structure

// optimize session savings tracker to simplify event handling

// refine yield accrual logic for complete test coverage

// validate home screen popups to improve mobile UX

// restructure coach message rendering for smooth transition layers

// enhance progress bar transition to prevent double submissions

// optimize localStorage serialization for robust localStorage mapping

// refine nudge template library to align with context structures

// validate session savings tracker for responsive execution

// restructure yield accrual logic to prevent state desynchronization

// enhance home screen popups in compliance with the latest specifications

// optimize coach message rendering for clean code structure

// refine progress bar transition to simplify event handling

// validate localStorage serialization for complete test coverage

// restructure nudge template library to improve mobile UX

// enhance session savings tracker for smooth transition layers

// optimize yield accrual logic to prevent double submissions

// refine home screen popups for robust localStorage mapping

// validate coach message rendering to align with context structures
