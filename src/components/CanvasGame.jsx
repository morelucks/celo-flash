import React, { useRef, useEffect } from 'react';
import { useGameState } from '../context/GameStateContext';

export default function CanvasGame({ onGameEnd }) {
  const { playing, difficulty, character, soundEnabled } = useGameState();
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleResize = () => {
      const rect = canvas.parentNode.getBoundingClientRect();
      // Keep ratio 350x480
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
      style={{ display: 'block', background: '#0b0f19', width: '100%', height: '100%' }}
    />
  );
}
