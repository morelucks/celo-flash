import React, { useState } from 'react';
import { GameStateProvider, useGameState } from './context/GameStateContext';
import Header from './components/Header';
import TickerMarquee from './components/TickerMarquee';
import GameScreen from './components/GameScreen';
import TasksScreen from './components/TasksScreen';
import TourneysScreen from './components/TourneysScreen';
import StoreScreen from './components/StoreScreen';
import MeScreen from './components/MeScreen';
import FooterNav from './components/FooterNav';
import SwapModal from './components/SwapModal';
import CreateTourneyModal from './components/CreateTourneyModal';
import PlayTourneyModal from './components/PlayTourneyModal';

function MainAppContent() {
  const {
    currentTab,
    setCurrentTab,
    showCreateModal,
    setShowCreateModal,
    showPlayModal,
    setShowPlayModal,
    selectedTourney,
    setSelectedTourney
  } = useGameState();

  const [swapOpen, setSwapOpen] = useState(false);

  // Render the current screen
  const renderScreen = () => {
    switch (currentTab) {
      case 'game':
        return <GameScreen onOpenStore={() => setCurrentTab('store')} />;
      case 'tasks':
        return <TasksScreen onOpenSwap={() => setSwapOpen(true)} />;
      case 'tourneys':
        return (
          <TourneysScreen 
            onOpenPlayModal={(t) => { setSelectedTourney(t); setShowPlayModal(true); }}
            onOpenCreateModal={() => setShowCreateModal(true)}
          />
        );
      case 'store':
        return <StoreScreen />;
      case 'me':
        return <MeScreen />;
      default:
        return <GameScreen onOpenStore={() => setCurrentTab('store')} />;
    }
  };

  return (
    <div className="warpcast-desktop-bg">
      {/* Warpcast Search & Frame Simulator for Desktop */}
      <div className="warpcast-top-nav">
        <div className="nav-left">
          <div className="warpcast-logo-sm">W</div>
          <span className="nav-title">Warpcast</span>
        </div>
        <div className="search-bar-sim">
          <span className="search-icon">🔍</span>
          <input type="text" placeholder="Search" disabled />
        </div>
        <div className="nav-right">
          <button className="cast-btn-sim">Cast</button>
        </div>
      </div>

      {/* Phone Viewport Container */}
      <div className="phone-container">
        
        {/* Header Bar */}
        <Header onOpenSwap={() => setSwapOpen(true)} />

        {/* Rolling News Marquee */}
        <TickerMarquee />

        {/* Content Screens */}
        <div className="screen-container">
          {renderScreen()}
        </div>

        {/* Bottom Menu Navigation */}
        <FooterNav />

      </div>

      {/* Modal Dialog Overlays */}
      <SwapModal isOpen={swapOpen} onClose={() => setSwapOpen(false)} />
      
      <CreateTourneyModal 
        isOpen={showCreateModal} 
        onClose={() => setShowCreateModal(false)} 
      />

      <PlayTourneyModal 
        isOpen={showPlayModal} 
        onClose={() => setShowPlayModal(false)}
        onStartGame={(t) => {
          // PlayTourneyModal redirects to game tab, which handles starting the game
        }}
      />
    </div>
  );
}

export default function App() {
  return (
    <GameStateProvider>
      <MainAppContent />
    </GameStateProvider>
  );
}
