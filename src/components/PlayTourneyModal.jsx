import React from 'react';
import { useGameState } from '../context/GameStateContext';
import { playSound } from '../utils/audio';

export default function PlayTourneyModal({ isOpen, onClose, onStartGame }) {
  const { 
    selectedTourney, 
    cash, 
    setCash, 
    setCurrentTab, 
    setSelectedTourney, 
    soundEnabled 
  } = useGameState();

  if (!isOpen || !selectedTourney) return null;

  const handleConfirmPlay = () => {
    playSound('click', soundEnabled);
    if (cash >= selectedTourney.entry) {
      setCash(prev => Number((prev - selectedTourney.entry).toFixed(2)));
      onClose();
      setCurrentTab('game');
      // Delay start slightly to let tab transition finish
      setTimeout(() => {
        onStartGame(selectedTourney);
      }, 100);
    } else {
      alert("Insufficient USDm cash balance! Add funds or top up.");
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <div className="modal-header">
          <h3 id="play-tourney-title">Join Tournament</h3>
          <button className="close-modal-btn" onClick={() => { playSound('click', soundEnabled); onClose(); }}>&times;</button>
        </div>
        <div className="modal-body">
          <p className="modal-text">
            Wager <span className="purple-highlight">${selectedTourney.entry.toFixed(2)}</span> to submit your next game score to this tournament.
          </p>
          <div className="tourney-prize-summary">
            <div>
              <span>Prize Pool:</span>
              <strong id="play-tourney-prize">${selectedTourney.pot.toFixed(2)}</strong>
            </div>
            <div>
              <span>Current High Score:</span>
              <strong id="play-tourney-highscore">{selectedTourney.highScore.toLocaleString()}</strong>
            </div>
          </div>
          <button className="modal-submit-btn" id="btn-confirm-play-tourney" onClick={handleConfirmPlay}>
            Pay & Play Game
          </button>
        </div>
      </div>
    </div>
  );
}
