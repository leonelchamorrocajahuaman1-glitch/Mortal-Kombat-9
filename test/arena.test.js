// Pruebas de la Arena: simulación determinista, mecánicas de combate y netcode con rollback
// sobre una red simulada con retardo, desorden y pérdida de paquetes.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RollbackSession } from '../public/js/arena/netcode.js';
import { IN, MAX_HP, MOVES, cloneState, hashState, initialState, step } from '../public/js/arena/sim.js';

// Generador pseudoaleatorio determinista (mulberry32).
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Entradas «humanas»: se mantienen varios fotogramas y cambian de vez en cuando.
function script(seed) {
  const r = rng(seed);
  const out = [];
  let cur = 0;
  return (f) => {
    while (out.length <= f) {
      if (r() < 0.12) {
        cur = 0;
        const x = r();
        if (x < 0.35) cur |= r() < 0.5 ? IN.L : IN.R;
        if (r() < 0.15) cur |= IN.U;
        if (r() < 0.2) cur |= IN.D;
        if (r() < 0.25) cur |= IN.P;
        if (r() < 0.25) cur |= IN.K;
        if (r() < 0.2) cur |= IN.B;
        if (r() < 0.06) cur |= IN.S;
      }
      out.push(cur);
    }
    return out[f];
  };
}

function toFight() {
  const s = initialState();
  while (s.phase !== 'fight') step(s, 0, 0);
  return s;
}

test('la simulación es determinista', () => {
  const a = script(1);
  const b = script(2);
  const run = () => {
    const s = initialState();
    for (let f = 0; f < 3000; f += 1) step(s, a(f), b(f));
    return hashState(s);
  };
  assert.equal(run(), run());
});

test('golpes, bloqueo, agacharse y proyectil', () => {
  // Puñetazo a corta distancia: quita vida.
  let s = toFight();
  s.p[0].x = 440;
  s.p[1].x = 510;
  step(s, IN.P, 0);
  for (let i = 0; i < MOVES.jab.s + MOVES.jab.a; i += 1) step(s, IN.P, 0);
  assert.equal(s.p[1].hp, MAX_HP - MOVES.jab.dmg);

  // Bloqueando de pie: sin daño.
  s = toFight();
  s.p[0].x = 440;
  s.p[1].x = 510;
  step(s, 0, IN.B);
  step(s, IN.K, IN.B);
  for (let i = 0; i < 20; i += 1) step(s, 0, IN.B);
  assert.equal(s.p[1].hp, MAX_HP);

  // Agachado: el puñetazo alto no alcanza.
  s = toFight();
  s.p[0].x = 440;
  s.p[1].x = 510;
  step(s, 0, IN.D);
  step(s, IN.P, IN.D);
  for (let i = 0; i < 20; i += 1) step(s, 0, IN.D);
  assert.equal(s.p[1].hp, MAX_HP);

  // Barrido contra alguien de pie: derribo.
  s = toFight();
  s.p[0].x = 440;
  s.p[1].x = 520;
  step(s, IN.D, 0);
  step(s, IN.D | IN.K, 0);
  for (let i = 0; i < 12; i += 1) step(s, IN.D, 0);
  assert.equal(s.p[1].st, 'down');

  // Proyectil desde lejos.
  s = toFight();
  step(s, IN.S, 0);
  for (let i = 0; i < 80; i += 1) step(s, 0, 0);
  assert.equal(s.p[1].hp, MAX_HP - 60);
});

test('KO, asaltos y fin del combate al mejor de 3', () => {
  const s = toFight();
  let f = 0;
  while (s.phase !== 'matchEnd' && f < 20000) {
    // El jugador 0 persigue y patea; el 1 no hace nada.
    const close = Math.abs(s.p[1].x - s.p[0].x) < 100;
    const in0 = close ? (f % 24 === 0 ? IN.K : 0) : s.p[1].x > s.p[0].x ? IN.R : IN.L;
    step(s, in0, 0);
    f += 1;
  }
  assert.equal(s.phase, 'matchEnd');
  assert.deepEqual(s.wins, [2, 0]);
  assert.equal(s.round, 2);
});

// Red simulada: retardo variable (desorden) y pérdida de paquetes.
function runNetworked({ frames, latency, jitter, loss, startOffset, seed }) {
  const r = rng(seed);
  const inA = script(seed + 11);
  const inB = script(seed + 23);
  const desyncs = [];
  const opts = (local) => ({
    local,
    initial: initialState(),
    step,
    clone: cloneState,
    hash: hashState,
    delay: 2,
    maxRollback: 10,
    onDesync: (f) => desyncs.push([local, f]),
  });
  const A = new RollbackSession(opts(0));
  const B = new RollbackSession(opts(1));
  const queue = [];
  const send = (to, msg, now) => {
    if (r() < loss) return;
    queue.push({ to, msg: JSON.parse(JSON.stringify(msg)), at: now + latency + Math.floor(r() * jitter) });
  };
  for (let t = 0; t < frames * 3 && (A.frame < frames || B.frame < frames); t += 1) {
    for (let k = queue.length - 1; k >= 0; k -= 1) {
      if (queue[k].at <= t) {
        const { to, msg } = queue[k];
        queue.splice(k, 1);
        to.receive(msg, t);
      }
    }
    if (A.frame < frames) {
      A.pushLocal(inA(A.frame + A.delay));
      A.tick();
      send(B, A.outgoing(), t);
    }
    if (t >= startOffset && B.frame < frames) {
      B.pushLocal(inB(B.frame + B.delay));
      B.tick();
      send(A, B.outgoing(), t);
    }
  }
  // Entrega final para confirmar los últimos fotogramas.
  for (let round = 0; round < 5; round += 1) {
    A.receive(B.outgoing(), 0);
    B.receive(A.outgoing(), 0);
  }
  // Referencia sin red: las mismas entradas aplicadas en orden.
  const ref = initialState();
  const refHash = new Map();
  for (let f = 0; f < frames; f += 1) {
    if (f % 60 === 0) refHash.set(f, hashState(ref));
    step(ref, f < 2 ? 0 : inA(f), f < 2 ? 0 : inB(f));
  }
  return { A, B, desyncs, refHash };
}

test('rollback: ambos lados coinciden con la referencia pese a 20 % de pérdida y desorden', () => {
  const { A, B, desyncs, refHash } = runNetworked({ frames: 1800, latency: 4, jitter: 6, loss: 0.2, startOffset: 3, seed: 7 });
  assert.deepEqual(desyncs, []);
  assert.ok(A.stats.checks > 10 && B.stats.checks > 10, 'se compararon huellas');
  assert.ok(A.stats.rollbacks > 0 && B.stats.rollbacks > 0, 'hubo rollbacks reales');
  for (const [f, h] of A.localChecks) assert.equal(h, refHash.get(f), `A coincide con la referencia en ${f}`);
  for (const [f, h] of B.localChecks) assert.equal(h, refHash.get(f), `B coincide con la referencia en ${f}`);
});

test('rollback: con mucho retardo espera al rival en vez de desincronizarse', () => {
  const { A, B, desyncs } = runNetworked({ frames: 900, latency: 14, jitter: 4, loss: 0.05, startOffset: 0, seed: 3 });
  assert.deepEqual(desyncs, []);
  assert.ok(A.stats.stalls > 0 || B.stats.stalls > 0, 'hubo esperas');
  assert.ok(A.stats.maxRolled <= 10 && B.stats.maxRolled <= 10);
});
