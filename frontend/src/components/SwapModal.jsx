import React, { useState } from 'react';
import { useGameState } from '../context/GameStateContext';
import { playSound } from '../utils/audio';
import { isMiniPay, redirectToDeposit } from '../utils/minipay';

export default function SwapModal({ isOpen, onClose }) {
  const { cash, setCash, points, setPoints, soundEnabled } = useGameState();
  const [amount, setAmount] = useState('5.00');
  const celoRate = 1.6; // ~ $0.62 per CELO rate

  if (!isOpen) return null;

  const expectedCelo = amount && !isNaN(amount) ? Math.round(parseFloat(amount) * celoRate) : 0;

  const handleSwap = () => {
    playSound('click', soundEnabled);
    const val = parseFloat(amount);
    if (!amount || isNaN(val) || val <= 0) {
      alert("Please enter a valid amount!");
      return;
    }
    if (cash >= val) {
      setCash(prev => Number((prev - val).toFixed(2)));
      setPoints(prev => prev + expectedCelo);
      playSound('victory', soundEnabled);
      alert(`Successfully swapped $${val.toFixed(2)} USDm for ${expectedCelo} Points!`);
      onClose();
    } else {
      if (isMiniPay()) {
        redirectToDeposit();
      } else {
        alert("Insufficient USDm balance!");
      }
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <div className="modal-header">
          <h3>Swap USDm to Points</h3>
          <button className="close-modal-btn" onClick={() => { playSound('click', soundEnabled); onClose(); }}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="swap-amount">Amount USDm ($)</label>
            <input
              type="number"
              id="swap-amount"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 5.00"
            />
          </div>
          <div className="tourney-prize-summary" style={{ marginTop: '15px' }}>
            <div>
              <span>You Pay:</span>
              <strong className="purple-highlight">${parseFloat(amount || 0).toFixed(2)} USDm</strong>
            </div>
            <div>
              <span>You Receive:</span>
              <strong className="gold-text">✨ {expectedCelo} Points</strong>
            </div>
          </div>
          <button className="modal-submit-btn" onClick={handleSwap} style={{ marginTop: '20px' }}>
            Confirm Swap
          </button>
        </div>
      </div>
    </div>
  );
}

