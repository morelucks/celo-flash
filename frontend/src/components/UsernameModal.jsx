import React, { useState } from 'react';
import { playSound } from '../utils/audio';

export default function UsernameModal({ isOpen, onClose, onSave, currentUsername, soundEnabled }) {
  const [username, setUsername] = useState(currentUsername || '');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSave = () => {
    playSound('click', soundEnabled);
    
    if (!username.trim()) {
      setError('Username cannot be empty');
      return;
    }
    
    if (username.length < 3) {
      setError('Username must be at least 3 characters');
      return;
    }
    
    if (username.length > 20) {
      setError('Username must be less than 20 characters');
      return;
    }
    
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setError('Username can only contain letters, numbers, and underscores');
      return;
    }

    onSave(username);
    setError('');
  };

  const handleCancel = () => {
    playSound('click', soundEnabled);
    setError('');
    setUsername(currentUsername || '');
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Set Your Username</h3>
          <button className="close-modal-btn" onClick={handleCancel}>×</button>
        </div>

        <div className="modal-body">
          <p className="modal-text" style={{ marginBottom: '8px' }}>
            Choose a username that will be displayed on your profile
          </p>
          
          <div className="form-group">
            <label htmlFor="username-input">USERNAME</label>
            <input
              id="username-input"
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError('');
              }}
              placeholder="Enter username"
              maxLength={20}
              className={error ? 'input-error' : ''}
              autoFocus
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleSave();
                }
              }}
            />
            {error && (
              <div className="input-error-message">
                {error}
              </div>
            )}
            <div className="input-helper-text">
              {username.length}/20 characters
            </div>
          </div>

          <button className="modal-submit-btn" onClick={handleSave}>
            Save Username
          </button>
        </div>
      </div>
    </div>
  );
}
