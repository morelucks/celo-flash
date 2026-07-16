import React, { useState, useEffect, Suspense } from 'react';
import sdk from '@farcaster/miniapp-sdk';
import { GameStateProvider, useGameState } from './context/GameStateContext';
import { useWallet } from './hooks/useWallet';
import Header from './components/Header';
import TickerMarquee from './components/TickerMarquee';
import FooterNav from './components/FooterNav';

// Lazy load screens and modals for code splitting
const GameScreen = React.lazy(() => import('./components/GameScreen'));
const TasksScreen = React.lazy(() => import('./components/TasksScreen'));
const TourneysScreen = React.lazy(() => import('./components/TourneysScreen'));
const StoreScreen = React.lazy(() => import('./components/StoreScreen'));
const MeScreen = React.lazy(() => import('./components/MeScreen'));
const SavingsScreen = React.lazy(() => import('./components/SavingsScreen'));
const SwapModal = React.lazy(() => import('./components/SwapModal'));
const CreateTourneyModal = React.lazy(() => import('./components/CreateTourneyModal'));
const PlayTourneyModal = React.lazy(() => import('./components/PlayTourneyModal'));
const SavingsCoachDrawer = React.lazy(() => import('./components/SavingsCoachDrawer'));

const PageLoader = () => (
  <div className="connect-loading-container" style={{ minHeight: '300px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
    <div className="spinner"></div>
    <div className="loading-text">Loading...</div>
  </div>
);

function MainAppContent() {
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
          <Suspense fallback={<PageLoader />}>
            {renderScreen()}
          </Suspense>
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
      <Suspense fallback={null}>
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
      </Suspense>
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
