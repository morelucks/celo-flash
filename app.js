// Celo Flash Game Code (Rebranded)

// --- STATE MANAGEMENT ---
let state = {
  score: 0,
  timer: 30,
  bestScore: 18705,
  points: 100, // Starting balance in $CELO
  cash: 10.00, // Starting USDm
  gamesPlayed: 0,
  difficulty: 'easy',
  playing: false,
  soundEnabled: true,
  character: 'default', // 'default', 'valora', 'mento'
  powerups: {
    magnet: 1,
    shield: 1,
    clock: 0
  },
  activePowerups: {
    magnet: false,
    shield: false,
    clock: false
  },
  tasks: {
    tg: false,
    buy: false,
    affirmation: false
  },
  tournaments: [
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
  ],
  selectedTourney: null
};

// --- AUDIO ENGINE (Web Audio API Synthesizer) ---
let audioCtx = null;

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function playSound(type) {
  if (!state.soundEnabled) return;
  initAudio();
  if (!audioCtx) return;

  // Resume context if suspended (common browser policy)
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const now = audioCtx.currentTime;

  switch (type) {
    case 'click': {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.exponentialRampToValueAtTime(100, now + 0.08);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.08);
      break;
    }
    case 'collect-celo': {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(620, now);
      osc.frequency.setValueAtTime(950, now + 0.08);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
      break;
    }
    case 'collect-green': {
      // Ascending arpeggio
      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.05);
        gain.gain.setValueAtTime(0.12, now + idx * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.05 + 0.12);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + idx * 0.05);
        osc.stop(now + idx * 0.05 + 0.12);
      });
      break;
    }
    case 'explosion': {
      // Noise-like explosion sound
      const bufferSize = audioCtx.sampleRate * 0.3; // 0.3 seconds
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      
      const noise = audioCtx.createBufferSource();
      noise.buffer = buffer;
      
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(800, now);
      filter.frequency.exponentialRampToValueAtTime(50, now + 0.3);
      
      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(audioCtx.destination);
      noise.start(now);
      noise.stop(now + 0.3);
      break;
    }
    case 'shield-break': {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1000, now);
      osc.frequency.exponentialRampToValueAtTime(150, now + 0.25);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.25);
      break;
    }
    case 'powerup': {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.exponentialRampToValueAtTime(1200, now + 0.35);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.35);
      break;
    }
    case 'victory': {
      const notes = [587.33, 659.25, 698.46, 880.00, 987.77, 1046.50]; // D5, E5, F5, A5, B5, C6
      notes.forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);
        gain.gain.setValueAtTime(0.15, now + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.02, now + idx * 0.08 + 0.25);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 0.25);
      });
      break;
    }
    case 'gameover': {
      const notes = [440.00, 392.00, 349.23, 293.66]; // A4, G4, F4, D4
      notes.forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.15);
        gain.gain.setValueAtTime(0.15, now + idx * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.15 + 0.3);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + idx * 0.15);
        osc.stop(now + idx * 0.15 + 0.3);
      });
      break;
    }
  }
}

// --- LOCAL STORAGE SYNC ---
function saveToLocalStorage() {
  localStorage.setItem('celo_flash_state', JSON.stringify({
    bestScore: state.bestScore,
    points: state.points,
    cash: state.cash,
    gamesPlayed: state.gamesPlayed,
    powerups: state.powerups,
    tasks: state.tasks,
    tournaments: state.tournaments,
    character: state.character
  }));
}

function loadFromLocalStorage() {
  const data = localStorage.getItem('celo_flash_state');
  if (data) {
    try {
      const parsed = JSON.parse(data);
      state.bestScore = parsed.bestScore ?? state.bestScore;
      state.points = parsed.points ?? state.points;
      state.cash = parsed.cash ?? state.cash;
      state.gamesPlayed = parsed.gamesPlayed ?? state.gamesPlayed;
      state.powerups = parsed.powerups ?? state.powerups;
      state.tasks = parsed.tasks ?? state.tasks;
      state.tournaments = parsed.tournaments ?? state.tournaments;
      state.character = parsed.character ?? state.character;
    } catch (e) {
      console.error("Error loading localStorage state:", e);
    }
  }
}

// --- UI UPDATERS ---
function updateDOM() {
  document.getElementById('header-points').textContent = state.points.toLocaleString();
  document.getElementById('header-cash').textContent = state.cash.toFixed(2);
  document.getElementById('hud-best').textContent = state.bestScore.toLocaleString();
  
  // Power-up indicators on game-start screen
  updatePowerupUI('magnet');
  updatePowerupUI('shield');
  updatePowerupUI('clock');

  // Stats Grid on Me Tab
  document.getElementById('stats-usdm').textContent = `$${state.cash.toFixed(2)}`;
  document.getElementById('stats-celo').textContent = state.points.toLocaleString();
  document.getElementById('stats-played').textContent = state.gamesPlayed;

  // Task list Verify Button states
  updateTaskButton('tg');
  updateTaskButton('buy');
  updateTaskButton('affirmation');

  // Render lists
  renderTournaments();
}

function updatePowerupUI(type) {
  const slot = document.getElementById(`powerup-${type}`);
  const lock = slot.querySelector('.lock-indicator');
  const count = slot.querySelector('.count-badge');
  const countVal = state.powerups[type] || 0;

  if (countVal > 0) {
    lock.style.display = 'none';
    count.style.display = 'flex';
    count.textContent = countVal;
    slot.title = `${type.toUpperCase()} (Owned: ${countVal})`;
  } else {
    lock.style.display = 'flex';
    count.style.display = 'none';
    slot.title = `${type.toUpperCase()} (LOCKED - Buy in Store)`;
  }

  // Active state style
  if (state.activePowerups[type]) {
    slot.classList.add('active');
  } else {
    slot.classList.remove('active');
  }
}

function updateTaskButton(taskId) {
  const btn = document.querySelector(`.verify-btn[data-task="${taskId}"]`);
  if (!btn) return;

  if (state.tasks[taskId]) {
    btn.classList.add('verified');
    btn.classList.remove('loading');
    btn.textContent = 'Verified';
    btn.disabled = true;
  } else {
    btn.classList.remove('verified');
    btn.textContent = 'Verify';
    btn.disabled = false;
  }
}

// --- ARCADE GAME ENGINE (Canvas-based) ---
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

let animationFrameId = null;
let gameTimerInterval = null;

// Game Object Entities
let player = {
  x: canvas.width / 2,
  y: canvas.height - 60,
  radius: 25,
  targetX: canvas.width / 2,
  targetY: canvas.height - 60,
  avatarLoaded: false,
  avatarImg: new Image()
};

player.avatarImg.src = 'avatar.png';
player.avatarImg.onload = () => {
  player.avatarLoaded = true;
};

let items = [];
let particles = [];
let spawnRate = 45; // Frames between spawns
let frameCount = 0;

// Set up touch/mouse listeners
function setupControls() {
  const getPointerCoords = (e) => {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    // Convert client coords to canvas internal resolution
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height
    };
  };

  const handlePointerMove = (e) => {
    if (!state.playing) return;
    const coords = getPointerCoords(e);
    // Keep avatar within canvas boundaries
    player.targetX = Math.max(player.radius, Math.min(canvas.width - player.radius, coords.x));
    player.targetY = Math.max(player.radius + 40, Math.min(canvas.height - player.radius, coords.y));
  };

  canvas.addEventListener('mousemove', handlePointerMove);
  canvas.addEventListener('touchmove', handlePointerMove, { passive: true });
}

// Spawning items
function spawnItem() {
  const types = ['celo', 'celo', 'celo', 'bomb']; // 'celo' represents $CELO here
  // Harder difficulty spawns more bombs
  if (state.difficulty.includes('hard')) {
    types.push('bomb', 'bomb');
  } else {
    types.push('green'); // Green caret points bonus in easy
  }

  const type = types[Math.floor(Math.random() * types.length)];
  const size = type === 'bomb' ? 18 : 20;

  items.push({
    x: Math.random() * (canvas.width - size * 2) + size,
    y: -size,
    vy: (Math.random() * 2 + 3) * (state.difficulty.includes('hard') ? 1.4 : 1.0),
    type: type,
    size: size,
    angle: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.05
  });
}

// Particle System
function createParticles(x, y, color, count = 8) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 3 + 1;
    particles.push({
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: Math.random() * 3 + 2,
      color: color,
      life: 1,
      decay: Math.random() * 0.05 + 0.03
    });
  }
}

// Start Gameplay Loop
function startGame() {
  if (state.playing) return;

  // Deduct wager if applicable
  if (state.difficulty.includes('wager')) {
    if (state.points < 10) {
      alert("Insufficient $CELO Points balance! Wager costs 10 $CELO.");
      return;
    }
    state.points -= 10;
    playSound('click');
  }

  // Set up run state
  state.playing = true;
  state.score = 0;
  state.timer = 30;
  items = [];
  particles = [];
  frameCount = 0;
  
  // HUD update
  document.getElementById('hud-score').textContent = '0';
  document.getElementById('hud-timer').textContent = '30s';
  document.getElementById('game-start-overlay').classList.add('hidden');
  document.getElementById('game-over-overlay').classList.add('hidden');

  // Trigger audio
  playSound('victory');

  // Timer interval countdown
  gameTimerInterval = setInterval(() => {
    state.timer--;
    document.getElementById('hud-timer').textContent = `${state.timer}s`;

    if (state.timer <= 0) {
      endGame();
    }
  }, 1000);

  // Active power-up logic timers
  if (state.activePowerups.clock) {
    // Slow items for first 5 seconds
    playSound('powerup');
    setTimeout(() => {
      state.activePowerups.clock = false;
      updatePowerupUI('clock');
    }, 5000);
  }
  if (state.activePowerups.magnet) {
    playSound('powerup');
    setTimeout(() => {
      state.activePowerups.magnet = false;
      updatePowerupUI('magnet');
    }, 10000); // 10s magnet duration
  }
  if (state.activePowerups.shield) {
    playSound('powerup');
  }

  gameLoop();
}

function gameLoop() {
  if (!state.playing) return;

  // Clear Canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background visual layout (Teal grid line accents)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  const gridSpacing = 40;
  for (let x = 0; x < canvas.width; x += gridSpacing) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += gridSpacing) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  // Update Player Avatar physics (Smooth follow)
  player.x += (player.targetX - player.x) * 0.22;
  player.y += (player.targetY - player.y) * 0.22;

  // Draw Player Avatar
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 6;

  // Draw Shield Indicator (Gold glow for Celo)
  if (state.activePowerups.shield) {
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.radius + 8, 0, Math.PI * 2);
    ctx.strokeStyle = '#fbcc27';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#fbcc27';
    ctx.shadowBlur = 15;
    ctx.stroke();
    // Pulse animation
    ctx.fillStyle = 'rgba(251, 204, 39, 0.08)';
    ctx.fill();
  }

  // Base circular white clipping container
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.clip();

  // Draw Avatar image / Theme shapes
  if (state.character === 'default' && player.avatarLoaded) {
    ctx.drawImage(
      player.avatarImg,
      player.x - player.radius,
      player.y - player.radius,
      player.radius * 2,
      player.radius * 2
    );
  } else if (state.character === 'valora') {
    // Custom Valora Coin avatar face
    ctx.fillStyle = '#35d07f';
    ctx.fillRect(player.x - player.radius, player.y - player.radius, player.radius * 2, player.radius * 2);
    ctx.fillStyle = '#fff';
    ctx.font = '22px Arial';
    ctx.fillText('💚', player.x - 11, player.y + 7);
  } else if (state.character === 'mento') {
    // Custom Mento Coin avatar shape
    ctx.fillStyle = '#fbcc27';
    ctx.fillRect(player.x - player.radius, player.y - player.radius, player.radius * 2, player.radius * 2);
    ctx.fillStyle = '#fff';
    ctx.font = '22px Arial';
    ctx.fillText('🍀', player.x - 11, player.y + 7);
  } else {
    // Fallback vector drawing
    ctx.fillStyle = '#143d2f';
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.radius - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px Arial';
    ctx.fillText('@luckify', player.x - 20, player.y + 4);
  }
  ctx.restore();

  // Spawner intervals
  frameCount++;
  const adjustedSpawnRate = state.activePowerups.clock ? spawnRate * 2.2 : spawnRate;
  if (frameCount % Math.round(adjustedSpawnRate) === 0) {
    spawnItem();
  }

  // Update & Draw Items
  for (let i = items.length - 1; i >= 0; i--) {
    let item = items[i];
    item.angle += item.rotSpeed;

    // Apply Clock effect (slowdown)
    const currentVy = state.activePowerups.clock ? item.vy * 0.45 : item.vy;
    item.y += currentVy;

    // Magnet Power-up Logic: Pull collectibles towards player
    if (state.activePowerups.magnet && (item.type === 'celo' || item.type === 'green')) {
      const dx = player.x - item.x;
      const dy = player.y - item.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      // Pull range: 140px
      if (dist < 140) {
        const force = (140 - dist) / 140;
        const pullSpeed = 6.5;
        item.x += (dx / dist) * pullSpeed * force;
        item.y += (dy / dist) * pullSpeed * force;
      }
    }

    // Draw item
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.rotate(item.angle);

    if (item.type === 'celo') {
      if (state.character === 'valora') {
        // Valora heart collectible (Green base + heart)
        ctx.shadowColor = 'rgba(53, 208, 127, 0.5)';
        ctx.shadowBlur = 8;
        
        ctx.beginPath();
        ctx.arc(0, 0, item.size, 0, Math.PI * 2);
        ctx.fillStyle = '#35d07f';
        ctx.fill();
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, 0, item.size * 0.8, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = `${item.size * 1.1}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('💚', 0, 1);
      } else if (state.character === 'mento') {
        // Mento clover collectible (Gold base + clover)
        ctx.shadowColor = 'rgba(251, 204, 39, 0.5)';
        ctx.shadowBlur = 8;
        
        ctx.beginPath();
        ctx.arc(0, 0, item.size, 0, Math.PI * 2);
        ctx.fillStyle = '#fbcc27';
        ctx.fill();
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, 0, item.size * 0.8, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = `${item.size * 1.1}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🍀', 0, 1);
      } else {
        // Default Celo Gold coin with interlocking rings
        ctx.shadowColor = 'rgba(251, 204, 39, 0.5)';
        ctx.shadowBlur = 8;
        
        ctx.beginPath();
        ctx.arc(0, 0, item.size, 0, Math.PI * 2);
        ctx.fillStyle = '#fbcc27';
        ctx.fill();
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, 0, item.size * 0.8, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Two interlocking Celo rings
        ctx.lineWidth = 2.4;
        // Light Gold Ring
        ctx.beginPath();
        ctx.arc(-item.size * 0.18, 0, item.size * 0.32, 0, Math.PI * 2);
        ctx.strokeStyle = '#fcff52';
        ctx.stroke();
        
        // Dark Forest Overlap Ring
        ctx.beginPath();
        ctx.arc(item.size * 0.18, 0, item.size * 0.32, 0, Math.PI * 2);
        ctx.strokeStyle = '#06100c';
        ctx.stroke();
      }

    } else if (item.type === 'green') {
      // Draw Celo Green Points bonus Caret
      ctx.shadowColor = 'rgba(53, 208, 127, 0.4)';
      ctx.shadowBlur = 8;
      
      ctx.beginPath();
      ctx.arc(0, 0, item.size, 0, Math.PI * 2);
      ctx.fillStyle = '#35d07f';
      ctx.fill();
      
      ctx.beginPath();
      ctx.moveTo(-6, 4);
      ctx.lineTo(0, -6);
      ctx.lineTo(6, 4);
      ctx.strokeStyle = '#06100c';
      ctx.lineWidth = 3.5;
      ctx.stroke();

    } else if (item.type === 'bomb') {
      // Draw Bomb (Hazard)
      ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
      ctx.shadowBlur = 6;
      
      // Fuse spark
      ctx.beginPath();
      ctx.arc(8, -12, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#fbcc27';
      ctx.fill();

      // Fuse line
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.quadraticCurveTo(6, -8, 8, -12);
      ctx.strokeStyle = '#a1a1aa';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Bomb core
      ctx.beginPath();
      ctx.arc(0, 0, item.size, 0, Math.PI * 2);
      ctx.fillStyle = '#06100c';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      // Red center pulse
      const pulseColor = (Math.floor(Date.now() / 150) % 2 === 0) ? '#ef4444' : '#06100c';
      ctx.beginPath();
      ctx.arc(0, 0, item.size * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = pulseColor;
      ctx.fill();
    }
    ctx.restore();

    // Check collision with Player
    const dx = item.x - player.x;
    const dy = item.y - player.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < player.radius + item.size) {
      // COLLISION TRIGGERED!
      if (item.type === 'celo') {
        const addVal = state.difficulty.includes('hard') ? 200 : 100;
        state.score += addVal;
        createParticles(item.x, item.y, '#fcff52', 10); // Gold sparks for Celo
        playSound('collect-celo');
      } else if (item.type === 'green') {
        state.score += 300;
        createParticles(item.x, item.y, '#35d07f', 12); // Green sparks
        playSound('collect-green');
      } else if (item.type === 'bomb') {
        // Handle Shield
        if (state.activePowerups.shield) {
          state.activePowerups.shield = false;
          updatePowerupUI('shield');
          playSound('shield-break');
          createParticles(item.x, item.y, '#fbcc27', 15);
        } else {
          // Normal bomb hit: Penalty
          state.score = Math.max(0, state.score - 500);
          createParticles(item.x, item.y, '#ef4444', 20);
          playSound('explosion');
          flashBoardRed();
        }
      }

      document.getElementById('hud-score').textContent = state.score.toLocaleString();
      items.splice(i, 1);
      continue;
    }

    // Remove offscreen items
    if (item.y > canvas.height + item.size) {
      items.splice(i, 1);
    }
  }

  // Update & Draw Particles
  for (let i = particles.length - 1; i >= 0; i--) {
    let p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life -= p.decay;

    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }

    ctx.save();
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Loop request
  animationFrameId = requestAnimationFrame(gameLoop);
}

// Flash game board red on bomb collision
function flashBoardRed() {
  const container = document.querySelector('.game-board-container');
  container.style.boxShadow = 'inset 0 10px 30px rgba(0,0,0,0.15), 0 0 20px rgba(239, 68, 68, 0.8)';
  container.style.borderColor = '#ef4444';
  
  setTimeout(() => {
    container.style.boxShadow = 'inset 0 10px 30px rgba(0,0,0,0.3), 0 10px 25px rgba(0,0,0,0.4)';
    container.style.borderColor = 'rgba(251, 204, 39, 0.15)';
  }, 200);
}

// End game run
function endGame() {
  state.playing = false;
  cancelAnimationFrame(animationFrameId);
  clearInterval(gameTimerInterval);

  // Determine rewards
  const pointsEarned = Math.round(state.score / 10);
  state.points += pointsEarned;
  state.gamesPlayed++;

  // Check tournament score submit
  if (state.selectedTourney) {
    if (state.score > state.selectedTourney.highScore) {
      state.selectedTourney.highScore = state.score;
      // Winnings logic simulation
      const winnings = state.selectedTourney.pot * 0.1;
      state.cash += winnings;
      alert(`🏆 New Tournament Leader! You claimed temporary rank #1 and won $${winnings.toFixed(2)} USDm!`);
    } else {
      alert(`Score submitted successfully to ${state.selectedTourney.title}! Your Score: ${state.score.toLocaleString()}. Leader: ${state.selectedTourney.highScore.toLocaleString()}.`);
    }
    state.selectedTourney = null;
  }

  // Check High Score
  const isNewHighScore = state.score > state.bestScore;
  if (isNewHighScore) {
    state.bestScore = state.score;
    document.getElementById('high-score-row').style.display = 'flex';
    playSound('victory');
  } else {
    document.getElementById('high-score-row').style.display = 'none';
    playSound('gameover');
  }

  // Populate gameover overlay
  document.getElementById('final-score').textContent = state.score.toLocaleString();
  document.getElementById('earned-points').textContent = `+${pointsEarned.toLocaleString()}`;
  document.getElementById('game-over-overlay').classList.remove('hidden');

  saveToLocalStorage();
  updateDOM();
}

// --- TASKS TAB LOGIC ---
function registerTasksEvents() {
  document.querySelectorAll('.verify-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const taskId = btn.getAttribute('data-type') || btn.getAttribute('data-task');
      if (state.tasks[taskId]) return;

      playSound('click');
      btn.textContent = 'Checking...';
      btn.classList.add('loading');
      btn.disabled = true;

      // Simulate a small loading verify step
      setTimeout(() => {
        state.tasks[taskId] = true;
        
        let reward = 10;
        if (taskId === 'tg') reward = 1;
        if (taskId === 'buy') reward = 100; // 100 $CELO reward
        state.points += reward;

        btn.classList.remove('loading');
        btn.classList.add('verified');
        btn.textContent = 'Verified';

        saveToLocalStorage();
        updateDOM();
      }, 1500);
    });
  });
}

// --- TOURNEYS TAB LOGIC ---
function renderTournaments() {
  const container = document.getElementById('filtered-tourneys-list');
  if (!container) return;

  // Let's check active filter pill
  const activePill = document.querySelector('.filter-pill.active');
  const filterType = activePill ? activePill.getAttribute('data-filter') : 'upcoming';

  container.innerHTML = '';

  let list = [];
  if (filterType === 'upcoming') {
    list = state.tournaments.filter(t => t.entry > 0);
  } else if (filterType === 'live') {
    list = state.tournaments;
  } else if (filterType === 'mine') {
    // Mock user created tournaments
    list = state.tournaments.filter(t => t.id.startsWith('user-'));
  } else {
    list = [];
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No tournaments scheduled in this category. Create one — it goes live at least 2h after creation.</p>
        <span class="help-circle">?</span>
      </div>
    `;
    return;
  }

  list.forEach(t => {
    const item = document.createElement('div');
    item.className = 'tourney-row-item';
    item.innerHTML = `
      <div class="tourney-row-info">
        <div class="tourney-avatar" style="background-color: rgba(255,255,255,0.06);">${t.emoji || '🔥'}</div>
        <div>
          <div class="tourney-row-title">${t.title}</div>
          <div class="tourney-row-stats">${t.tag} • Pot: $${t.pot.toFixed(2)} USDm</div>
        </div>
      </div>
      <div class="tourney-row-right">
        <button class="tourney-row-join-btn" data-id="${t.id}">Join • $${t.entry.toFixed(2)}</button>
      </div>
    `;
    container.appendChild(item);
  });

  // Attach button triggers
  container.querySelectorAll('.tourney-row-join-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const tourney = state.tournaments.find(x => x.id === id);
      if (tourney) {
        openPlayTourneyModal(tourney);
      }
    });
  });
}

function openPlayTourneyModal(tourney) {
  playSound('click');
  document.getElementById('play-tourney-title').textContent = `Join ${tourney.title}`;
  document.getElementById('play-tourney-fee').textContent = `$${tourney.entry.toFixed(2)} USDm`;
  document.getElementById('play-tourney-prize').textContent = `$${tourney.pot.toFixed(2)} USDm`;
  document.getElementById('play-tourney-highscore').textContent = tourney.highScore.toLocaleString();
  
  // Save reference
  state.selectedTourney = tourney;

  document.getElementById('play-tourney-modal').classList.remove('hidden');
}

// --- STORE LOGIC ---
function setupStoreEvents() {
  // Quantities minus/plus
  document.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      playSound('click');
      const target = btn.getAttribute('data-target');
      const span = document.getElementById(`qty-${target}`);
      let val = parseInt(span.textContent);

      if (btn.classList.contains('qty-minus')) {
        val = Math.max(1, val - 1);
      } else {
        val = Math.min(99, val + 1);
      }
      span.textContent = val;
    });
  });

  // Topup buy clicks
  document.getElementById('btn-buy-multiplier').addEventListener('click', () => {
    const qty = parseInt(document.getElementById('qty-multiplier').textContent);
    const totalCost = qty * 0.04;
    if (state.cash >= totalCost) {
      state.cash -= totalCost;
      state.points += qty * 5; // Award points multiplier charges in $CELO
      playSound('collect-green');
      alert(`Purchased ${qty} Score Multipliers!`);
      saveToLocalStorage();
      updateDOM();
    } else {
      alert("Insufficient funds! Buy more $CELO.");
    }
  });

  document.getElementById('btn-buy-renewal').addEventListener('click', () => {
    const qty = parseInt(document.getElementById('qty-renewal').textContent);
    const totalCost = qty * 0.10;
    if (state.cash >= totalCost) {
      state.cash -= totalCost;
      state.points += qty * 15;
      playSound('collect-green');
      alert(`Daily Renewal activated! Playtime renewed.`);
      saveToLocalStorage();
      updateDOM();
    } else {
      alert("Insufficient funds!");
    }
  });

  // Buy All Powerups ($0.2)
  document.getElementById('btn-buy-all-powerups').addEventListener('click', () => {
    if (state.cash >= 0.20) {
      state.cash -= 0.20;
      state.powerups.magnet += 1;
      state.powerups.shield += 1;
      state.powerups.clock += 1;
      playSound('collect-green');
      alert("Success! Purchased Magnet, Shield, and Clock powerups.");
      saveToLocalStorage();
      updateDOM();
    } else {
      alert("Insufficient funds!");
    }
  });

  // Buy spawners
  document.querySelectorAll('.buy-spawner-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const spawner = btn.getAttribute('data-spawner');
      if (state.cash >= 0.05) {
        state.cash -= 0.05;
        state.character = spawner;
        playSound('victory');
        alert(`Theme successfully unlocked! Avatar changed to ${spawner}.`);
        saveToLocalStorage();
        updateDOM();
      } else {
        alert("Insufficient funds!");
      }
    });
  });
}

// --- SETUP ROUTING & EVENT LISTENERS ---
function initApp() {
  loadFromLocalStorage();
  updateDOM();
  setupControls();
  setupStoreEvents();
  registerTasksEvents();

  // Bottom Navigation tabs
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      playSound('click');
      const tabId = item.getAttribute('data-tab');

      // Clear active classes
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));

      // Make active
      item.classList.add('active');
      const screen = document.getElementById(`screen-${tabId}`);
      if (screen) screen.classList.add('active');

      if (tabId === 'tourneys') {
        renderTournaments();
      }
    });
  });

  // Sound Toggle Listener
  document.getElementById('sound-toggle').addEventListener('click', () => {
    state.soundEnabled = !state.soundEnabled;
    const onIcon = document.getElementById('sound-on-icon');
    const offIcon = document.getElementById('sound-off-icon');

    if (state.soundEnabled) {
      onIcon.style.display = 'block';
      offIcon.style.display = 'none';
      playSound('click');
    } else {
      onIcon.style.display = 'none';
      offIcon.style.display = 'block';
    }
  });

  // Difficulty Selector
  document.getElementById('difficulty-select').addEventListener('change', (e) => {
    state.difficulty = e.target.value;
    playSound('click');
  });

  // Start Buttons
  document.getElementById('btn-start-game').addEventListener('click', startGame);
  document.getElementById('btn-restart-game').addEventListener('click', () => {
    playSound('click');
    document.getElementById('game-over-overlay').classList.add('hidden');
    document.getElementById('game-start-overlay').classList.remove('hidden');
  });

  // Powerup activations (Select before running game)
  document.querySelectorAll('.powerup-slot').forEach(slot => {
    slot.addEventListener('click', () => {
      const type = slot.getAttribute('data-type');
      if ((state.powerups[type] || 0) > 0) {
        state.activePowerups[type] = !state.activePowerups[type];
        
        // Consume power-up when toggled active
        if (state.activePowerups[type]) {
          state.powerups[type]--;
        } else {
          state.powerups[type]++;
        }
        
        playSound('click');
        updatePowerupUI(type);
        saveToLocalStorage();
      } else {
        playSound('click');
        alert(`You don't own any ${type.toUpperCase()} powerups! Buy some in the Store.`);
      }
    });
  });

  // Redirect from Game Tab -> Store Tab
  document.getElementById('btn-get-powerups').addEventListener('click', () => {
    playSound('click');
    document.querySelector('.nav-item[data-tab="store"]').click();
  });

  // Create Tournament Dialog Modals
  const createModal = document.getElementById('create-tourney-modal');
  document.getElementById('btn-create-tourney-modal').addEventListener('click', () => {
    playSound('click');
    createModal.classList.remove('hidden');
  });

  document.getElementById('btn-close-tourney-modal').addEventListener('click', () => {
    playSound('click');
    createModal.classList.add('hidden');
  });

  // Create Tournament Submission
  document.getElementById('btn-submit-tourney').addEventListener('click', () => {
    const name = document.getElementById('tourney-name').value || 'New Tourney';
    const entry = parseFloat(document.getElementById('tourney-entry').value) || 0.50;
    const pool = parseFloat(document.getElementById('tourney-pool').value) || 20;
    const duration = document.getElementById('tourney-duration').value;

    const newTourney = {
      id: `user-${Date.now()}`,
      title: name,
      tag: `${duration} Hour Tournament`,
      entry: entry,
      pot: pool,
      ends: `${duration}h 00m`,
      emoji: '🏆',
      avatarClass: 'bg-avatar-red',
      highScore: 0
    };

    state.tournaments.push(newTourney);
    playSound('victory');
    createModal.classList.add('hidden');
    
    // Reset form
    document.getElementById('tourney-name').value = '';

    saveToLocalStorage();
    renderTournaments();
  });

  // Play Tournament Match Trigger
  const playModal = document.getElementById('play-tourney-modal');
  document.getElementById('btn-close-play-modal').addEventListener('click', () => {
    playSound('click');
    playModal.classList.add('hidden');
    state.selectedTourney = null;
  });

  document.getElementById('btn-confirm-play-tourney').addEventListener('click', () => {
    if (!state.selectedTourney) return;

    if (state.cash >= state.selectedTourney.entry) {
      state.cash -= state.selectedTourney.entry;
      playSound('click');
      playModal.classList.add('hidden');

      // Go to Game tab and trigger play immediately
      document.querySelector('.nav-item[data-tab="game"]').click();
      startGame();
    } else {
      alert("Insufficient USDm cash balance! Add funds or top up.");
    }
  });

  // Me tab Profile Finding tourneys redirect
  document.getElementById('btn-profile-find-tourney').addEventListener('click', () => {
    playSound('click');
    document.querySelector('.nav-item[data-tab="tourneys"]').click();
  });
  // Buy CELO Action (Swaps USDm -> $CELO at mock exchange rate)
  document.querySelectorAll('.buy-celo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      playSound('click');
      const amt = prompt("Enter amount of USDm to exchange for $CELO (e.g. 5.00):", "5.00");
      if (amt && !isNaN(amt)) {
        const val = parseFloat(amt);
        if (state.cash >= val) {
          state.cash -= val;
          const celoRate = 1.6; // ~ $0.62 per CELO rate
          const celoAmount = Math.round(val * celoRate);
          state.points += celoAmount;
          playSound('victory');
          alert(`Successfully swapped $${val.toFixed(2)} USDm for ${celoAmount} $CELO!`);
          saveToLocalStorage();
          updateDOM();
        } else {
          alert("Insufficient USDm balance!");
        }
      }
    });
  });  // Tourney list Filter click listeners
  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      playSound('click');
      document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      renderTournaments();
    });
  });

  // Horizontal Card clicks
  document.querySelectorAll('.join-tourney-arrow-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const tourney = state.tournaments.find(t => t.id === id);
      if (tourney) {
        openPlayTourneyModal(tourney);
      }
    });
  });
}

// Initializer trigger on page load
window.addEventListener('DOMContentLoaded', initApp);
