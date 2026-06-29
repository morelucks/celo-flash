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
        return <GameScreen onOpenShop={() => setCurrentTab('store')} />;
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
        return <GameScreen onOpenShop={() => setCurrentTab('store')} />;
    }
  };

  return (
    <div className="warpcast-desktop-bg">
      {/* Warpcast Search & Frame Simulator for Desktop */}
      <div className="warpcast-top-nav">
        <div className="search-container">
          <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input type="text" placeholder="Search Warpcast" disabled />
          <kbd className="search-kbd">⌘K</kbd>
        </div>
      </div>

      {/* Phone Viewport Container */}
      <div className="phone-container">
        
        {/* Header Bar */}
        <Header onOpenSwap={() => setSwapOpen(true)} />

        {/* Rolling News Marquee */}
        <TickerMarquee />

        {/* Content Screens */}
        <div className="app-screen-container">
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
