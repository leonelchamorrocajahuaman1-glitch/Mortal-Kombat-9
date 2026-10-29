// Arena: simulación del combate (juego de lucha original, 1 contra 1).
//
// Determinista y solo con enteros: con las mismas entradas, los dos navegadores calculan
// exactamente el mismo estado. Es la base del netcode con rollback (netcode.js).
// No depende del DOM, así que también se ejecuta en Node para las pruebas.

// Bits de entrada (absolutos: izquierda/derecha de la pantalla, no adelante/atrás).
export const IN = Object.freeze({ L: 1, R: 2, U: 4, D: 8, P: 16, K: 32, B: 64, S: 128 });

export const STAGE = Object.freeze({ W: 960, H: 540, FLOOR: 470, LEFT: 50, RIGHT: 910 });
export const FPS = 60;
export const MAX_HP = 1000;
export const ROUND_FRAMES = 60 * FPS;
export const ROUNDS_TO_WIN = 2;
const INTRO_FRAMES = 90;
const ROUND_END_FRAMES = 150;
const GRAVITY = 1;
const JUMP_VY = -19;
const WALK = 4;
const WALK_BACK = 3;
const MIN_GAP = 56;
const HITSTOP = 5;
const DOWN_FRAMES = 50;
const SPECIAL_COOLDOWN = 90;

// s: arranque, a: activo, r: recuperación (fotogramas). Cajas relativas a los pies y la dirección.
export const MOVES = Object.freeze({
  jab: { s: 4, a: 3, r: 8, dmg: 40, x0: 20, x1: 88, y0: -145, y1: -100, hs: 14, bs: 8, push: 6, h: 'high' },
  kick: { s: 8, a: 4, r: 14, dmg: 70, x0: 30, x1: 112, y0: -110, y1: -60, hs: 20, bs: 10, push: 12, h: 'mid' },
  sweep: { s: 6, a: 3, r: 16, dmg: 50, x0: 30, x1: 108, y0: -30, y1: 0, hs: 16, bs: 9, push: 8, h: 'low', kd: 1 },
  upper: { s: 6, a: 4, r: 22, dmg: 90, x0: 15, x1: 78, y0: -160, y1: -60, hs: 30, bs: 12, push: 4, h: 'mid', launch: 1 },
  airk: { s: 4, a: 14, r: 0, dmg: 60, x0: 10, x1: 92, y0: -95, y1: -10, hs: 16, bs: 8, push: 6, h: 'over' },
  shoot: { s: 12, a: 1, r: 22, dmg: 60, proj: 1 },
});

export const PROJECTILE = Object.freeze({ VX: 9, Y0: -128, Y1: -100, W: 24, DMG: 60, CHIP: 10, HS: 16, BS: 10 });

function newPlayer(i) {
  return {
    x: i === 0 ? 300 : 660,
    y: STAGE.FLOOR,
    vx: 0,
    vy: 0,
    face: i === 0 ? 1 : -1,
    hp: MAX_HP,
    st: 'stand', // stand | crouch | air | attack | hit | block | down | ko | win
    t: 0,
    mv: '',
    hit: 0, // el ataque actual ya conectó
    blk: 0, // está bloqueando (1 de pie, 2 agachado)
    fall: 0, // al tocar el suelo cae derribado
    prev: 0,
    cd: 0,
    combo: 0,
  };
}

export function initialState() {
  return {
    f: 0,
    phase: 'intro', // intro | fight | roundEnd | matchEnd
    pt: 0,
    round: 1,
    wins: [0, 0],
    timer: ROUND_FRAMES,
    winner: -1, // ganador del asalto: 0, 1 o 2 (empate)
    hitstop: 0,
    p: [newPlayer(0), newPlayer(1)],
    proj: [null, null],
    fx: [], // efectos para el dibujo: { k: 'hit'|'block', x, y, f }
  };
}

const grounded = (p) => p.y >= STAGE.FLOOR;

function hurtbox(p) {
  if (p.st === 'down' || p.st === 'ko') return null;
  const crouching = p.st === 'crouch' || p.blk === 2 || (p.st === 'attack' && p.mv === 'sweep');
  return { x0: p.x - 30, x1: p.x + 30, y0: p.y + (crouching ? -90 : -160), y1: p.y };
}

function attackBox(p, m) {
  const a = p.face === 1 ? p.x + m.x0 : p.x - m.x1;
  const b = p.face === 1 ? p.x + m.x1 : p.x - m.x0;
  return { x0: a, x1: b, y0: p.y + m.y0, y1: p.y + m.y1 };
}

const overlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

function canBlock(def, height) {
  if (!def.blk) return false;
  if (def.blk === 1) return height !== 'low';
  return height === 'mid' || height === 'low';
}

function addFx(s, k, x, y) {
  s.fx.push({ k, x, y, f: s.f });
  if (s.fx.length > 6) s.fx.shift();
}

function startMove(p, mv) {
  p.st = 'attack';
  p.mv = mv;
  p.t = 0;
  p.hit = 0;
  p.blk = 0;
  if (mv !== 'airk') p.vx = 0;
}

// Aplica un golpe de `att` (o de un proyectil) a `def`.
function applyHit(s, att, def, m, dir) {
  const box = hurtbox(def);
  // Sin atacante (proyectil), el impacto se dibuja en el lado del defensor que recibe el golpe.
  const hx = att ? (def.x + att.x) >> 1 : def.x - dir * 24;
  const hy = box ? box.y0 + 40 : def.y - 100;
  if (canBlock(def, m.h)) {
    def.st = 'block';
    def.t = 0;
    def.mv = String(m.bs);
    def.hp -= m.chip ?? 0;
    pushApart(att, def, dir, m.push >> 1);
    addFx(s, 'block', hx, hy);
  } else {
    const scale = Math.max(40, 100 - 15 * def.combo);
    def.hp -= Math.trunc((m.dmg * scale) / 100);
    def.combo += 1;
    def.blk = 0;
    def.st = 'hit';
    def.t = 0;
    def.mv = String(m.hs);
    if (m.launch) {
      def.vy = -12;
      def.vx = dir * 3;
      def.fall = 1;
    } else if (!grounded(def)) {
      def.fall = 1;
      def.vx = dir * 3;
    } else if (m.kd) {
      def.st = 'down';
      def.t = 0;
    }
    pushApart(att, def, dir, m.push);
    addFx(s, 'hit', hx, hy);
  }
  s.hitstop = HITSTOP;
  if (def.hp <= 0) {
    def.hp = 0;
    def.st = grounded(def) ? 'ko' : 'hit';
    def.fall = 1;
  }
}

// Empuja al defensor; si está contra la pared, retrocede el atacante.
function pushApart(att, def, dir, amount) {
  if (!amount) return;
  const nx = def.x + dir * amount;
  if (nx < STAGE.LEFT || nx > STAGE.RIGHT) {
    if (att) att.x -= dir * amount;
  } else {
    def.x = nx;
  }
}

function controlPlayer(p, input) {
  const pressed = input & ~p.prev;
  const dir = (input & IN.R ? 1 : 0) - (input & IN.L ? 1 : 0);
  const air = !grounded(p);

  if (air) {
    if (pressed & (IN.K | IN.P)) startMove(p, 'airk');
    return;
  }
  // Ataques al pulsar (no al mantener).
  if (pressed & IN.S && p.cd === 0) {
    startMove(p, 'shoot');
    return;
  }
  if (pressed & IN.P) {
    startMove(p, input & IN.D ? 'upper' : 'jab');
    return;
  }
  if (pressed & IN.K) {
    startMove(p, input & IN.D ? 'sweep' : 'kick');
    return;
  }
  if (input & IN.U) {
    p.st = 'air';
    p.vy = JUMP_VY;
    p.vx = dir * 5;
    p.blk = 0;
    return;
  }
  if (input & IN.B) {
    p.blk = input & IN.D ? 2 : 1;
    p.st = input & IN.D ? 'crouch' : 'stand';
    p.vx = 0;
    return;
  }
  p.blk = 0;
  if (input & IN.D) {
    p.st = 'crouch';
    p.vx = 0;
    return;
  }
  p.st = 'stand';
  p.vx = dir === p.face ? dir * WALK : dir * WALK_BACK;
}

function updatePlayer(s, i, input) {
  const p = s.p[i];
  const o = s.p[1 - i];
  if (p.cd > 0) p.cd -= 1;
  p.t += 1;

  const canAct = s.phase === 'fight' && o.st !== 'ko';
  switch (p.st) {
    case 'stand':
    case 'crouch':
      if (canAct) controlPlayer(p, input);
      else {
        p.vx = 0;
        p.blk = 0;
      }
      break;
    case 'air':
      if (canAct) controlPlayer(p, input);
      break;
    case 'attack': {
      const m = MOVES[p.mv];
      if (p.mv === 'shoot' && p.t === m.s && !s.proj[i]) {
        s.proj[i] = { x: p.x + p.face * 60, vx: p.face * PROJECTILE.VX, y: p.y };
        p.cd = SPECIAL_COOLDOWN;
      }
      if (!m.proj && !p.hit && p.t >= m.s && p.t < m.s + m.a) {
        const hb = hurtbox(o);
        if (hb && overlap(attackBox(p, m), hb)) {
          p.hit = 1;
          applyHit(s, p, o, m, p.face);
        }
      }
      if (p.mv === 'airk') {
        if (grounded(p) && p.t > 1) p.st = 'stand';
      } else if (p.t >= m.s + m.a + m.r) {
        p.st = 'stand';
        p.mv = '';
      }
      break;
    }
    case 'hit':
      if (grounded(p) && !p.fall && p.t >= Number(p.mv)) p.st = 'stand';
      break;
    case 'block':
      if (p.t >= Number(p.mv)) p.st = p.blk === 2 ? 'crouch' : 'stand';
      break;
    case 'down':
      p.vx = 0;
      if (p.t >= DOWN_FRAMES && p.hp > 0) {
        p.st = 'stand';
        p.combo = 0;
      }
      break;
    case 'ko':
    case 'win':
      p.vx = 0;
      break;
  }
  if (p.st === 'stand' || p.st === 'crouch') p.combo = 0;
  p.prev = input;
}

function physics(p) {
  if (!grounded(p) || p.vy < 0) {
    p.vy += GRAVITY;
    p.y += p.vy;
    if (p.y >= STAGE.FLOOR) {
      p.y = STAGE.FLOOR;
      p.vy = 0;
      if (p.fall) {
        p.fall = 0;
        p.st = p.hp <= 0 ? 'ko' : 'down';
        p.t = 0;
      } else if (p.st === 'air') {
        p.st = 'stand';
      }
      p.vx = 0;
    }
  }
  p.x += p.vx;
  if (p.st === 'hit' && grounded(p)) p.vx = 0;
  p.x = Math.max(STAGE.LEFT, Math.min(STAGE.RIGHT, p.x));
}

function separate(a, b) {
  const dx = b.x - a.x;
  const vertical = Math.abs(a.y - b.y) < 120;
  if (!vertical || Math.abs(dx) >= MIN_GAP) return;
  const need = MIN_GAP - Math.abs(dx);
  const sign = dx === 0 ? (a.face === 1 ? 1 : -1) : Math.sign(dx);
  const half = need >> 1;
  a.x -= sign * half;
  b.x += sign * (need - half);
  for (const p of [a, b]) p.x = Math.max(STAGE.LEFT, Math.min(STAGE.RIGHT, p.x));
}

function updateProjectiles(s) {
  for (let i = 0; i < 2; i += 1) {
    const pr = s.proj[i];
    if (!pr) continue;
    pr.x += pr.vx;
    if (pr.x < STAGE.LEFT - 40 || pr.x > STAGE.RIGHT + 40) {
      s.proj[i] = null;
      continue;
    }
    const other = s.proj[1 - i];
    if (other && Math.abs(other.x - pr.x) < PROJECTILE.W * 2) {
      addFx(s, 'block', (other.x + pr.x) >> 1, pr.y + PROJECTILE.Y0 + 14);
      s.proj[0] = null;
      s.proj[1] = null;
      return;
    }
    const def = s.p[1 - i];
    const hb = hurtbox(def);
    const box = { x0: pr.x - PROJECTILE.W, x1: pr.x + PROJECTILE.W, y0: pr.y + PROJECTILE.Y0, y1: pr.y + PROJECTILE.Y1 };
    if (hb && overlap(box, hb)) {
      const m = { dmg: PROJECTILE.DMG, chip: PROJECTILE.CHIP, hs: PROJECTILE.HS, bs: PROJECTILE.BS, push: 10, h: 'high' };
      applyHit(s, null, def, m, Math.sign(pr.vx));
      s.proj[i] = null;
    }
  }
}

function faceEachOther(s) {
  const [a, b] = s.p;
  for (const [p, o] of [[a, b], [b, a]]) {
    if (grounded(p) && (p.st === 'stand' || p.st === 'crouch') && o.x !== p.x) p.face = o.x > p.x ? 1 : -1;
  }
}

function resetRound(s) {
  const wins = s.wins;
  const round = s.round + 1;
  const fresh = initialState();
  Object.assign(s, fresh, { f: s.f, wins, round, fx: [] });
}

// Avanza un fotograma. `in0`/`in1`: entradas de los jugadores 0 (izquierda) y 1.
export function step(s, in0, in1) {
  s.f += 1;
  s.pt += 1;
  const inputs = [in0 | 0, in1 | 0];

  if (s.phase === 'matchEnd') return s;
  if (s.phase === 'intro' && s.pt >= INTRO_FRAMES) {
    s.phase = 'fight';
    s.pt = 0;
  }
  if (s.hitstop > 0) {
    s.hitstop -= 1;
    for (let i = 0; i < 2; i += 1) s.p[i].prev = inputs[i];
    return s;
  }

  updatePlayer(s, 0, inputs[0]);
  updatePlayer(s, 1, inputs[1]);
  physics(s.p[0]);
  physics(s.p[1]);
  separate(s.p[0], s.p[1]);
  updateProjectiles(s);
  faceEachOther(s);

  if (s.phase === 'fight') {
    s.timer -= 1;
    const ko0 = s.p[0].hp <= 0;
    const ko1 = s.p[1].hp <= 0;
    if (ko0 || ko1 || s.timer <= 0) {
      if (ko0 && ko1) s.winner = 2;
      else if (ko0) s.winner = 1;
      else if (ko1) s.winner = 0;
      else s.winner = s.p[0].hp === s.p[1].hp ? 2 : s.p[0].hp > s.p[1].hp ? 0 : 1;
      if (s.winner < 2) s.wins[s.winner] += 1;
      s.phase = 'roundEnd';
      s.pt = 0;
    }
  } else if (s.phase === 'roundEnd') {
    const w = s.winner;
    if (w < 2 && grounded(s.p[w]) && (s.p[w].st === 'stand' || s.p[w].st === 'crouch')) {
      s.p[w].st = 'win';
      s.p[w].t = 0;
    }
    if (s.pt >= ROUND_END_FRAMES) {
      if (s.wins[0] >= ROUNDS_TO_WIN || s.wins[1] >= ROUNDS_TO_WIN) {
        s.phase = 'matchEnd';
        s.pt = 0;
      } else {
        resetRound(s);
      }
    }
  }
  return s;
}

// Copia del estado (solo datos simples) para guardar instantáneas.
export function cloneState(s) {
  return {
    ...s,
    wins: [...s.wins],
    p: [{ ...s.p[0] }, { ...s.p[1] }],
    proj: [s.proj[0] && { ...s.proj[0] }, s.proj[1] && { ...s.proj[1] }],
    fx: s.fx.map((e) => ({ ...e })),
  };
}

// Huella del estado (FNV-1a de 32 bits) para detectar desincronizaciones.
export function hashState(s) {
  const text = JSON.stringify(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
