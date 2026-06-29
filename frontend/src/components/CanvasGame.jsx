import React, { useRef, useEffect } from 'react';
import { useGameState } from '../context/GameStateContext';
import { playSound } from '../utils/audio';
import { createParticles, updateAndDrawParticles } from '../utils/particles';
import avatarUrl from '../assets/avatar.png';

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
    player.avatarImg.src = avatarUrl;
    player.avatarImg.onload = () => {
      player.avatarLoaded = true;
    };
  }, []);

  // Flash board red on bomb hits
  const flashBoardRed = () => {
    const container = document.querySelector('.game-board-container');
    if (!container) return;
    container.style.boxShadow = 'inset 0 10px 30px rgba(0,0,0,0.15), 0 0 20px rgba(239, 68, 68, 0.8)';
    container.style.borderColor = '#ef4444';
    
    setTimeout(() => {
      container.style.boxShadow = 'inset 0 10px 30px rgba(0,0,0,0.3), 0 10px 25px rgba(0,0,0,0.4)';
      container.style.borderColor = 'rgba(255, 255, 255, 0.1)';
    }, 250);
  };

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
          setTimeout(() => {
            onGameEnd();
          }, 0);
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

      // Draw Player Avatar
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 6;

      // Draw Shield Indicator
      if (activePowerups.shield) {
        ctx.beginPath();
        ctx.arc(player.x, player.y, player.radius + 8, 0, Math.PI * 2);
        ctx.strokeStyle = '#fbcc27';
        ctx.lineWidth = 3;
        ctx.shadowColor = '#fbcc27';
        ctx.shadowBlur = 15;
        ctx.stroke();
        ctx.fillStyle = 'rgba(251, 204, 39, 0.08)';
        ctx.fill();
      }

      // Base circular clipping container
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.clip();

      // Draw Avatar image / Theme shapes
      if (character === 'default' && player.avatarLoaded) {
        ctx.drawImage(
          player.avatarImg,
          player.x - player.radius,
          player.y - player.radius,
          player.radius * 2,
          player.radius * 2
        );
      } else if (character === 'valora') {
        ctx.fillStyle = '#35d07f';
        ctx.fillRect(player.x - player.radius, player.y - player.radius, player.radius * 2, player.radius * 2);
        ctx.fillStyle = '#fff';
        ctx.font = '22px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('💚', player.x, player.y + 1);
      } else if (character === 'mento') {
        ctx.fillStyle = '#fbcc27';
        ctx.fillRect(player.x - player.radius, player.y - player.radius, player.radius * 2, player.radius * 2);
        ctx.fillStyle = '#fff';
        ctx.font = '22px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🍀', player.x, player.y + 1);
      } else {
        ctx.fillStyle = '#143d2f';
        ctx.beginPath();
        ctx.arc(player.x, player.y, player.radius - 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('@luckify', player.x, player.y);
      }
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

        // Draw item
        ctx.save();
        ctx.translate(item.x, item.y);
        ctx.rotate(item.angle);

        if (item.type === 'celo') {
          if (character === 'valora') {
            ctx.shadowColor = 'rgba(53, 208, 127, 0.5)';
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(0, 0, item.size, 0, Math.PI * 2);
            ctx.fillStyle = '#35d07f';
            ctx.fill();
            ctx.lineWidth = 2.2;
            ctx.strokeStyle = '#ffffff';
            ctx.stroke();

            ctx.fillStyle = '#ffffff';
            ctx.font = `${item.size * 1.1}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('💚', 0, 1);
          } else if (character === 'mento') {
            ctx.shadowColor = 'rgba(251, 204, 39, 0.5)';
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(0, 0, item.size, 0, Math.PI * 2);
            ctx.fillStyle = '#fbcc27';
            ctx.fill();
            ctx.lineWidth = 2.2;
            ctx.strokeStyle = '#ffffff';
            ctx.stroke();

            ctx.fillStyle = '#ffffff';
            ctx.font = `${item.size * 1.1}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🍀', 0, 1);
          } else {
            ctx.shadowColor = 'rgba(251, 204, 39, 0.5)';
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(0, 0, item.size, 0, Math.PI * 2);
            ctx.fillStyle = '#fbcc27';
            ctx.fill();
            ctx.lineWidth = 2.2;
            ctx.strokeStyle = '#ffffff';
            ctx.stroke();

            ctx.lineWidth = 2.4;
            ctx.beginPath();
            ctx.arc(-item.size * 0.18, 0, item.size * 0.32, 0, Math.PI * 2);
            ctx.strokeStyle = '#fcff52';
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(item.size * 0.18, 0, item.size * 0.32, 0, Math.PI * 2);
            ctx.strokeStyle = '#06100c';
            ctx.stroke();
          }
        } else if (item.type === 'green') {
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
          ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
          ctx.shadowBlur = 6;

          ctx.beginPath();
          ctx.arc(8, -12, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = '#fbcc27';
          ctx.fill();

          ctx.beginPath();
          ctx.moveTo(0, -10);
          ctx.quadraticCurveTo(6, -8, 8, -12);
          ctx.strokeStyle = '#a1a1aa';
          ctx.lineWidth = 2.5;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(0, 0, item.size, 0, Math.PI * 2);
          ctx.fillStyle = '#06100c';
          ctx.fill();
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();

          const pulseColor = (Math.floor(Date.now() / 150) % 2 === 0) ? '#ef4444' : '#06100c';
          ctx.beginPath();
          ctx.arc(0, 0, item.size * 0.4, 0, Math.PI * 2);
          ctx.fillStyle = pulseColor;
          ctx.fill();
        }
        ctx.restore();

        // Collision Check
        const dx = item.x - player.x;
        const dy = item.y - player.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < player.radius + item.size) {
          if (item.type === 'celo') {
            const addVal = difficulty.includes('hard') ? 200 : 100;
            setScore((prev) => prev + addVal);
            createParticles(particlesRef.current, item.x, item.y, '#fcff52', 10);
            playSound('collect-celo', soundEnabled);
          } else if (item.type === 'green') {
            setScore((prev) => prev + 300);
            createParticles(particlesRef.current, item.x, item.y, '#35d07f', 12);
            playSound('collect-green', soundEnabled);
          } else if (item.type === 'bomb') {
            if (activePowerups.shield) {
              setActivePowerups((prev) => ({ ...prev, shield: false }));
              playSound('shield-break', soundEnabled);
              createParticles(particlesRef.current, item.x, item.y, '#fbcc27', 15);
            } else {
              setScore((prev) => Math.max(0, prev - 500));
              createParticles(particlesRef.current, item.x, item.y, '#ef4444', 20);
              playSound('explosion', soundEnabled);
              flashBoardRed();
            }
          }
          items.splice(i, 1);
          continue;
        }

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
  }, [playing, difficulty, activePowerups, character, soundEnabled]);

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
