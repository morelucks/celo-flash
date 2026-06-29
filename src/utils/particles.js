// Particle physics engine for Celo Flash retro arcade effects

export function createParticles(particlesArray, x, y, color, count = 8) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 3 + 1;
    particlesArray.push({
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

export function updateAndDrawParticles(ctx, particlesArray) {
  for (let i = particlesArray.length - 1; i >= 0; i--) {
    let p = particlesArray[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life -= p.decay;

    if (p.life <= 0) {
      particlesArray.splice(i, 1);
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
}
