import React, { useState } from 'react';
import { useGameState } from '../context/GameStateContext';
import { playSound } from '../utils/audio';

export default function CreateTourneyModal({ isOpen, onClose }) {
  const { createTournament, soundEnabled } = useGameState();
  const [name, setName] = useState('');
  const [assetType, setAssetType] = useState('USDm'); // 'USDm' or 'CELO'
  const [entry, setEntry] = useState('0.5');
  const [pool, setPool] = useState('50');
  const [duration, setDuration] = useState('24');

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    playSound('click', soundEnabled);
    if (!name.trim()) {
      alert("Please enter a tournament name!");
      return;
    }
    createTournament(name, entry, pool, duration, assetType);
    playSound('victory', soundEnabled);
    alert(`Tournament "${name}" successfully created with ${assetType}! It will go live shortly.`);
    onClose();
  };

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <div className="modal-header">
          <h3>Create Tournament</h3>
          <button className="close-modal-btn" onClick={() => { playSound('click', soundEnabled); onClose(); }}>&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-group">
            <label htmlFor="tourney-name">Tournament Name</label>
            <input 
              type="text" 
              id="tourney-name" 
              placeholder="e.g. Degen Clash 🚀" 
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="tourney-asset">Entry Asset</label>
            <select 
              id="tourney-asset"
              value={assetType}
              onChange={(e) => setAssetType(e.target.value)}
            >
              <option value="USDm">USDm (Stablecoin)</option>
              <option value="CELO">CELO (Native Token)</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="tourney-entry">Entry Fee ({assetType === 'CELO' ? 'CELO' : '$'})</label>
            <input 
              type="number" 
              id="tourney-entry" 
              step="0.1" 
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="tourney-pool">Prize Pool ({assetType === 'CELO' ? 'CELO' : '$'})</label>
            <input 
              type="number" 
              id="tourney-pool" 
              step="1" 
              value={pool}
              onChange={(e) => setPool(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="tourney-duration">Duration (hours)</label>
            <select 
              id="tourney-duration"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            >
              <option value="2">2 Hours</option>
              <option value="12">12 Hours</option>
              <option value="24">24 Hours</option>
              <option value="48">48 Hours</option>
            </select>
          </div>
          <button type="submit" className="modal-submit-btn" id="btn-submit-tourney">
            Create Tournament
          </button>
        </form>
      </div>
    </div>
  );
}
