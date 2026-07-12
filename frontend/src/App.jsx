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
import SavingsCoachDrawer from './components/SavingsCoachDrawer';
import SavingsScreen from './components/SavingsScreen';

function MainAppContent() {
  const [isSDKLoaded, setIsSDKLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const inMiniApp = await sdk.isInMiniApp();
        if (inMiniApp) {
          // 1. Call ready() immediately to hide splash/loading screens
          await sdk.actions.ready();
          
          // 2. Fetch context asynchronously in the background
          sdk.context.then((context) => {
            if (context && context.user) {
              setFarcasterUser(context.user);
              if (context.user.username) {
                setUserName(context.user.username);
              }
            }
          }).catch((ctxError) => {
            console.error("Error loading Farcaster context:", ctxError);
          });
        }
      } catch (error) {
        console.error("Failed to initialize Farcaster SDK:", error);
      } finally {
        setIsSDKLoaded(true);
      }
    };
    if (!isSDKLoaded) {
      load();
    }
  }, [isSDKLoaded, setFarcasterUser, setUserName]);

  const {
    currentTab,
    setCurrentTab,
    showCreateModal,
    setShowCreateModal,
    showPlayModal,
    setShowPlayModal,
    selectedTourney,
    setSelectedTourney,
    savingsGoal,
    setFarcasterUser,
    setUserName
  } = useGameState();

  // Initialize wallet connection
  useWallet();

  const [swapOpen, setSwapOpen] = useState(false);
  const [isCoachOpen, setIsCoachOpen] = useState(false);

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
      case 'savings':
        return <SavingsScreen />;
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

        {/* Goal Progress Banner */}
        {savingsGoal && savingsGoal.target > 0 && (
          <div className="goal-progress-banner" onClick={() => setIsCoachOpen(true)}>
            <div className="goal-banner-info">
              <span>Goal: {savingsGoal.title}</span>
              <span>${savingsGoal.current.toFixed(2)} / ${savingsGoal.target.toFixed(2)}</span>
            </div>
            <div className="goal-banner-progress-bg">
              <div 
                className="goal-banner-progress-bar" 
                style={{ width: `${Math.min(100, (savingsGoal.current / savingsGoal.target) * 100)}%` }}
              ></div>
            </div>
          </div>
        )}

        {/* Content Screens */}
        <div className={`app-screen-container tab-${currentTab}`}>
          {renderScreen()}
        </div>

        {/* Floating AI Coach Trigger */}
        <button 
          className="ai-coach-floating-btn" 
          onClick={() => setIsCoachOpen(true)}
          title="AI Savings Coach"
        >
          🤖
        </button>

        {/* Bottom Menu Navigation */}
        <FooterNav />

      </div>

      {/* Modal Dialog Overlays */}
      <SavingsCoachDrawer isOpen={isCoachOpen} onClose={() => setIsCoachOpen(false)} />
      
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
