import React, { createContext, useState, useEffect, useContext } from 'react';

const GameStateContext = createContext();

const initialTournaments = [
  {
    id: 'tourney-underdogs',
    title: 'UNDERDOGS WILL RISE 🔥',
    tag: '24 Hour Tournament',
    entry: 0.30,
    pot: 30.00,
    ends: '7h 52m',
    emoji: '🦖',
    avatarClass: 'bg-avatar-green',
    highScore: 12450
  },
  {
    id: 'tourney-free',
    title: 'Daily Free Cup',
    tag: '22 Hour Tournament',
    entry: 0.00,
    pot: 5.00,
    ends: '1h 15m',
    emoji: '🧙‍♂️',
    avatarClass: 'bg-avatar-blue',
    highScore: 8900
  }
];

export const GameStateProvider = ({ children }) => {
  const [currentTab, setCurrentTab] = useState('game');
  const [score, setScore] = useState(0);
  const [timer, setTimer] = useState(30);
  const [bestScore, setBestScore] = useState(18705);
  const [points, setPoints] = useState(100); // CELO
  const [cash, setCash] = useState(10.00); // USDm
  const [gamesPlayed, setGamesPlayed] = useState(0);
  const [difficulty, setDifficulty] = useState('easy');
  const [playing, setPlaying] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [character, setCharacter] = useState('default'); // 'default', 'valora', 'mento'
  const [userAddress, setUserAddress] = useState(null);
  const [userName, setUserName] = useState('Guest');
  const [farcasterUser, setFarcasterUser] = useState(null);
  const [powerups, setPowerups] = useState({
    magnet: 1,
    shield: 1,
    clock: 0
  });
  const [activePowerups, setActivePowerups] = useState({
    magnet: false,
    shield: false,
    clock: false
  });
  const [tasks, setTasks] = useState({
    tg: false,
    buy: false,
    affirmation: false
  });
  const [tournaments, setTournaments] = useState(initialTournaments);
  const [selectedTourney, setSelectedTourney] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPlayModal, setShowPlayModal] = useState(false);

  // Total savings in Aave V3 yield pool, savings goal and conversational messages
  const [totalSaved, setTotalSaved] = useState(4.50);
  const [savingsGoal, setSavingsGoal] = useState({
    title: 'Spawner Skin',
    target: 10.00,
    current: 4.50
  });
  const [coachMessages, setCoachMessages] = useState([]);

  // Sync savingsGoal current with totalSaved dynamically
  useEffect(() => {
    setSavingsGoal(prev => {
      if (!prev) return { title: 'Spawner Skin', target: 10.00, current: totalSaved };
      return {
        ...prev,
        current: totalSaved
      };
    });
  }, [totalSaved]);

  // Keep track of the last loaded address and initialization state to prevent overwriting
  const [lastLoadedAddress, setLastLoadedAddress] = useState(null);
  const [isStateInitialized, setIsStateInitialized] = useState(false);

  // Load from local storage when userAddress changes
  useEffect(() => {
    const key = userAddress ? `celo_flash_state_${userAddress.toLowerCase()}` : 'celo_flash_state_guest';
    const data = localStorage.getItem(key);
    
    if (data) {
      try {
        const parsed = JSON.parse(data);
        setBestScore(parsed.bestScore !== undefined ? parsed.bestScore : 18705);
        setPoints(parsed.points !== undefined ? parsed.points : 100);
        setCash(parsed.cash !== undefined ? parsed.cash : 10.00);
        setGamesPlayed(parsed.gamesPlayed !== undefined ? parsed.gamesPlayed : 0);
        setPowerups(parsed.powerups !== undefined ? parsed.powerups : { magnet: 1, shield: 1, clock: 0 });
        setTasks(parsed.tasks !== undefined ? parsed.tasks : { tg: false, buy: false, affirmation: false });
        setCharacter(parsed.character !== undefined ? parsed.character : 'default');
        setUserName(parsed.userName !== undefined ? parsed.userName : 'Guest');
        setTotalSaved(parsed.totalSaved !== undefined ? parsed.totalSaved : 4.50);
        setSavingsGoal(parsed.savingsGoal !== undefined ? parsed.savingsGoal : { title: 'Spawner Skin', target: 10.00, current: 4.50 });
        setCoachMessages(parsed.coachMessages !== undefined ? parsed.coachMessages : []);
      } catch (e) {
        console.error("Error loading localStorage state:", e);
      }
    } else {
      // Reset to defaults for a new address
      setBestScore(18705);
      setPoints(100);
      setCash(10.00);
      setGamesPlayed(0);
      setPowerups({ magnet: 1, shield: 1, clock: 0 });
      setTasks({ tg: false, buy: false, affirmation: false });
      setCharacter('default');
      setUserName(userAddress ? `Player ${userAddress.slice(0, 6)}` : 'Guest');
      setTotalSaved(4.50);
      setSavingsGoal({ title: 'Spawner Skin', target: 10.00, current: 4.50 });
      setCoachMessages([]);
    }
    
    setLastLoadedAddress(userAddress);
    setIsStateInitialized(true);
  }, [userAddress]);

  // Save to local storage when persistent state changes
  useEffect(() => {
    // Only save if the state has been initialized and corresponds to the active userAddress
    if (!isStateInitialized || lastLoadedAddress !== userAddress) {
      return;
    }
    
    const key = userAddress ? `celo_flash_state_${userAddress.toLowerCase()}` : 'celo_flash_state_guest';
    localStorage.setItem(key, JSON.stringify({
      bestScore,
      points,
      cash,
      gamesPlayed,
      powerups,
      tasks,
      tournaments,
      character,
      userAddress,
      userName,
      totalSaved,
      savingsGoal,
      coachMessages
    }));
  }, [
    bestScore, points, cash, gamesPlayed, powerups, tasks, tournaments,
    character, userAddress, userName, totalSaved, savingsGoal, coachMessages,
    isStateInitialized, lastLoadedAddress
  ]);

  const addPoints = (amount) => setPoints(prev => prev + amount);
  const addCash = (amount) => setCash(prev => prev + amount);
  const spendPoints = (amount) => setPoints(prev => Math.max(0, prev - amount));
  const spendCash = (amount) => setCash(prev => Math.max(0, prev - amount));

  const verifyTask = (taskId, rewardPoints) => {
    setTasks(prev => ({
      ...prev,
      [taskId]: true
    }));
    setPoints(prev => prev + rewardPoints);
  };

  const buyPowerup = (type, cost, qty = 1) => {
    if (cash < cost) {
      alert("Insufficient USDm cash balance!");
      return false;
    }
    setCash(prev => Number((prev - cost).toFixed(2)));
    setPowerups(prev => ({
      ...prev,
      [type]: (prev[type] || 0) + qty
    }));
    return true;
  };

  const buyAllPowerups = () => {
    const cost = 0.20;
    if (cash < cost) {
      alert("Insufficient USDm cash balance!");
      return false;
    }
    setCash(prev => Number((prev - cost).toFixed(2)));
    setPowerups(prev => ({
      ...prev,
      magnet: (prev.magnet || 0) + 1,
      shield: (prev.shield || 0) + 1,
      clock: (prev.clock || 0) + 1
    }));
    return true;
  };
  const buySpawner = (spawnerType, cost) => {
    if (cash < cost) {
      alert("Insufficient USDm cash balance!");
      return false;
    }
    setCash(prev => Number((prev - cost).toFixed(2)));
    setCharacter(spawnerType);
    return true;
  };

  const createTournament = (name, entryFee, prizePool, durationHours, assetType = 'USDm') => {
    const newTourney = {
      id: `tourney-${Date.now()}`,
      title: name,
      tag: `${durationHours} Hour Tournament`,
      entry: Number(entryFee),
      pot: Number(prizePool),
      ends: `${durationHours}h`,
      emoji: assetType === 'USDT' ? '🍀' : '🏆',
      avatarClass: assetType === 'USDT' ? 'bg-avatar-blue' : 'bg-avatar-gold',
      highScore: 0,
      isUserCreated: true,
      assetType: assetType
    };
    setTournaments(prev => [newTourney, ...prev]);
  };

  const submitTournamentScore = (tourneyId, submittedScore) => {
    setTournaments(prev => prev.map(t => {
      if (t.id === tourneyId && submittedScore > t.highScore) {
        return { ...t, highScore: submittedScore };
      }
      return t;
    }));
  };

  return (
    <GameStateContext.Provider value={{
      currentTab,
      setCurrentTab,
      score,
      setScore,
      timer,
      setTimer,
      bestScore,
      setBestScore,
      points,
      setPoints,
      cash,
      setCash,
      gamesPlayed,
      setGamesPlayed,
      difficulty,
      setDifficulty,
      playing,
      setPlaying,
      soundEnabled,
      setSoundEnabled,
      character,
      setCharacter,
      powerups,
      setPowerups,
      activePowerups,
      setActivePowerups,
      tasks,
      setTasks,
      tournaments,
      setTournaments,
      selectedTourney,
      setSelectedTourney,
      showCreateModal,
      setShowCreateModal,
      showPlayModal,
      setShowPlayModal,
      userAddress,
      setUserAddress,
      userName,
      setUserName,
      farcasterUser,
      setFarcasterUser,
      totalSaved,
      setTotalSaved,
      savingsGoal,
      setSavingsGoal,
      coachMessages,
      setCoachMessages,
      addPoints,
      addCash,
      spendPoints,
      spendCash,
      verifyTask,
      buyPowerup,
      buyAllPowerups,
      buySpawner,
      createTournament,
      submitTournamentScore
    }}>
      {children}
    </GameStateContext.Provider>
  );
};

export const useGameState = () => useContext(GameStateContext);
