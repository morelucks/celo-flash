import React, { useRef, useEffect } from 'react';
import { useGameState } from '../context/GameStateContext';

export default function CanvasGame({ onGameEnd }) {
  const { playing, difficulty, character, soundEnabled } = useGameState();
  const canvasRef = useRef(null);

  // Player position state reference
  const playerRef = useRef({
    x: 175, // canvas.width / 2
    y: 420, // canvas.height - 60
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

  const handlePointerMove = (e) => {
    if (!playing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    
    // Support touch and mouse pointer coordinates
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
