// Controlador de la Arena: bucle a 60 Hz, entradas locales, netcode con rollback y dibujo.

import { RollbackSession } from './netcode.js';
import { render } from './render.js';
import { IN, cloneState, hashState, initialState, step } from './sim.js';

const FRAME_MS = 1000 / 60;
const STALL_BANNER_MS = 1000;
const STALL_ABORT_MS = 15000;

// Acciones del gestor de controles -> bits de la simulación.
export function bitsFromActions(active) {
  let b = 0;
  if (active.has('left')) b |= IN.L;
  if (active.has('right')) b |= IN.R;
  if (active.has('up')) b |= IN.U;
  if (active.has('down')) b |= IN.D;
  if (active.has('fp')) b |= IN.P;
  if (active.has('fk') || active.has('bk')) b |= IN.K;
  if (active.has('block')) b |= IN.B;
  if (active.has('bp')) b |= IN.S;
  return b;
}

export class ArenaController extends EventTarget {
  #canvas;
  #ctx;
  #input;
  #send; // (msg, { viaP2P }) -> void
  #isP2P; // () => boolean
  #raf = 0;
  #acc = 0;
  #last = 0;
  #lastRecv = 0;
  #ticks = 0;
  #names = [];
  #latch = new Set(); // pulsaciones ocurridas entre dos lecturas (toques muy rápidos)
  session = null;
  local = 0;
  running = false;
  banner = '';
  desync = false;

  constructor({ canvas, input, send, isP2P }) {
    super();
    this.#canvas = canvas;
    this.#ctx = canvas.getContext('2d');
    this.#input = input;
    this.#send = send;
    this.#isP2P = isP2P;
    input.addEventListener('change', ({ detail }) => {
      for (const action of detail) this.#latch.add(action);
    });
    this.#draw(initialState(), 'Pulsad «Iniciar combate» cuando estéis los dos.');
    const self = this;
    if (typeof window !== 'undefined') {
      // Estado de solo lectura para depurar y para las pruebas automáticas.
      window.__arena = {
        get frame() { return self.session?.frame ?? 0; },
        get hp() { return self.session ? self.session.state.p.map((p) => p.hp) : null; },
        get phase() { return self.session?.state.phase ?? null; },
        get stats() { return self.session ? { ...self.session.stats, frame: self.session.frame } : null; },
        get running() { return self.running; },
      };
    }
  }

  start({ local, delay, names }) {
    this.stop();
    this.local = local;
    this.#names = names;
    this.desync = false;
    this.session = new RollbackSession({
      local,
      initial: initialState(),
      step,
      clone: cloneState,
      hash: hashState,
      delay,
      maxRollback: 10,
      onDesync: (f) => {
        this.desync = true;
        this.dispatchEvent(new CustomEvent('desync', { detail: f }));
      },
    });
    this.running = true;
    this.#acc = 0;
    this.#ticks = 0;
    this.#last = performance.now();
    this.#lastRecv = this.#last;
    this.#raf = requestAnimationFrame((t) => this.#loop(t));
    this.dispatchEvent(new CustomEvent('state'));
  }

  stop(reason = '') {
    cancelAnimationFrame(this.#raf);
    const was = this.running;
    this.running = false;
    if (reason) this.banner = reason;
    if (was) {
      this.#draw(this.session?.state ?? initialState(), reason);
      this.dispatchEvent(new CustomEvent('state'));
    }
  }

  receive(msg) {
    if (!this.running || !this.session) return;
    this.#lastRecv = performance.now();
    this.session.receive(msg, this.#lastRecv);
  }

  #loop(now) {
    if (!this.running) return;
    this.#raf = requestAnimationFrame((t) => this.#loop(t));
    this.#acc += Math.min(now - this.#last, 250);
    this.#last = now;
    const s = this.session;
    let steps = 0;
    while (this.#acc >= FRAME_MS && steps < 4) {
      this.#acc -= FRAME_MS;
      steps += 1;
      this.#ticks += 1;
      // Si vamos por delante del rival, cedemos un fotograma de vez en cuando para igualar.
      if (s.advantage(now) > 2 && this.#ticks % 5 === 0) continue;
      s.pushLocal(bitsFromActions(new Set([...this.#input.active, ...this.#latch])));
      this.#latch.clear();
      s.tick();
      const viaP2P = this.#isP2P();
      // Por el servidor, uno de cada dos fotogramas (cada mensaje lleva las entradas recientes).
      if (viaP2P || this.#ticks % 2 === 0) this.#send({ k: 'ar', ...s.outgoing() }, { viaP2P });
    }
    if (this.#acc > FRAME_MS * 8) this.#acc = 0; // pestaña en segundo plano: no intentar recuperar

    const silent = now - this.#lastRecv;
    if (silent > STALL_ABORT_MS) {
      this.stop('Combate cancelado: no llegan datos del rival.');
      this.dispatchEvent(new CustomEvent('timeout'));
      return;
    }
    this.banner = this.desync
      ? 'Desincronización detectada: pulsad «Revancha» para empezar de nuevo.'
      : silent > STALL_BANNER_MS
        ? 'Esperando al rival… (conexión lenta o pestaña en segundo plano)'
        : '';
    this.#draw(s.state, this.banner);
    if (s.state.phase === 'matchEnd' && s.state.pt > 120) {
      this.running = false;
      this.dispatchEvent(new CustomEvent('state'));
    }
  }

  #draw(state, banner) {
    render(this.#ctx, state, { local: this.local, names: this.#names, banner });
  }
}
