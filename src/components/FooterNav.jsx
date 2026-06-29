import React from 'react';
import { useGameState } from '../context/GameStateContext';
import { playSound } from '../utils/audio';

export default function FooterNav() {
  const { currentTab, setCurrentTab, tasks, soundEnabled } = useGameState();

  const handleTabClick = (tabName) => {
    playSound('click', soundEnabled);
    setCurrentTab(tabName);
  };

  // Show a red dot notification on the Tasks tab if any task is uncompleted
  const hasUncompletedTasks = Object.values(tasks).some(completed => !completed);

  return (
    <div className="app-footer-nav">
      <button 
        className={`nav-item ${currentTab === 'game' ? 'active' : ''}`} 
        onClick={() => handleTabClick('game')}
      >
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
        </svg>
        <span className="nav-label">Game</span>
      </button>

      <button 
        className={`nav-item ${currentTab === 'tasks' ? 'active' : ''}`} 
        onClick={() => handleTabClick('tasks')}
      >
        <div className="nav-icon-container">
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
          </svg>
          {hasUncompletedTasks && <span className="red-badge-dot"></span>}
        </div>
        <span className="nav-label">Tasks</span>
      </button>

      <button 
        className={`nav-item ${currentTab === 'tourneys' ? 'active' : ''}`} 
        onClick={() => handleTabClick('tourneys')}
      >
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z"></path>
          <path d="M3 20h18"></path>
        </svg>
        <span className="nav-label">Tourneys</span>
      </button>

      <button 
        className={`nav-item ${currentTab === 'store' ? 'active' : ''}`} 
        onClick={() => handleTabClick('store')}
      >
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 20h20"></path>
          <path d="M5 17V9H19V17"></path>
          <path d="M3 9l2-4h14l2 4"></path>
        </svg>
        <span className="nav-label">Shop</span>
      </button>

      <button 
        className={`nav-item ${currentTab === 'me' ? 'active' : ''}`} 
        onClick={() => handleTabClick('me')}
      >
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
          <circle cx="12" cy="11" r="3"></circle>
        </svg>
        <span className="nav-label">Me</span>
      </button>
    </div>
  );
}
