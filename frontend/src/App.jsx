import React, { useState, useEffect } from 'react';
import sdk from '@farcaster/miniapp-sdk';
import { GameStateProvider, useGameState } from './context/GameStateContext';
import { useWallet } from './hooks/useWallet';
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
  const [isSDKLoaded, setIsSDKLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        await sdk.actions.ready();
        setIsSDKLoaded(true);
      } catch (error) {
        console.error("Failed to initialize Farcaster SDK:", error);
      }
    };
    if (!isSDKLoaded) {
      load();
    }
  }, [isSDKLoaded]);

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

  // Initialize wallet connection
  useWallet();

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
      {/* Phone Viewport Container */}
      <div className="phone-container">
        
        {/* Header Bar */}
        <Header onOpenSwap={() => setSwapOpen(true)} />

        {/* Rolling News Marquee */}
        <TickerMarquee />

        {/* Content Screens */}
        <div className={`app-screen-container tab-${currentTab}`}>
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
