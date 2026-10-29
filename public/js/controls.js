// Entrada de teclado y mandos (Gamepad API). Guarda una asignación por acción y dispositivo
// en localStorage y emite el conjunto de acciones pulsadas en cada cambio.
// No modifica los controles del juego: sirve para probar el hardware y como referencia.

// Acciones de combate de MK9 (Komplete Edition).
export const ACTIONS = [
  { id: 'up', label: 'Arriba', short: '↑' },
  { id: 'down', label: 'Abajo', short: '↓' },
  { id: 'left', label: 'Izquierda', short: '←' },
  { id: 'right', label: 'Derecha', short: '→' },
  { id: 'fp', label: 'Puñetazo frontal (1)', short: '1' },
  { id: 'bp', label: 'Puñetazo trasero (2)', short: '2' },
  { id: 'fk', label: 'Patada frontal (3)', short: '3' },
  { id: 'bk', label: 'Patada trasera (4)', short: '4' },
  { id: 'block', label: 'Bloquear', short: 'BLQ' },
  { id: 'throw', label: 'Agarre', short: 'AGR' },
  { id: 'flip', label: 'Cambiar postura', short: 'POS' },
  { id: 'tag', label: 'Relevo (modo Tag)', short: 'TAG' },
  { id: 'start', label: 'Pausa / Start', short: 'STA' },
];

// Asignación sugerida por esta web (no es la configuración por defecto del juego).
const DEFAULTS = {
  keyboard: {
    up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD',
    fp: 'KeyU', bp: 'KeyI', fk: 'KeyJ', bk: 'KeyK',
    block: 'KeyL', throw: 'KeyO', flip: 'KeyP', tag: 'KeyH', start: 'Enter',
  },
  // Índices de la «standard mapping» de la Gamepad API (mandos tipo Xbox).
  gamepad: {
    up: 'b12', down: 'b13', left: 'b14', right: 'b15',
    fp: 'b2', bp: 'b3', fk: 'b0', bk: 'b1',
    block: 'b7', throw: 'b5', flip: 'b6', tag: 'b4', start: 'b9',
  },
};

// Botones XInput (mando de Xbox 360), los mismos que usa el ayudante del anfitrión.
export const XB = {
  UP: 0x0001, DOWN: 0x0002, LEFT: 0x0004, RIGHT: 0x0008,
  START: 0x0010, BACK: 0x0020, LS: 0x0040, RS: 0x0080,
  LB: 0x0100, RB: 0x0200, GUIDE: 0x0400,
  A: 0x1000, B: 0x2000, X: 0x4000, Y: 0x8000,
};
// Mando del navegador («standard mapping», distribución Xbox) -> botón XInput.
const STANDARD_TO_XB = [XB.A, XB.B, XB.X, XB.Y, XB.LB, XB.RB, null, null, XB.BACK, XB.START, XB.LS, XB.RS, XB.UP, XB.DOWN, XB.LEFT, XB.RIGHT, XB.GUIDE];
// Teclado (por acción de combate) -> mando Xbox. Coincide con la distribución de MK9 en mando
// que se muestra en la sala; si el juego usa otra, se cambia en sus opciones para el jugador 2.
export const ACTION_TO_XB = {
  up: XB.UP, down: XB.DOWN, left: XB.LEFT, right: XB.RIGHT,
  fp: XB.X, bp: XB.Y, fk: XB.A, bk: XB.B,
  throw: XB.LB, flip: XB.RB, tag: XB.BACK, start: XB.START,
  block: 'RT',
};

const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', 'D-Arriba', 'D-Abajo', 'D-Izq.', 'D-Der.', 'Guía'];
const STORAGE_KEY = 'mk9lobby.bindings.v1';
const AXIS_THRESHOLD = 0.5;

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (saved) return { keyboard: { ...DEFAULTS.keyboard, ...saved.keyboard }, gamepad: { ...DEFAULTS.gamepad, ...saved.gamepad } };
  } catch {
    /* almacenamiento no disponible */
  }
  return structuredClone(DEFAULTS);
}

export function describeBinding(device, code) {
  if (!code) return '—';
  if (device === 'keyboard') {
    return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, 'Flecha ').replace('Space', 'Espacio');
  }
  const m = /^b(\d+)$/.exec(code);
  if (m) return PAD_NAMES[+m[1]] ?? `Botón ${m[1]}`;
  const a = /^a(\d+)([+-])$/.exec(code);
  if (a) return `Eje ${a[1]} ${a[2]}`;
  return code;
}

function isTyping(target) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

export class InputManager extends EventTarget {
  bindings = load();
  active = new Set();
  #keys = new Set();
  #padInputs = new Set();
  #capture = null; // { device, action, resolve }
  #padBaseline = null;

  constructor() {
    super();
    window.addEventListener('keydown', (e) => this.#onKey(e, true));
    window.addEventListener('keyup', (e) => this.#onKey(e, false));
    window.addEventListener('blur', () => {
      this.#keys.clear();
      this.#recompute();
    });
    window.addEventListener('gamepadconnected', () => this.dispatchEvent(new CustomEvent('pads')));
    window.addEventListener('gamepaddisconnected', () => this.dispatchEvent(new CustomEvent('pads')));
    const loop = () => {
      this.#pollPads();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  get pads() {
    return [...(navigator.getGamepads?.() ?? [])].filter(Boolean);
  }

  capture(device, action) {
    this.cancelCapture();
    this.#padBaseline = new Set(this.#padInputs);
    return new Promise((resolve) => {
      this.#capture = { device, action, resolve };
    });
  }

  cancelCapture() {
    this.#capture?.resolve(null);
    this.#capture = null;
  }

  get capturing() {
    return this.#capture;
  }

  // Estado completo de un mando Xbox a partir del primer mando conectado y del teclado.
  xboxState() {
    let b = 0;
    let lt = 0;
    let rt = 0;
    let lx = 0;
    let ly = 0;
    let rx = 0;
    let ry = 0;
    const pad = this.pads.find((p) => p.mapping === 'standard') ?? this.pads[0];
    if (pad) {
      pad.buttons.forEach((btn, i) => {
        if (btn.pressed && STANDARD_TO_XB[i]) b |= STANDARD_TO_XB[i];
      });
      lt = Math.round((pad.buttons[6]?.value ?? 0) * 255);
      rt = Math.round((pad.buttons[7]?.value ?? 0) * 255);
      const axis = (i) => {
        const v = pad.axes[i] ?? 0;
        return Math.abs(v) < 0.12 ? 0 : v; // zona muerta
      };
      // El eje Y del navegador crece hacia abajo; el de XInput, hacia arriba.
      lx = Math.round(axis(0) * 32767);
      ly = Math.round(-axis(1) * 32767);
      rx = Math.round(axis(2) * 32767);
      ry = Math.round(-axis(3) * 32767);
    }
    for (const { id } of ACTIONS) {
      const key = this.bindings.keyboard[id];
      if (!key || !this.#keys.has(key)) continue;
      const target = ACTION_TO_XB[id];
      if (target === 'RT') rt = 255;
      else if (target) b |= target;
    }
    return { b, lt, rt, lx, ly, rx, ry };
  }

  reset() {
    this.bindings = structuredClone(DEFAULTS);
    this.#save();
  }

  #assign(device, action, code) {
    const map = this.bindings[device];
    // Una entrada solo puede pertenecer a una acción: se libera la anterior.
    for (const [other, value] of Object.entries(map)) if (value === code && other !== action) map[other] = null;
    map[action] = code;
    this.#save();
  }

  #save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings));
    } catch {
      /* sin almacenamiento: la asignación dura hasta cerrar la pestaña */
    }
  }

  #onKey(event, down) {
    if (this.#capture?.device === 'keyboard' && down) {
      event.preventDefault();
      const { action, resolve } = this.#capture;
      this.#capture = null;
      if (event.code !== 'Escape') this.#assign('keyboard', action, event.code);
      resolve(event.code === 'Escape' ? null : event.code);
      return;
    }
    if (isTyping(event.target)) return;
    if (down) this.#keys.add(event.code);
    else this.#keys.delete(event.code);
    this.#recompute();
  }

  #pollPads() {
    const inputs = new Set();
    for (const pad of this.pads) {
      pad.buttons.forEach((b, i) => {
        if (b.pressed || b.value > AXIS_THRESHOLD) inputs.add(`b${i}`);
      });
      pad.axes.forEach((v, i) => {
        if (v > AXIS_THRESHOLD) inputs.add(`a${i}+`);
        if (v < -AXIS_THRESHOLD) inputs.add(`a${i}-`);
      });
    }
    const changed = inputs.size !== this.#padInputs.size || [...inputs].some((x) => !this.#padInputs.has(x));
    this.#padInputs = inputs;
    if (!changed) return;

    if (this.#capture?.device === 'gamepad') {
      const fresh = [...inputs].find((x) => !this.#padBaseline.has(x));
      if (fresh) {
        const { action, resolve } = this.#capture;
        this.#capture = null;
        this.#assign('gamepad', action, fresh);
        resolve(fresh);
      }
      this.#padBaseline = new Set([...this.#padBaseline].filter((x) => inputs.has(x)));
    }
    this.#recompute();
  }

  #recompute() {
    const next = new Set();
    for (const { id } of ACTIONS) {
      const key = this.bindings.keyboard[id];
      const pad = this.bindings.gamepad[id];
      if ((key && this.#keys.has(key)) || (pad && this.#padInputs.has(pad))) next.add(id);
    }
    const changed = next.size !== this.active.size || [...next].some((x) => !this.active.has(x));
    this.active = next;
    if (changed) this.dispatchEvent(new CustomEvent('change', { detail: next }));
  }
}
