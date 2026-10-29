// Protocolo de mensajes JSON entre navegador y servidor.
// Cada mensaje es un objeto con un campo `type`. Esta capa solo valida y normaliza;
// la lógica de salas vive en rooms.js.

export const CLIENT = Object.freeze({
  CREATE: 'create', // { name, code? }  (code: recrear una sala tras un reinicio del servidor)
  JOIN: 'join', // { code, name }
  RESUME: 'resume', // { token }
  LEAVE: 'leave', // {}
  UPDATE: 'update', // { name?, steam?, ready? }
  SET_METHOD: 'set-method', // { method }  (solo anfitrión)
  CHAT: 'chat', // { text }
  PING: 'ping', // { t }  -> PONG, latencia navegador-servidor
  SIGNAL: 'signal', // { data }  -> reenviado al rival (señalización WebRTC)
  RELAY_PING: 'relay-ping', // { t }  -> reenviado al rival, que responde con RELAY_PONG
  RELAY_PONG: 'relay-pong', // { t }
});

export const SERVER = Object.freeze({
  WELCOME: 'welcome', // { serverTime, iceServers, methods }
  JOINED: 'joined', // { token, playerId, room }
  ROOM: 'room', // { room }
  LEFT: 'left', // {}
  LATENCY: 'latency', // { players: { [id]: rttMs } }
  CHAT: 'chat', // { from, name, text, at }
  PONG: 'pong', // { t }
  SIGNAL: 'signal', // { from, data }
  RELAY_PING: 'relay-ping', // { from, t }
  RELAY_PONG: 'relay-pong', // { from, t }
  ERROR: 'error', // { code, message }
});

// Formas reales de conectar dos copias de MK9. La web solo organiza; el juego hace el resto.
export const METHODS = Object.freeze({
  arena: { label: 'Arena: juego de lucha original en el navegador (sin MK9)', streaming: false },
  'web-stream': { label: 'Jugar desde esta web: transmisión + mando virtual (beta)', streaming: true },
  'steam-online': { label: 'Online oficial de MK9 (Steam)', streaming: false },
  'remote-play': { label: 'Steam Remote Play Together', streaming: true },
  parsec: { label: 'Parsec', streaming: true },
  rpcs3: { label: 'RPCS3 + RPCN (experimental)', streaming: false },
});

export const LIMITS = Object.freeze({
  name: 24,
  steam: 64,
  chat: 300,
  signal: 12 * 1024,
});

// Alfabeto sin caracteres ambiguos (0/O, 1/I/L) para dictar el código por voz.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

export function normalizeCode(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}

export function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  // Quita caracteres de control y espacios sobrantes.
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

export function parseMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return null;
  return msg;
}

export function encode(type, payload = {}) {
  return JSON.stringify({ type, ...payload });
}
