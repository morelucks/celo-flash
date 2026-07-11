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

  // Total savings in Aave V3 yield pool and current saving goal
  const [totalSaved, setTotalSaved] = useState(4.50);
  const [savingsGoal, setSavingsGoal] = useState({
    title: 'Spawner Skin',
    target: 10.00,
    current: 4.50
  });

  // Sync savingsGoal current with totalSaved dynamically
  useEffect(() => {
    setSavingsGoal(prev => ({
      ...prev,
      current: totalSaved
    }));
  }, [totalSaved]);

  // Load from local storage on mount
  useEffect(() => {
    const data = localStorage.getItem('celo_flash_state');
    if (data) {
      try {
        const parsed = JSON.parse(data);
        if (parsed.bestScore !== undefined) setBestScore(parsed.bestScore);
        if (parsed.points !== undefined) setPoints(parsed.points);
        if (parsed.cash !== undefined) setCash(parsed.cash);
        if (parsed.gamesPlayed !== undefined) setGamesPlayed(parsed.gamesPlayed);
        if (parsed.powerups !== undefined) setPowerups(parsed.powerups);
        if (parsed.tasks !== undefined) setTasks(parsed.tasks);
        if (parsed.tournaments !== undefined) setTournaments(parsed.tournaments);
        if (parsed.character !== undefined) setCharacter(parsed.character);
        if (parsed.userAddress !== undefined) setUserAddress(parsed.userAddress);
        if (parsed.userName !== undefined) setUserName(parsed.userName);
        if (parsed.totalSaved !== undefined) setTotalSaved(parsed.totalSaved);
        if (parsed.savingsGoal !== undefined) setSavingsGoal(parsed.savingsGoal);
      } catch (e) {
        console.error("Error loading localStorage state:", e);
      }
    }
  }, []);

  // Save to local storage when persistent state changes
  useEffect(() => {
    localStorage.setItem('celo_flash_state', JSON.stringify({
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
      savingsGoal
    }));
  }, [bestScore, points, cash, gamesPlayed, powerups, tasks, tournaments, character, userAddress, userName, totalSaved, savingsGoal]);

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
      totalSaved,
      setTotalSaved,
      savingsGoal,
      setSavingsGoal,
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
