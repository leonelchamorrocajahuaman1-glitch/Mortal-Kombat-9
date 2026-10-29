// Dibujo de la Arena en <canvas>. Personajes y escenario originales, dibujados con primitivas.
// El dibujo nunca modifica el estado: puede usar decimales y animaciones libres.

import { MAX_HP, MOVES, PROJECTILE, ROUND_FRAMES, STAGE } from './sim.js';

export const FIGHTERS = [
  {
    name: 'Brasa',
    // Luchador corpulento con armadura de bronce y casco redondo con visera.
    skin: '#c98b5e', armor: '#b5652a', trim: '#f2b25c', cloth: '#3a2416', glow: '#ff8a2a', bulk: 1.15,
  },
  {
    name: 'Escarcha',
    // Esgrimista ágil con abrigo largo azul acero y guanteletes luminosos.
    skin: '#e3c3a6', armor: '#3d6f9c', trim: '#bfe9ff', cloth: '#1b2a3a', glow: '#7fd8ff', bulk: 0.92,
  },
];

function drawStage(ctx, frame) {
  const { W, H, FLOOR } = STAGE;
  const sky = ctx.createLinearGradient(0, 0, 0, FLOOR);
  sky.addColorStop(0, '#0b0d16');
  sky.addColorStop(0.6, '#2a1420');
  sky.addColorStop(1, '#5a2414');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Luna y bruma
  ctx.fillStyle = 'rgba(255, 210, 160, 0.85)';
  ctx.beginPath();
  ctx.arc(760, 110, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 140, 60, 0.08)';
  for (let i = 0; i < 3; i += 1) ctx.fillRect(0, 230 + i * 40 + Math.sin(frame / 90 + i) * 6, W, 24);

  // Ruinas lejanas: columnas y arcos
  ctx.fillStyle = '#1a0f14';
  for (let i = 0; i < 9; i += 1) {
    const x = 40 + i * 110;
    const h = 150 + ((i * 37) % 70);
    ctx.fillRect(x, FLOOR - 60 - h, 26, h);
    ctx.fillRect(x - 8, FLOOR - 60 - h, 42, 10);
  }
  ctx.fillRect(0, FLOOR - 70, W, 12);

  // Suelo de losas
  const floor = ctx.createLinearGradient(0, FLOOR - 60, 0, H);
  floor.addColorStop(0, '#2b1d18');
  floor.addColorStop(1, '#0d0908');
  ctx.fillStyle = floor;
  ctx.fillRect(0, FLOOR - 58, W, H - FLOOR + 58);
  ctx.strokeStyle = 'rgba(217, 179, 107, 0.12)';
  ctx.lineWidth = 1;
  for (let x = -400; x < W + 400; x += 80) {
    ctx.beginPath();
    ctx.moveTo(W / 2 + (x - W / 2) * 0.55, FLOOR - 58);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = FLOOR - 40; y < H; y += 26) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  // Brasas flotando
  for (let i = 0; i < 18; i += 1) {
    const x = (i * 173 + frame * (0.4 + (i % 3) * 0.2)) % W;
    const y = FLOOR - 20 - ((frame * (0.6 + (i % 4) * 0.15) + i * 61) % 380);
    ctx.fillStyle = `rgba(255, ${120 + (i % 5) * 20}, 40, ${0.25 + (i % 3) * 0.15})`;
    ctx.fillRect(x, y, 3, 3);
  }
}

function limb(ctx, x1, y1, x2, y2, w, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

// Pose: ángulos simples según el estado. Coordenadas locales: pies en (0,0), mirando a +x.
function pose(p, frame) {
  const idle = Math.sin(frame / 10) * 2;
  const base = { hipY: -88, lean: 0, armF: [26, -30], armB: [-14, -30], legF: [16, 0], legB: [-14, 0], head: 0, lying: false };
  const m = MOVES[p.mv];
  const active = m && p.t >= m.s && p.t < m.s + m.a;
  switch (p.st) {
    case 'stand':
      if (p.vx !== 0) {
        const w = Math.sin(frame / 4) * 16;
        return { ...base, hipY: -88 + Math.abs(w) / 6, legF: [w, 0], legB: [-w, 0], armF: [20 - w / 2, -40], armB: [-6 + w / 2, -40] };
      }
      return p.blk ? { ...base, hipY: -86 + idle, armF: [22, -78], armB: [16, -70] } : { ...base, hipY: -88 + idle };
    case 'crouch':
      return p.blk ? { ...base, hipY: -52, armF: [26, -48], armB: [20, -42], legF: [30, 0], legB: [-26, 0] } : { ...base, hipY: -52, legF: [30, 0], legB: [-26, 0], armF: [24, -20] };
    case 'air':
      return { ...base, hipY: -96, legF: [24, -28], legB: [-6, -34], armF: [18, -54], armB: [-20, -48] };
    case 'attack':
      if (p.mv === 'jab') return { ...base, armF: active ? [86, -116] : [30, -96], lean: active ? 6 : 2 };
      if (p.mv === 'kick') return { ...base, legF: active ? [104, -78] : [40, -40], lean: active ? -10 : -4, armF: [10, -60] };
      if (p.mv === 'sweep') return { ...base, hipY: -46, legF: active ? [104, -6] : [50, -4], legB: [-24, 0], lean: 14, armF: [14, -18] };
      if (p.mv === 'upper') return { ...base, hipY: active ? -98 : -60, armF: active ? [40, -170] : [26, -40], lean: active ? -6 : 10 };
      if (p.mv === 'airk') return { ...base, hipY: -92, legF: [88, -10], legB: [-10, -34], lean: -8, armB: [-30, -70] };
      if (p.mv === 'shoot') return { ...base, armF: [62, -104], armB: [54, -96], lean: 4 };
      return base;
    case 'hit':
      return { ...base, lean: -18, head: -10, armF: [-6, -50], armB: [-30, -46] };
    case 'block':
      return p.blk === 2
        ? { ...base, hipY: -52, armF: [26, -48], armB: [20, -42], legF: [30, 0], legB: [-26, 0], lean: -4 }
        : { ...base, armF: [22, -80], armB: [16, -72], lean: -4 };
    case 'down':
    case 'ko':
      return { ...base, lying: true };
    case 'win':
      return { ...base, armF: [14, -170], armB: [-20, -40], hipY: -90 };
    default:
      return base;
  }
}

function drawFighter(ctx, p, idx, frame, flash) {
  const look = FIGHTERS[idx];
  const k = look.bulk;
  ctx.save();
  ctx.translate(p.x, p.y);
  // Sombra
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.ellipse(0, STAGE.FLOOR - p.y + 2, 46, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.scale(p.face, 1);

  const q = pose(p, frame);
  if (q.lying) {
    ctx.rotate(-Math.PI / 2 + 0.05);
    ctx.translate(-16, -52);
  }
  const hipY = q.hipY;
  const shY = hipY - 62 * k;
  const lean = q.lean;
  const legW = 15 * k;
  const armW = 12 * k;

  // Piernas (la trasera primero)
  const knee = (fx, fy) => [(fx + 0) / 2 + 6, (hipY + fy) / 2 - 6];
  for (const [leg, shade] of [[q.legB, 0.7], [q.legF, 1]]) {
    const [kx, ky] = knee(leg[0], leg[1]);
    ctx.globalAlpha = shade;
    limb(ctx, 0, hipY, kx, ky, legW, look.cloth);
    limb(ctx, kx, ky, leg[0], leg[1] - 4, legW * 0.9, look.cloth);
    limb(ctx, leg[0] - 4, leg[1] - 4, leg[0] + 12, leg[1] - 2, 9, look.armor); // bota
  }
  ctx.globalAlpha = 1;

  // Brazo trasero
  limb(ctx, lean * 0.5, shY + 6, q.armB[0] * 0.55 + lean, (shY + q.armB[1] + hipY) / 2.6, armW, look.skin);
  limb(ctx, q.armB[0] * 0.55 + lean, (shY + q.armB[1] + hipY) / 2.6, q.armB[0] + lean, hipY + q.armB[1] + 30, armW * 0.9, look.armor);

  // Torso
  ctx.fillStyle = look.armor;
  ctx.beginPath();
  ctx.moveTo(-22 * k + lean * 0.4, hipY);
  ctx.lineTo(22 * k + lean * 0.4, hipY);
  ctx.lineTo(26 * k + lean, shY);
  ctx.lineTo(-24 * k + lean, shY);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = look.trim;
  ctx.lineWidth = 2;
  ctx.stroke();
  if (idx === 1) {
    // Abrigo largo de Escarcha
    ctx.fillStyle = look.cloth;
    ctx.beginPath();
    ctx.moveTo(-24 * k + lean * 0.4, hipY - 4);
    ctx.lineTo(-34 + Math.sin(frame / 8) * 3, hipY + 46);
    ctx.lineTo(-6, hipY + 30);
    ctx.closePath();
    ctx.fill();
  } else {
    // Hombreras de Brasa
    ctx.fillStyle = look.trim;
    ctx.beginPath();
    ctx.arc(-20 * k + lean, shY + 6, 13, Math.PI, 0);
    ctx.arc(22 * k + lean, shY + 6, 13, Math.PI, 0);
    ctx.fill();
  }
  // Cinturón
  ctx.fillStyle = look.trim;
  ctx.fillRect(-22 * k + lean * 0.4, hipY - 8, 44 * k, 7);

  // Cabeza y casco
  const hx = lean + 2;
  const hy = shY - 20 + q.head * 0.3;
  ctx.fillStyle = look.skin;
  ctx.beginPath();
  ctx.arc(hx, hy, 17, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = look.armor;
  ctx.beginPath();
  if (idx === 0) {
    ctx.arc(hx, hy - 2, 19, Math.PI * 0.95, Math.PI * 2.05);
    ctx.fill();
    ctx.fillStyle = look.glow;
    ctx.fillRect(hx + 2, hy - 4, 15, 4); // visera
  } else {
    ctx.arc(hx - 3, hy - 4, 17, Math.PI, Math.PI * 1.9);
    ctx.fill();
    ctx.strokeStyle = look.trim;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(hx - 16, hy - 6);
    ctx.quadraticCurveTo(hx - 34, hy + 4 + Math.sin(frame / 7) * 4, hx - 30, hy + 22); // coleta
    ctx.stroke();
    ctx.fillStyle = '#10161f';
    ctx.fillRect(hx + 6, hy - 3, 6, 3); // ojo
  }

  // Brazo delantero con guantelete luminoso
  const ex = q.armF[0] * 0.5 + lean;
  const ey = (shY + hipY + q.armF[1]) / 2.4;
  const fx = q.armF[0] + lean;
  const fy = hipY + q.armF[1] + 30;
  limb(ctx, lean, shY + 6, ex, ey, armW, look.skin);
  limb(ctx, ex, ey, fx, fy, armW * 0.95, look.armor);
  ctx.fillStyle = look.glow;
  ctx.beginPath();
  ctx.arc(fx, fy, 8 * k, 0, Math.PI * 2);
  ctx.fill();

  if (flash) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(-40, hipY - 120, 80, 130);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
}

function drawProjectile(ctx, pr, idx, frame) {
  const look = FIGHTERS[idx];
  const y = pr.y + (PROJECTILE.Y0 + PROJECTILE.Y1) / 2;
  const g = ctx.createRadialGradient(pr.x, y, 2, pr.x, y, 26);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, look.glow);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(pr.x, y, 26 + Math.sin(frame / 2) * 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = look.glow;
  ctx.globalAlpha = 0.5;
  ctx.fillRect(pr.x - Math.sign(pr.vx) * 60, y - 4, Math.sign(pr.vx) * 40, 8);
  ctx.globalAlpha = 1;
}

function drawFx(ctx, s) {
  for (const e of s.fx) {
    const age = s.f - e.f;
    if (age > 14) continue;
    const r = 10 + age * 3;
    ctx.strokeStyle = e.k === 'hit' ? `rgba(255, 220, 120, ${1 - age / 14})` : `rgba(160, 220, 255, ${1 - age / 14})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      ctx.moveTo(e.x + Math.cos(a) * r * 0.4, e.y + Math.sin(a) * r * 0.4);
      ctx.lineTo(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r);
    }
    ctx.stroke();
  }
}

function drawHud(ctx, s, meta) {
  const { W } = STAGE;
  const barW = 360;
  for (let i = 0; i < 2; i += 1) {
    const x = i === 0 ? 30 : W - 30 - barW;
    const frac = Math.max(0, s.p[i].hp) / MAX_HP;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - 3, 27, barW + 6, 26);
    ctx.fillStyle = '#5a1010';
    ctx.fillRect(x, 30, barW, 20);
    const g = ctx.createLinearGradient(0, 30, 0, 50);
    g.addColorStop(0, '#ffe08a');
    g.addColorStop(1, '#e09a1a');
    ctx.fillStyle = g;
    const w = barW * frac;
    ctx.fillRect(i === 0 ? x + barW - w : x, 30, w, 20);
    ctx.strokeStyle = '#d9b36b';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 3, 27, barW + 6, 26);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px Bahnschrift, Arial Narrow, sans-serif';
    ctx.textAlign = i === 0 ? 'left' : 'right';
    const you = meta.local === i ? ' (TÚ)' : '';
    ctx.fillText(`${(meta.names?.[i] || FIGHTERS[i].name).toUpperCase()}${you}`, i === 0 ? x : x + barW, 74);
    // Asaltos ganados
    for (let r = 0; r < 2; r += 1) {
      ctx.fillStyle = s.wins[i] > r ? '#ffcc4d' : 'rgba(255,255,255,0.15)';
      const px = i === 0 ? x + barW - 14 - r * 22 : x + 14 + r * 22;
      ctx.beginPath();
      ctx.arc(px, 70, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd27a';
  ctx.font = 'bold 40px Bahnschrift, Arial Narrow, sans-serif';
  ctx.fillText(String(Math.ceil(Math.max(0, s.timer) / 60)), W / 2, 56);
}

function bigText(ctx, text, color, sub) {
  const { W, H } = STAGE;
  ctx.textAlign = 'center';
  ctx.font = 'italic 900 84px Bahnschrift, Arial Narrow, sans-serif';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(text, W / 2, H / 2 - 20);
  ctx.fillStyle = color;
  ctx.fillText(text, W / 2, H / 2 - 20);
  if (sub) {
    ctx.font = 'bold 24px Bahnschrift, Arial Narrow, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(sub, W / 2, H / 2 + 24);
  }
}

export function render(ctx, s, meta = {}) {
  drawStage(ctx, s.f);
  for (let i = 0; i < 2; i += 1) if (s.proj[i]) drawProjectile(ctx, s.proj[i], i, s.f);
  const flash = (i) => s.fx.some((e) => e.k === 'hit' && s.f - e.f < 4 && Math.abs(e.x - s.p[i].x) < 70);
  // El que ataca se dibuja delante.
  const order = s.p[1].st === 'attack' ? [0, 1] : [1, 0];
  for (const i of order) drawFighter(ctx, s.p[i], i, s.f, flash(i));
  drawFx(ctx, s);
  drawHud(ctx, s, meta);

  const names = [0, 1].map((i) => (meta.names?.[i] || FIGHTERS[i].name).toUpperCase());
  if (s.phase === 'intro') {
    if (s.pt < 55) bigText(ctx, `ASALTO ${s.round}`, '#ffd27a');
    else bigText(ctx, '¡LUCHA!', '#ff7a2a');
  } else if (s.phase === 'roundEnd' && s.pt < 140) {
    const timeUp = s.timer <= 0;
    if (s.pt < 70) bigText(ctx, timeUp ? 'TIEMPO' : 'K.O.', '#ff4b2a');
    else bigText(ctx, s.winner === 2 ? 'EMPATE' : `GANA ${names[s.winner]}`, '#ffd27a');
  } else if (s.phase === 'matchEnd') {
    const w = s.wins[0] > s.wins[1] ? 0 : 1;
    bigText(ctx, `¡${names[w]} GANA!`, '#ffd27a', meta.local === w ? 'Victoria' : 'Derrota');
  }
  if (meta.banner) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, STAGE.H - 54, STAGE.W, 40);
    ctx.fillStyle = '#ffc542';
    ctx.font = 'bold 20px Bahnschrift, Arial Narrow, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(meta.banner, STAGE.W / 2, STAGE.H - 27);
  }
}

export const ROUND_SECONDS = ROUND_FRAMES / 60;
