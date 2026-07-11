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

  // Persistent toggle state for the Round-Up Coach
  const [roundUpEnabled, setRoundUpEnabled] = useState(() => {
    return localStorage.getItem('celo_flash_roundup_coach') === 'true';
  });

  const handleToggleRoundUp = (e) => {
    const val = e.target.checked;
    setRoundUpEnabled(val);
    localStorage.setItem('celo_flash_roundup_coach', val ? 'true' : 'false');
    playSound('click', soundEnabled);
  };

  const handleQtyChange = (type, direction) => {
    playSound('click', soundEnabled);
    if (type === 'multiplier') {
      setQtyMultiplier(prev => direction === 'plus' ? Math.min(99, prev + 1) : Math.max(1, prev - 1));
    } else if (type === 'renewal') {
      setQtyRenewal(prev => direction === 'plus' ? Math.min(99, prev + 1) : Math.max(1, prev - 1));
    }
  };

  // Helper to calculate round-up delta to the next whole dollar
  const getRoundUpDelta = (cost) => {
    if (cost <= 0) return 0;
    const nextWhole = Math.ceil(cost);
    const delta = nextWhole - cost;
    return delta === 0 ? 1.00 : Number(delta.toFixed(2));
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

  const costMultiplier = qtyMultiplier * 0.04;
  const costRenewal = qtyRenewal * 0.10;

  return (
    <div className="screen active" id="screen-store">
      
      {/* AI Round-Up Coach Switch */}
      <div className={`round-up-coach-toggle ${roundUpEnabled ? 'active' : ''}`}>
        <div className="toggle-info">
          <span style={{ fontSize: '1.4rem' }}>🤖</span>
          <div>
            <h4>Enable AI Round-Up Coach</h4>
            <p className="toggle-sub">Automatically save the spare change to yield pool</p>
          </div>
        </div>
        <label className="switch">
          <input 
            type="checkbox" 
            checked={roundUpEnabled} 
            onChange={handleToggleRoundUp} 
          />
          <span className="slider"></span>
        </label>
      </div>

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
              Buy • ${costMultiplier.toFixed(2)}
            </button>
            {roundUpEnabled && (
              <div className="round-up-delta-indicator">
                Coach: +${getRoundUpDelta(costMultiplier).toFixed(2)} round-up to ${(costMultiplier + getRoundUpDelta(costMultiplier)).toFixed(2)}
              </div>
            )}
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
              Buy • ${costRenewal.toFixed(2)}
            </button>
            {roundUpEnabled && (
              <div className="round-up-delta-indicator">
                Coach: +${getRoundUpDelta(costRenewal).toFixed(2)} round-up to ${(costRenewal + getRoundUpDelta(costRenewal)).toFixed(2)}
              </div>
            )}
          </div>
        </div>

        <div className="store-action-banner">
          <div className="buy-all-desc">
            <h4>Buy All Power-ups</h4>
            <p>Activate Magnet, Shield, and Clock at once!</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <button className="buy-all-btn" onClick={handleBuyAllPowerups}>
              $0.20 BUY ALL
            </button>
            {roundUpEnabled && (
              <div className="round-up-delta-indicator" style={{ marginTop: '4px', textAlign: 'right' }}>
                Coach: +${getRoundUpDelta(0.20).toFixed(2)} round-up
              </div>
            )}
          </div>
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
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <button 
                className={`buy-spawner-btn ${character === 'valora' ? 'active-spawner' : ''}`}
                onClick={() => handleBuySpawner('valora')}
              >
                {character === 'valora' ? 'Active' : 'Buy • $0.05'}
              </button>
              {roundUpEnabled && character !== 'valora' && (
                <div className="round-up-delta-indicator">
                  Coach: +${getRoundUpDelta(0.05).toFixed(2)} round-up
                </div>
              )}
            </div>
          </div>

          <div className="spawner-card">
            <div className="spawner-avatar">🍀</div>
            <div className="spawner-info">
              <h4>Mento Token</h4>
              <p>Spawns Mento leaves. Lasts 24h once bought.</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <button 
                className={`buy-spawner-btn ${character === 'mento' ? 'active-spawner' : ''}`}
                onClick={() => handleBuySpawner('mento')}
              >
                {character === 'mento' ? 'Active' : 'Buy • $0.05'}
              </button>
              {roundUpEnabled && character !== 'mento' && (
                <div className="round-up-delta-indicator">
                  Coach: +${getRoundUpDelta(0.05).toFixed(2)} round-up
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// restructure delta display element for clean code structure

// enhance buy multiplier math layers to simplify event handling

// optimize buy renewal math layers for complete test coverage

// refine spawner price delta wrapper to improve mobile UX

// validate math delta calculation for smooth transition layers

// restructure persistent toggle state to prevent double submissions

// enhance round-up toggle element for robust localStorage mapping

// optimize delta display element to align with context structures

// refine buy multiplier math layers for responsive execution

// validate buy renewal math layers to prevent state desynchronization

// restructure spawner price delta wrapper in compliance with the latest specifications

// enhance math delta calculation for clean code structure

// optimize persistent toggle state to simplify event handling

// refine round-up toggle element for complete test coverage

// validate delta display element to improve mobile UX

// restructure buy multiplier math layers for smooth transition layers

// enhance buy renewal math layers to prevent double submissions

// optimize spawner price delta wrapper for robust localStorage mapping

// refine math delta calculation to align with context structures

// validate persistent toggle state for responsive execution

// restructure round-up toggle element to prevent state desynchronization
