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
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="2" y="6" width="20" height="12" rx="2"></rect>
          <path d="M6 12h4m-2-2v4m7-2h.01M18 12h.01"></path>
        </svg>
        <span className="nav-label">Game</span>
      </button>

      <button 
        className={`nav-item ${currentTab === 'tasks' ? 'active' : ''}`} 
        onClick={() => handleTabClick('tasks')}
      >
        <div className="nav-icon-container">
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 11l3 3L22 4"></path>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
          </svg>
          {hasUncompletedTasks && <span className="red-badge-dot"></span>}
        </div>
        <span className="nav-label">Tasks</span>
      </button>

      <button 
        className={`nav-item ${currentTab === 'tourneys' ? 'active' : ''}`} 
        onClick={() => handleTabClick('tourneys')}
      >
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path>
          <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path>
          <path d="M4 22h16"></path>
          <path d="M10 14.66V17c0 .55-.45 1-1 1H4v2h16v-2h-5c-.55 0-1-.45-1-1v-2.34"></path>
          <path d="M12 2a4 4 0 0 1 4 4v7a4 4 0 0 1-4 4 4 4 0 0 1-4-4V6a4 4 0 0 1 4-4z"></path>
        </svg>
        <span className="nav-label">Tourneys</span>
      </button>

      <button 
        className={`nav-item ${currentTab === 'store' ? 'active' : ''}`} 
        onClick={() => handleTabClick('store')}
      >
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <path d="M16 10a4 4 0 0 1-8 0"></path>
        </svg>
        <span className="nav-label">Store</span>
      </button>

      <button 
        className={`nav-item ${currentTab === 'me' ? 'active' : ''}`} 
        onClick={() => handleTabClick('me')}
      >
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
        <span className="nav-label">Me</span>
      </button>
    </div>
  );
}
