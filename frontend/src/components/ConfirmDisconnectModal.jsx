import React from 'react';
import { playSound } from '../utils/audio';

/**
 * ConfirmDisconnectModal
 * Premium dialog asking user to confirm wallet disconnection.
 */
export default function ConfirmDisconnectModal({ isOpen, onClose, onConfirm, soundEnabled }) {
  if (!isOpen) return null;

  const handleCancel = () => {
    playSound('click', soundEnabled);
    onClose();
  };

  const handleConfirm = () => {
    playSound('click', soundEnabled);
    onConfirm();
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ margin: 0 }}>Disconnect Wallet</h3>
          <button className="close-modal-btn" onClick={handleCancel}>×</button>
        </div>

        <div className="modal-body">
          <p className="modal-text" style={{ marginBottom: '12px', fontSize: '0.85rem', lineHeight: '1.4' }}>
            Are you sure you want to disconnect your wallet? You will need to reconnect to view your profile and join tournaments.
          </p>

          <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
            <button 
              className="modal-submit-btn" 
              onClick={handleCancel}
              style={{ 
                flex: 1, 
                backgroundColor: 'rgba(255, 255, 255, 0.05)', 
                color: 'white', 
                boxShadow: 'none', 
                marginTop: 0 
              }}
            >
              Cancel
            </button>
            <button 
              className="modal-submit-btn" 
              onClick={handleConfirm}
              style={{ 
                flex: 1, 
                backgroundColor: '#ef4444', 
                color: 'white', 
                borderColor: 'rgba(255, 255, 255, 0.1)', 
                boxShadow: '0 4px 12px rgba(239, 68, 68, 0.2)', 
                marginTop: 0 
              }}
            >
              Disconnect
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
