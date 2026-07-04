import React, { useState } from 'react';
import { useGameState } from '../context/GameStateContext';
import { playSound } from '../utils/audio';
import { isMiniPay, redirectToDeposit } from '../utils/minipay';

export default function StoreScreen() {
  const { 
    cash, 
    setCash, 
    setPoints, 
    character,
    setCharacter, 
    powerups, 
    setPowerups, 
    soundEnabled 
  } = useGameState();

  const [qtyMultiplier, setQtyMultiplier] = useState(1);
  const [qtyRenewal, setQtyRenewal] = useState(1);

  const handleQtyChange = (type, direction) => {
    playSound('click', soundEnabled);
    if (type === 'multiplier') {
      setQtyMultiplier(prev => direction === 'plus' ? Math.min(99, prev + 1) : Math.max(1, prev - 1));
    } else if (type === 'renewal') {
      setQtyRenewal(prev => direction === 'plus' ? Math.min(99, prev + 1) : Math.max(1, prev - 1));
    }
  };

  const handleBuyMultiplier = () => {
    const cost = qtyMultiplier * 0.04;
    if (cash >= cost) {
      setCash(prev => Number((prev - cost).toFixed(2)));
      setPoints(prev => prev + qtyMultiplier * 5);
      playSound('collect-green', soundEnabled);
      alert(`Purchased ${qtyMultiplier} Score Multipliers!`);
    } else {
      if (isMiniPay()) {
        redirectToDeposit();
      } else {
        alert("Insufficient USDm balance! Swap or deposit funds.");
      }
    }
  };

  const handleBuyRenewal = () => {
    const cost = qtyRenewal * 0.10;
    if (cash >= cost) {
      setCash(prev => Number((prev - cost).toFixed(2)));
      setPoints(prev => prev + qtyRenewal * 15);
      playSound('collect-green', soundEnabled);
      alert(`Daily Renewal activated! Playtime renewed.`);
    } else {
      if (isMiniPay()) {
        redirectToDeposit();
      } else {
        alert("Insufficient USDm balance! Swap or deposit funds.");
      }
    }
  };

  const handleBuyAllPowerups = () => {
    const cost = 0.20;
    if (cash >= cost) {
      setCash(prev => Number((prev - cost).toFixed(2)));
      setPowerups(prev => ({
        ...prev,
        magnet: (prev.magnet || 0) + 1,
        shield: (prev.shield || 0) + 1,
        clock: (prev.clock || 0) + 1
      }));
      playSound('collect-green', soundEnabled);
      alert("Success! Purchased Magnet, Shield, and Clock powerups.");
    } else {
      if (isMiniPay()) {
        redirectToDeposit();
      } else {
        alert("Insufficient USDm balance! Swap or deposit funds.");
      }
    }
  };

  const handleBuySpawner = (spawnerType) => {
    const cost = 0.05;
    if (cash >= cost) {
      setCash(prev => Number((prev - cost).toFixed(2)));
      setCharacter(spawnerType);
      playSound('victory', soundEnabled);
      alert(`Theme successfully unlocked! Avatar changed to ${spawnerType}.`);
    } else {
      if (isMiniPay()) {
        redirectToDeposit();
      } else {
        alert("Insufficient USDm balance! Swap or deposit funds.");
      }
    }
  };


  return (
    <div className="screen active" id="screen-store">
      <div className="store-section">
        <div className="store-section-header">
          <h2 className="store-title">🚨 EMERGENCY TOP-UPS</h2>
        </div>
        
        <div className="topups-grid">
          {/* Topup 1 */}
          <div className="topup-card">
            <div className="topup-icon">⚡</div>
            <h3 className="topup-name">Score Multiplier</h3>
            <p className="topup-desc">+1 charge • 2x-5x your run</p>
            <div className="quantity-control">
              <button className="qty-btn qty-minus" onClick={() => handleQtyChange('multiplier', 'minus')}>-</button>
              <span className="qty-val" id="qty-multiplier">{qtyMultiplier}</span>
              <button className="qty-btn qty-plus" onClick={() => handleQtyChange('multiplier', 'plus')}>+</button>
            </div>
            <button className="buy-item-btn" onClick={handleBuyMultiplier}>
              Buy • ${(qtyMultiplier * 0.04).toFixed(2)}
            </button>
          </div>

          {/* Topup 2 */}
          <div className="topup-card">
            <div className="topup-icon">🎮</div>
            <h3 className="topup-name">Daily Renewal</h3>
            <p className="topup-desc">+10 min playtime each</p>
            <div className="quantity-control">
              <button className="qty-btn qty-minus" onClick={() => handleQtyChange('renewal', 'minus')}>-</button>
              <span className="qty-val" id="qty-renewal">{qtyRenewal}</span>
              <button className="qty-btn qty-plus" onClick={() => handleQtyChange('renewal', 'plus')}>+</button>
            </div>
            <button className="buy-item-btn" onClick={handleBuyRenewal}>
              Buy • ${(qtyRenewal * 0.10).toFixed(2)}
            </button>
          </div>
        </div>

        <div className="store-action-banner">
          <div className="buy-all-desc">
            <h4>Buy All Power-ups</h4>
            <p>Activate Magnet, Shield, and Clock at once!</p>
          </div>
          <button className="buy-all-btn" onClick={handleBuyAllPowerups}>
            $0.20 BUY ALL
          </button>
        </div>
      </div>

      {/* Feature Items Section */}
      <div className="store-section mt-4">
        <h3 className="store-section-title">Special Spawners</h3>
        <div className="spawners-list">
          <div className="spawner-card">
            <div className="spawner-avatar">💚</div>
            <div className="spawner-info">
              <h4>Valora Coin</h4>
              <p>Spawns Valora hearts. Lasts 24h once bought.</p>
            </div>
            <button 
              className={`buy-spawner-btn ${character === 'valora' ? 'active-spawner' : ''}`}
              onClick={() => handleBuySpawner('valora')}
            >
              {character === 'valora' ? 'Active' : 'Buy • $0.05'}
            </button>
          </div>

          <div className="spawner-card">
            <div className="spawner-avatar">🍀</div>
            <div className="spawner-info">
              <h4>Mento Token</h4>
              <p>Spawns Mento leaves. Lasts 24h once bought.</p>
            </div>
            <button 
              className={`buy-spawner-btn ${character === 'mento' ? 'active-spawner' : ''}`}
              onClick={() => handleBuySpawner('mento')}
            >
              {character === 'mento' ? 'Active' : 'Buy • $0.05'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
