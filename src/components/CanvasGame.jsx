import React, { useRef, useEffect } from 'react';
import { useGameState } from '../context/GameStateContext';
import { playSound } from '../utils/audio';
import { createParticles, updateAndDrawParticles } from '../utils/particles';

export default function CanvasGame({ onGameEnd }) {
  const {
    playing,
    setPlaying,
    score,
    setScore,
    timer,
    setTimer,
    difficulty,
    character,
    soundEnabled,
    activePowerups,
    setActivePowerups
  } = useGameState();

  const canvasRef = useRef(null);
  const itemsRef = useRef([]);
  const particlesRef = useRef([]);
  const frameCountRef = useRef(0);
  const animationFrameRef = useRef(null);
  const timerIntervalRef = useRef(null);

  // Player position state reference
  const playerRef = useRef({
    x: 175,
    y: 420,
    radius: 25,
    targetX: 175,
    targetY: 420,
    avatarLoaded: false,
    avatarImg: new Image()
  });

  // Load avatar image on mount or skin change
  useEffect(() => {
    const player = playerRef.current;
    player.avatarImg.src = '/avatar.png';
    player.avatarImg.onload = () => {
      player.avatarLoaded = true;
    };
  }, []);

  // Spawn falling items
  const spawnItem = (canvasWidth) => {
    const types = ['celo', 'celo', 'celo', 'bomb'];
    if (difficulty.includes('hard')) {
      types.push('bomb', 'bomb');
    } else {
      types.push('green');
    }

    const type = types[Math.floor(Math.random() * types.length)];
    const size = type === 'bomb' ? 18 : 20;

    itemsRef.current.push({
      x: Math.random() * (canvasWidth - size * 2) + size,
      y: -size,
      vy: Math.random() * 2 + (difficulty.includes('hard') ? 3.5 : 2.0),
      type: type,
      size: size,
      angle: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.05
    });
  };

  // Main game loop
  useEffect(() => {
    if (!playing) {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Reset game entities
    itemsRef.current = [];
    particlesRef.current = [];
    frameCountRef.current = 0;

    // Start countdown timer
    timerIntervalRef.current = setInterval(() => {
      setTimer((prev) => {
        if (prev <= 1) {
          clearInterval(timerIntervalRef.current);
          onGameEnd();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    const gameLoop = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Background grid
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

      // Update player coords (smooth lerping)
      const player = playerRef.current;
      player.x += (player.targetX - player.x) * 0.22;
      player.y += (player.targetY - player.y) * 0.22;

      // Draw player avatar (temporary circle placeholder for now)
      ctx.save();
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.restore();

      // Spawn manager
      frameCountRef.current++;
      const baseSpawnRate = 45;
      const adjustedSpawnRate = activePowerups.clock ? baseSpawnRate * 2.2 : baseSpawnRate;
      if (frameCountRef.current % Math.round(adjustedSpawnRate) === 0) {
        spawnItem(canvas.width);
      }

      // Update & Draw Items
      const items = itemsRef.current;
      for (let i = items.length - 1; i >= 0; i--) {
        let item = items[i];
        item.angle += item.rotSpeed;

        const currentVy = activePowerups.clock ? item.vy * 0.45 : item.vy;
        item.y += currentVy;

        // Magnet attraction
        if (activePowerups.magnet && (item.type === 'celo' || item.type === 'green')) {
          const dx = player.x - item.x;
          const dy = player.y - item.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 140) {
            const force = (140 - dist) / 140;
            const pullSpeed = 6.5;
            item.x += (dx / dist) * pullSpeed * force;
            item.y += (dy / dist) * pullSpeed * force;
          }
        }

        // Draw item (placeholder colored circles)
        ctx.save();
        ctx.beginPath();
        ctx.arc(item.x, item.y, item.size, 0, Math.PI * 2);
        ctx.fillStyle = item.type === 'bomb' ? '#ef4444' : item.type === 'green' ? '#35d07f' : '#fbcc27';
        ctx.fill();
        ctx.restore();

        // Clear offscreen items
        if (item.y > canvas.height + item.size) {
          items.splice(i, 1);
        }
      }

      // Update particles
      updateAndDrawParticles(ctx, particlesRef.current);

      animationFrameRef.current = requestAnimationFrame(gameLoop);
    };

    gameLoop();

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [playing, difficulty, activePowerups]);

  const handlePointerMove = (e) => {
    if (!playing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    
    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const x = ((clientX - rect.left) / rect.width) * canvas.width;
    const y = ((clientY - rect.top) / rect.height) * canvas.height;

    const player = playerRef.current;
    player.targetX = Math.max(player.radius, Math.min(canvas.width - player.radius, x));
    player.targetY = Math.max(player.radius + 40, Math.min(canvas.height - player.radius, y));
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleResize = () => {
      canvas.style.width = '100%';
      canvas.style.height = '100%';
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <canvas 
      ref={canvasRef} 
      id="game-canvas" 
      width="350" 
      height="480"
      onMouseMove={handlePointerMove}
      onTouchMove={handlePointerMove}
      style={{ display: 'block', background: '#0b0f19', width: '100%', height: '100%' }}
    />
  );
}
