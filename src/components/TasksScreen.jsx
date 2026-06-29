import React, { useState } from 'react';
import { useGameState } from '../context/GameStateContext';
import { playSound } from '../utils/audio';

export default function TasksScreen({ onOpenSwap }) {
  const { tasks, verifyTask, soundEnabled } = useGameState();
  const [activeSubTab, setActiveSubTab] = useState('default');
  const [loadingTask, setLoadingTask] = useState({});

  const handleVerify = (taskId, reward) => {
    if (tasks[taskId] || loadingTask[taskId]) return;
    playSound('click', soundEnabled);
    
    setLoadingTask(prev => ({ ...prev, [taskId]: true }));

    // Simulate verification check
    setTimeout(() => {
      setLoadingTask(prev => ({ ...prev, [taskId]: false }));
      verifyTask(taskId, reward);
      playSound('collect-green', soundEnabled);
    }, 1500);
  };

  const getVerifyButtonText = (taskId) => {
    if (tasks[taskId]) return 'Verified';
    if (loadingTask[taskId]) return 'Checking...';
    return 'Verify';
  };

  return (
    <div className="screen active" id="screen-tasks">
      <h2 className="screen-title">Featured Tasks</h2>
      <div className="tasks-list">
        
        {/* Tasks Sub Tabs */}
        <div className="tasks-sub-tabs">
          <button 
            className={`sub-tab ${activeSubTab === 'daily' ? 'active' : ''}`} 
            onClick={() => { playSound('click', soundEnabled); setActiveSubTab('daily'); }}
          >
            Daily
          </button>
          <button 
            className={`sub-tab ${activeSubTab === 'default' ? 'active' : ''}`} 
            onClick={() => { playSound('click', soundEnabled); setActiveSubTab('default'); }}
          >
            Default {!tasks.tg || !tasks.buy ? <span className="red-dot"></span> : null}
          </button>
        </div>

        {activeSubTab === 'default' && (
          <>
            {/* Task 1: Telegram */}
            <div className="task-card" id="task-tg">
              <div className="task-info">
                <h3 className="task-name">Subscribe to CELO FLASH ON TG</h3>
                <p className="task-desc">Don't miss any tournaments</p>
                <span className="task-reward">+1 Points</span>
              </div>
              <div className="task-actions">
                <a 
                  href="https://t.me/celoflash" 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="task-btn go-btn"
                  onClick={() => playSound('click', soundEnabled)}
                >
                  Go
                </a>
                <button 
                  className={`task-btn verify-btn ${tasks.tg ? 'verified' : ''} ${loadingTask.tg ? 'loading' : ''}`}
                  disabled={tasks.tg || loadingTask.tg}
                  onClick={() => handleVerify('tg', 1)}
                >
                  {getVerifyButtonText('tg')}
                </button>
              </div>
            </div>

            {/* Task 2: Buy $CELO */}
            <div className="task-card" id="task-buy">
              <div className="task-info">
                <h3 className="task-name">Buy $CELO Tokens</h3>
                <p className="task-desc">Buy and hold at least 100 $CELO tokens.</p>
                <span className="task-reward">+100 Points</span>
              </div>
              <div className="task-actions">
                <button 
                  className="task-btn go-btn" 
                  onClick={() => { playSound('click', soundEnabled); onOpenSwap(); }}
                >
                  Buy
                </button>
                <button 
                  className={`task-btn verify-btn ${tasks.buy ? 'verified' : ''} ${loadingTask.buy ? 'loading' : ''}`}
                  disabled={tasks.buy || loadingTask.buy}
                  onClick={() => handleVerify('buy', 100)}
                >
                  {getVerifyButtonText('buy')}
                </button>
              </div>
            </div>
          </>
        )}

        {activeSubTab === 'daily' && (
          <div className="sub-task-content" id="tasks-daily-content">
            {/* Task 3: Claim Daily Affirmation */}
            <div className="task-card" id="task-affirmation">
              <div className="task-info">
                <h3 className="task-name">Claim Daily Affirmation</h3>
                <p className="task-desc">Start your day with intention. Mint your Daily Affirmation to manifest positivity!</p>
                <span className="task-reward">+10 Points</span>
              </div>
              <div className="task-actions">
                <a 
                  href="#" 
                  className="task-btn go-btn"
                  onClick={(e) => { e.preventDefault(); playSound('click', soundEnabled); }}
                >
                  Go
                </a>
                <button 
                  className={`task-btn verify-btn ${tasks.affirmation ? 'verified' : ''} ${loadingTask.affirmation ? 'loading' : ''}`}
                  disabled={tasks.affirmation || loadingTask.affirmation}
                  onClick={() => handleVerify('affirmation', 10)}
                >
                  {getVerifyButtonText('affirmation')}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
