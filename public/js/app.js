// Controlador de la interfaz: une la conexión con el servidor, el enlace P2P y los controles.

import { ACTIONS, InputManager, describeBinding } from './controls.js';
import { METHOD_GUIDES } from './methods.js';
import { Connection } from './net.js';
import { PeerLink } from './rtc.js';

const $ = (sel) => document.querySelector(sel);
const STORE = { token: 'mk9lobby.token', name: 'mk9lobby.name' };

const state = {
  welcome: null,
  clockOffset: 0, // hora del servidor - hora local
  token: safeGet(sessionStorage, STORE.token),
  playerId: null,
  room: null,
  serverRtt: {}, // playerId -> ms (medido por el servidor)
  relayRtt: null,
  pending: null, // acción a enviar en cuanto haya conexión
  peerInput: new Set(),
  bothReadyNotified: false,
};

const conn = new Connection(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
const input = new InputManager();
let peer = null; // PeerLink
let peerFor = null; // id del rival al que corresponde `peer`

// ---------------------------------------------------------------- utilidades

function safeGet(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(storage, key, value) {
  try {
    if (value == null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    /* almacenamiento bloqueado */
  }
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
}

function toast(text, kind = '') {
  const t = el('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, text);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 4500);
}

async function copy(text, okMessage) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMessage, 'ok');
  } catch {
    window.prompt('Copia este texto:', text);
  }
}

const fmtMs = (ms) => (ms == null ? '—' : `${Math.round(ms)} ms`);

function inviteLink(code) {
  const url = new URL(location.href);
  url.search = `?sala=${code}`;
  url.hash = '';
  return url.toString();
}

function me() {
  return state.room?.players.find((p) => p.id === state.playerId) ?? null;
}
function rival() {
  return state.room?.players.find((p) => p.id !== state.playerId) ?? null;
}

// ---------------------------------------------------------------- conexión con el servidor

conn.addEventListener('state', ({ detail }) => {
  renderConnPill();
  if (detail === 'open') {
    if (state.token) conn.send('resume', { token: state.token });
    else if (state.pending) conn.send(state.pending.type, state.pending.payload);
    state.pending = null;
  } else if (state.room) {
    // Sin servidor no hay señalización: el rival nos verá desconectados.
    closePeer();
    renderRoom();
  }
});
conn.addEventListener('rtt', () => {
  renderConnPill();
  renderMetrics();
});
conn.addEventListener('replaced', () => {
  toast('Esta sala se ha abierto en otra pestaña o ventana. Esta queda desconectada.', 'error');
  renderConnPill();
});

conn.addEventListener('message', ({ detail: msg }) => {
  switch (msg.type) {
    case 'welcome':
      state.welcome = msg;
      state.clockOffset = msg.serverTime - Date.now();
      fillMethodSelect();
      break;
    case 'joined':
      state.token = msg.token;
      safeSet(sessionStorage, STORE.token, msg.token);
      state.playerId = msg.playerId;
      state.room = msg.room;
      state.bothReadyNotified = false;
      $('#chat-log').replaceChildren();
      for (const entry of msg.chat ?? []) appendChat(entry);
      history.replaceState(null, '', `?sala=${msg.room.code}`);
      showView('room');
      onRoomChanged();
      break;
    case 'room':
      state.room = msg.room;
      onRoomChanged();
      break;
    case 'latency':
      state.serverRtt = msg.players ?? {};
      renderMetrics();
      renderSlots();
      break;
    case 'chat':
      appendChat(msg);
      break;
    case 'signal':
      if (msg.data?.kind === 'input') setPeerInput(msg.data.active, 'servidor');
      else if (msg.data?.kind === 'restart') maybeStartPeer(true);
      else ensurePeer()?.handleSignal(msg.data);
      break;
    case 'relay-ping':
      conn.send('relay-pong', { t: msg.t });
      break;
    case 'relay-pong':
      state.relayRtt = performance.now() - msg.t;
      renderMetrics();
      break;
    case 'left':
      if (msg.reason === 'idle') toast('La sala se cerró por inactividad.');
      resetToHome();
      break;
    case 'error':
      handleError(msg);
      break;
  }
});

function handleError({ code, message }) {
  toast(message, 'error');
  if (code === 'SESSION_EXPIRED') {
    const oldCode = state.room?.code ?? new URLSearchParams(location.search).get('sala');
    resetToHome();
    if (oldCode) $('#join-code').value = oldCode;
  }
}

function resetToHome() {
  closePeer();
  state.token = null;
  safeSet(sessionStorage, STORE.token, null);
  state.room = null;
  state.playerId = null;
  state.relayRtt = null;
  history.replaceState(null, '', location.pathname);
  showView('home');
}

function sendOrQueue(type, payload) {
  if (!conn.send(type, payload)) {
    state.pending = { type, payload };
    toast('Sin conexión con el servidor. Se enviará al reconectar.');
  }
}

// ---------------------------------------------------------------- enlace P2P (WebRTC)

function ensurePeer() {
  const other = rival();
  if (!other || !state.welcome) return null;
  if (peer && peerFor === other.id && peer.state !== 'closed') return peer;
  closePeer();
  peerFor = other.id;
  peer = new PeerLink({
    iceServers: state.welcome.iceServers,
    sendSignal: (data) => conn.send('signal', { data }),
  });
  peer.addEventListener('state', () => renderMetrics());
  peer.addEventListener('rtt', () => renderMetrics());
  peer.addEventListener('data', ({ detail }) => {
    if (detail.k === 'input') setPeerInput(detail.active, 'P2P');
  });
  return peer;
}

function closePeer() {
  peer?.close();
  peer = null;
  peerFor = null;
  setPeerInput([], '');
}

// Inicia la oferta el jugador con el id menor, para que solo uno de los dos la cree.
function maybeStartPeer(force = false) {
  const self = me();
  const other = rival();
  if (!self || !other || !other.connected || !conn.isOpen) {
    if (peer) closePeer();
    return;
  }
  const isOfferer = self.id < other.id;
  const link = ensurePeer();
  if (!link) return;
  if (isOfferer && (force || link.state === 'idle')) link.start();
}

$('#retry-p2p').addEventListener('click', () => {
  const self = me();
  const other = rival();
  if (!self || !other) return;
  if (self.id < other.id) maybeStartPeer(true);
  else conn.send('signal', { data: { kind: 'restart' } });
});

// Ping por el servidor: ida y vuelta pasando por el relé, como referencia si falla el P2P.
setInterval(() => {
  if (rival()?.connected && conn.isOpen) conn.send('relay-ping', { t: performance.now() });
}, 2000);

// ---------------------------------------------------------------- prueba de mandos en vivo

let lastInputSent = 0;
let inputTimer = null;
function broadcastInput() {
  const active = [...input.active];
  const now = performance.now();
  const wait = 50 - (now - lastInputSent); // como máximo 20 mensajes/s
  clearTimeout(inputTimer);
  if (wait > 0) {
    inputTimer = setTimeout(broadcastInput, wait);
    return;
  }
  lastInputSent = now;
  if (peer?.isOpen) peer.send({ k: 'input', active });
  else if (rival()?.connected) conn.send('signal', { data: { kind: 'input', active } });
}

input.addEventListener('change', () => {
  renderChips($('#input-self'), input.active);
  renderBindingsLive();
  if (state.room) broadcastInput();
});

function setPeerInput(active, route) {
  const valid = new Set(ACTIONS.map((a) => a.id));
  state.peerInput = new Set(Array.isArray(active) ? active.filter((a) => valid.has(a)) : []);
  $('#input-route').textContent = route ? `· vía ${route}` : '';
  renderChips($('#input-peer'), state.peerInput);
}

function renderChips(container, active) {
  if (!container.childElementCount) {
    container.append(...ACTIONS.map((a) => el('span', { class: 'chip', dataset: { action: a.id }, title: a.label }, a.short)));
  }
  for (const chip of container.children) chip.classList.toggle('on', active.has(chip.dataset.action));
}

// ---------------------------------------------------------------- vistas

function showView(name) {
  $('#view-home').hidden = name !== 'home';
  $('#view-room').hidden = name !== 'room';
  window.scrollTo({ top: 0 });
}

function renderConnPill() {
  const pill = $('#conn-status');
  pill.dataset.state = conn.state;
  const labels = {
    connecting: 'Conectando…',
    open: 'En línea',
    reconnecting: 'Reconectando…',
    closed: 'Desconectado',
  };
  pill.querySelector('.label').textContent = labels[conn.state];
  $('#conn-ms').textContent = conn.state === 'open' && conn.rtt != null ? `${conn.rtt} ms` : '';
}

function onRoomChanged() {
  const other = rival();
  if (peer && (!other || !other.connected || peerFor !== other.id)) closePeer();
  maybeStartPeer();
  renderRoom();

  const self = me();
  if (self && other && self.ready && other.ready && other.connected) {
    if (!state.bothReadyNotified) toast('¡Ambos listos! Lanzad el juego.', 'ok');
    state.bothReadyNotified = true;
  } else {
    state.bothReadyNotified = false;
  }
}

function renderRoom() {
  const room = state.room;
  if (!room) return;
  $('#room-code').textContent = room.code;
  const self = me();
  const ready = $('#toggle-ready');
  ready.setAttribute('aria-pressed', String(!!self?.ready));
  ready.textContent = self?.ready ? 'Listo ✓ (pulsa para cancelar)' : 'Marcar como listo';
  if (document.activeElement !== $('#steam-id')) $('#steam-id').value = self?.steam ?? '';
  renderSlots();
  renderMetrics();
  renderGameArea();
}

function renderSlots() {
  const room = state.room;
  if (!room) return;
  // El anfitrión ocupa siempre el lado izquierdo.
  const ordered = [...room.players].sort((a, b) => (a.id === room.hostId ? -1 : b.id === room.hostId ? 1 : 0));
  [0, 1].forEach((i) => {
    const slot = $(`#slot-${i}`);
    const p = ordered[i];
    slot.classList.toggle('empty', !p);
    if (!p) {
      slot.replaceChildren(
        el('div', { class: 'pulse' }),
        el('div', { class: 'name' }, 'Esperando rival…'),
        el('p', { class: 'muted small' }, `Comparte el código ${room.code} o el enlace de invitación.`),
      );
      return;
    }
    const meta = [];
    if (p.id === room.hostId) meta.push(el('span', { class: 'tag gold' }, 'Anfitrión'));
    if (p.id === state.playerId) meta.push(el('span', { class: 'tag' }, 'Tú'));
    if (p.connected) {
      meta.push(el('span', { class: 'tag ok' }, 'Conectado'));
      const rtt = state.serverRtt[p.id] ?? p.rtt;
      if (rtt != null) meta.push(el('span', { class: 'tag' }, `${rtt} ms al servidor`));
    } else {
      const graceS = Math.round((state.welcome?.reconnectGraceMs ?? 60_000) / 1000);
      const left = p.graceEndsAt
        ? Math.min(graceS, Math.max(0, Math.ceil((p.graceEndsAt - (Date.now() + state.clockOffset)) / 1000)))
        : null;
      meta.push(el('span', { class: 'tag bad' }, left != null ? `Desconectado · ${left} s` : 'Desconectado'));
    }
    meta.push(el('span', { class: `tag ${p.ready ? 'ok' : 'warn'}` }, p.ready ? 'Listo' : 'No listo'));

    const steam = p.steam
      ? el('div', { class: 'steam' }, `Steam: ${p.steam}`,
          p.id !== state.playerId
            ? el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => copy(p.steam, 'Nombre de Steam copiado.') }, 'Copiar')
            : null)
      : el('div', { class: 'steam' }, 'Sin perfil de Steam');

    slot.replaceChildren(
      el('div', { class: 'slot' }, i === 0 ? 'Jugador 1' : 'Jugador 2'),
      el('div', { class: 'name' }, p.name),
      steam,
      el('div', { class: 'meta' }, meta),
    );
  });
}

function qualityFor(ms) {
  if (ms < 60) return ['great', 'Excelente para un juego de lucha.'];
  if (ms < 100) return ['good', 'Buena. Jugable sin problemas notables.'];
  if (ms < 150) return ['ok', 'Aceptable: notaréis algo de retardo en las entradas.'];
  return ['bad', 'Alta: el online de MK9 no tiene rollback y se notará mucho.'];
}

function renderMetrics() {
  if (!state.room) return;
  const other = rival();
  $('#m-self').textContent = fmtMs(conn.rtt);
  $('#m-peer').textContent = other?.connected ? fmtMs(state.serverRtt[other.id]) : '—';
  $('#m-relay').textContent = other?.connected ? fmtMs(state.relayRtt) : '—';

  const p2p = $('#m-p2p');
  const retry = $('#retry-p2p');
  retry.hidden = true;
  const routes = { host: 'red local', srflx: 'directa', prflx: 'directa', relay: 'TURN' };
  if (!other?.connected) p2p.textContent = '—';
  else if (!peer || peer.state === 'connecting' || peer.state === 'idle') p2p.textContent = 'Conectando…';
  else if (peer.state === 'failed') {
    p2p.textContent = 'No disponible';
    retry.hidden = false;
  } else if (peer.state === 'connected') {
    p2p.replaceChildren(
      fmtMs(peer.rtt),
      peer.jitter != null ? el('small', {}, ` ±${Math.round(peer.jitter)}`) : '',
      peer.route ? el('small', {}, ` · ${routes[peer.route] ?? peer.route}`) : '',
    );
  }

  const q = $('#quality');
  const text = $('#quality-text');
  const best = peer?.state === 'connected' && peer.rtt != null ? peer.rtt : state.relayRtt;
  if (!other?.connected || best == null) {
    q.dataset.level = 'none';
    text.textContent = other ? 'Midiendo la latencia entre vuestros equipos…' : 'Esperando a tu rival para medir la latencia entre vuestros equipos.';
    return;
  }
  const [level, label] = qualityFor(best);
  q.dataset.level = level;
  const source = peer?.state === 'connected' ? 'directa entre vuestros equipos' : 'pasando por el servidor (P2P no disponible)';
  text.textContent = `${Math.round(best)} ms de ida y vuelta, ${source}. ${label}`;
}

function fillMethodSelect() {
  const select = $('#method-select');
  const methods = state.welcome?.methods ?? {};
  select.replaceChildren(
    ...Object.entries(methods).map(([id, m]) => el('option', { value: id }, m.streaming ? `${m.label} — streaming` : m.label)),
  );
  if (state.room) select.value = state.room.method;
}

function renderGameArea() {
  const room = state.room;
  const self = me();
  const other = rival();
  const guide = METHOD_GUIDES[room.method];
  const isHost = room.hostId === state.playerId;

  const select = $('#method-select');
  select.value = room.method;
  select.disabled = !isHost;
  $('#method-hint').textContent = isHost ? '' : '(lo elige el anfitrión)';
  const tag = $('#method-tag');
  tag.className = `tag ${guide.streaming ? 'stream' : 'ok'}`;
  tag.textContent = guide.streaming ? 'Streaming' : 'Juego local en cada PC';

  const status = $('#game-status');
  status.className = 'game-status';
  if (!other) {
    status.classList.add('waiting');
    status.textContent = 'Esperando a que tu rival entre en la sala.';
  } else if (!other.connected) {
    status.classList.add('waiting');
    status.textContent = `${other.name} se ha desconectado. Esperando a que vuelva…`;
  } else if (self?.ready && other.ready) {
    status.classList.add('ready');
    status.textContent = '¡Ambos listos! Seguid los pasos y lanzad el juego.';
  } else {
    status.classList.add('waiting');
    const waiting = [self?.ready ? null : 'tú', other.ready ? null : other.name].filter(Boolean).join(' y ');
    status.textContent = `Ambos conectados. Falta marcar «Listo»: ${waiting}.`;
  }

  const steps = $('#method-steps');
  steps.replaceChildren(...guide.steps.map((s) => el('li', {}, s)), el('li', { class: 'note' }, guide.note));

  const launch = $('#launch-game');
  const note = $('#launch-note');
  if (!guide.launch) {
    launch.hidden = true;
    note.textContent = 'Abre RPCS3 en tu PC; este método no se lanza desde Steam.';
  } else {
    launch.hidden = false;
    launch.href = guide.launch;
    const hostName = room.players.find((p) => p.id === room.hostId)?.name ?? 'el anfitrión';
    note.textContent = guide.whoNeedsGame === 'both'
      ? 'Ambos jugadores deben abrir el juego.'
      : `Solo ${isHost ? 'tú (anfitrión)' : hostName} abre el juego.`;
  }
}

function appendChat(entry) {
  const log = $('#chat-log');
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
  const time = new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const li = entry.from
    ? el('li', { class: entry.from === state.playerId ? 'mine' : '' }, el('b', {}, entry.name), entry.text, el('small', { class: 'muted' }, `  ${time}`))
    : el('li', { class: 'system' }, entry.text);
  log.append(li);
  if (atBottom) log.scrollTop = log.scrollHeight;
}

// Cuenta atrás de reconexión del rival.
setInterval(() => {
  if (state.room?.players.some((p) => !p.connected)) renderSlots();
}, 1000);

// ---------------------------------------------------------------- acciones de la página de inicio

const nameInput = $('#player-name');
nameInput.value = safeGet(localStorage, STORE.name) ?? '';

function requireName() {
  const name = nameInput.value.trim();
  if (!name) {
    focusPlayPanel();
    nameInput.focus();
    toast('Escribe tu nombre de jugador primero.', 'error');
    return null;
  }
  safeSet(localStorage, STORE.name, name);
  return name;
}

function focusPlayPanel() {
  const panel = $('#play-panel');
  panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  panel.classList.add('flash');
  setTimeout(() => panel.classList.remove('flash'), 900);
}

function createRoom() {
  const name = requireName();
  if (name) sendOrQueue('create', { name });
}

function joinRoom(code) {
  const name = requireName();
  if (!name) return;
  if (!code || code.replace(/[^a-z0-9]/gi, '').length !== 6) {
    toast('El código de sala tiene 6 caracteres.', 'error');
    $('#join-code').focus();
    return;
  }
  sendOrQueue('join', { code, name });
}

$('#btn-play').addEventListener('click', () => {
  // Con un enlace de invitación, «Jugar» entra directamente en la sala.
  const code = $('#join-code').value.trim();
  if (code && nameInput.value.trim()) joinRoom(code);
  else focusPlayPanel();
});
$('#btn-create').addEventListener('click', createRoom);
$('#btn-create-2').addEventListener('click', createRoom);
$('#btn-join-focus').addEventListener('click', () => {
  focusPlayPanel();
  (nameInput.value.trim() ? $('#join-code') : nameInput).focus();
});
$('#join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  joinRoom($('#join-code').value);
});
$('#join-code').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

// ---------------------------------------------------------------- acciones de la sala

$('#copy-code').addEventListener('click', () => copy(state.room.code, 'Código copiado.'));
$('#copy-link').addEventListener('click', () => copy(inviteLink(state.room.code), 'Enlace de invitación copiado.'));
$('#leave-room').addEventListener('click', () => {
  conn.send('leave');
  resetToHome();
});
$('#toggle-ready').addEventListener('click', () => conn.send('update', { ready: !me()?.ready }));
$('#profile-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (conn.send('update', { steam: $('#steam-id').value })) toast('Perfil guardado.', 'ok');
});
$('#method-select').addEventListener('change', (e) => conn.send('set-method', { method: e.target.value }));
$('#chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const field = $('#chat-input');
  if (field.value.trim() && conn.send('chat', { text: field.value })) field.value = '';
});

// ---------------------------------------------------------------- diálogo de controles

let device = 'keyboard';
const dialog = $('#controls-dialog');

$('#open-controls').addEventListener('click', () => {
  renderBindings();
  renderPads();
  dialog.showModal();
});
dialog.addEventListener('close', () => {
  input.cancelCapture();
  $('#capture-hint').textContent = '';
});
for (const tab of dialog.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    device = tab.dataset.device;
    for (const t of dialog.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t === tab));
    input.cancelCapture();
    renderBindings();
  });
}
$('#reset-bindings').addEventListener('click', () => {
  input.reset();
  renderBindings();
});
input.addEventListener('pads', renderPads);

function renderPads() {
  const pads = input.pads;
  $('#pads-list').replaceChildren(
    ...(pads.length
      ? pads.map((p) => el('span', { class: 'tag ok' }, `Mando ${p.index + 1}: ${p.id.slice(0, 48)}`))
      : [el('span', { class: 'tag warn' }, 'Ningún mando detectado. Conéctalo y pulsa un botón.')]),
  );
}

function renderBindings() {
  $('#bindings-body').replaceChildren(
    ...ACTIONS.map((a) => {
      const btn = el('button', { class: 'btn btn-ghost btn-sm bind-btn', type: 'button' }, describeBinding(device, input.bindings[device][a.id]));
      btn.addEventListener('click', async () => {
        btn.classList.add('capturing');
        btn.textContent = device === 'keyboard' ? 'Pulsa una tecla…' : 'Pulsa un botón…';
        $('#capture-hint').textContent = device === 'keyboard' ? 'Esc para cancelar.' : 'Pulsa el botón o mueve el eje del mando.';
        await input.capture(device, a.id);
        $('#capture-hint').textContent = '';
        renderBindings();
      });
      return el('tr', { dataset: { action: a.id } }, el('td', {}, a.label), el('td', {}, btn), el('td', {}, el('span', { class: 'live-dot', title: 'Se ilumina al pulsar' })));
    }),
  );
  renderBindingsLive();
}

function renderBindingsLive() {
  if (!dialog.open) return;
  for (const row of $('#bindings-body').children) row.classList.toggle('on', input.active.has(row.dataset.action));
}

// ---------------------------------------------------------------- arranque

renderChips($('#input-self'), input.active);
renderChips($('#input-peer'), state.peerInput);
renderConnPill();

const invited = new URLSearchParams(location.search).get('sala');
if (invited && !state.token) {
  $('#join-code').value = invited.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  $('#btn-play').textContent = 'Jugar · unirse a la sala';
}
conn.connect();
