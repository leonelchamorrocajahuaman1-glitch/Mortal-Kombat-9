// Sistema de salas privadas (2 jugadores). No depende de WebSocket: cada jugador
// tiene una `conn` con send(string) y close(code, reason), lo que permite probarlo aislado.

import { randomInt } from 'node:crypto';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  LIMITS,
  METHODS,
  SERVER,
  cleanText,
  encode,
  normalizeCode,
} from './protocol.js';

export const MAX_PLAYERS = 2;
const CHAT_HISTORY = 50;

export class RoomError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export class RoomManager {
  #rooms = new Map(); // code -> room
  #sessions;
  #graceMs;
  #maxRooms;
  #now;

  constructor({ sessions, graceMs, maxRooms, now = Date.now }) {
    this.#sessions = sessions;
    this.#graceMs = graceMs;
    this.#maxRooms = maxRooms;
    this.#now = now;
  }

  get roomCount() {
    return this.#rooms.size;
  }

  getRoom(code) {
    return this.#rooms.get(code) ?? null;
  }

  // `requestedCode` permite recrear una sala con su código anterior cuando el servidor se ha
  // reiniciado (las salas viven en memoria; en el plan gratuito de Render ocurre a menudo).
  createRoom(conn, name, requestedCode) {
    if (this.#rooms.size >= this.#maxRooms) {
      throw new RoomError('SERVER_FULL', 'El servidor ha alcanzado el máximo de salas. Inténtalo más tarde.');
    }
    let code;
    if (requestedCode != null) {
      code = normalizeCode(requestedCode);
      if (!code) throw new RoomError('BAD_REQUEST', 'Código de sala no válido.');
      if (this.#rooms.has(code)) throw new RoomError('CODE_TAKEN', 'Esa sala ya existe.');
    } else {
      do code = generateCode();
      while (this.#rooms.has(code));
    }

    const room = {
      code,
      hostId: null,
      method: 'arena',
      players: new Map(),
      chat: [],
      createdAt: this.#now(),
      lastActivity: this.#now(),
    };
    this.#rooms.set(code, room);
    const player = this.#addPlayer(room, conn, name);
    room.hostId = player.id;
    this.broadcastRoom(room);
    return { room, player };
  }

  joinRoom(conn, rawCode, name) {
    const code = normalizeCode(rawCode);
    const room = code && this.#rooms.get(code);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', 'No existe ninguna sala con ese código.');
    if (room.players.size >= MAX_PLAYERS) {
      throw new RoomError('ROOM_FULL', 'La sala ya tiene dos jugadores.');
    }
    const player = this.#addPlayer(room, conn, name);
    this.#system(room, `${player.name} se ha unido a la sala.`);
    this.broadcastRoom(room);
    return { room, player };
  }

  resume(conn, token) {
    const session = this.#sessions.get(token);
    const room = session && this.#rooms.get(session.roomCode);
    const player = room?.players.get(session.playerId);
    if (!player) {
      if (session) this.#sessions.revoke(token);
      throw new RoomError('SESSION_EXPIRED', 'La sesión anterior ha caducado. Crea o únete a una sala de nuevo.');
    }
    if (player.conn && player.conn !== conn) {
      // La misma sesión abierta en otra pestaña o una conexión antigua: gana la nueva.
      player.conn.close(4001, 'replaced');
    }
    clearTimeout(player.graceTimer);
    player.graceTimer = null;
    player.graceEndsAt = null;
    const wasConnected = player.connected;
    player.conn = conn;
    player.connected = true;
    room.lastActivity = this.#now();
    if (!wasConnected) this.#system(room, `${player.name} se ha reconectado.`);
    this.broadcastRoom(room);
    return { room, player };
  }

  // La conexión se cerró sin abandonar la sala: se reserva el puesto un tiempo.
  disconnect(player, conn) {
    const room = this.#rooms.get(player.roomCode);
    if (!room || player.conn !== conn) return;
    player.conn = null;
    player.connected = false;
    player.ready = false;
    player.rtt = null;
    player.graceEndsAt = this.#now() + this.#graceMs;
    player.graceTimer = setTimeout(() => this.#expire(player), this.#graceMs);
    player.graceTimer.unref?.();
    this.#system(room, `${player.name} se ha desconectado. Se reserva su puesto ${Math.round(this.#graceMs / 1000)} s.`);
    this.broadcastRoom(room);
  }

  leave(player) {
    const room = this.#rooms.get(player.roomCode);
    if (!room) return;
    this.#removePlayer(room, player);
    this.#system(room, `${player.name} ha salido de la sala.`);
    this.broadcastRoom(room);
  }

  update(player, fields) {
    const room = this.#requireRoom(player);
    if (typeof fields.name === 'string') {
      const name = cleanText(fields.name, LIMITS.name);
      if (name) player.name = name;
    }
    if (typeof fields.steam === 'string') player.steam = cleanText(fields.steam, LIMITS.steam);
    if (typeof fields.ready === 'boolean') player.ready = fields.ready;
    room.lastActivity = this.#now();
    this.broadcastRoom(room);
  }

  setMethod(player, method) {
    const room = this.#requireRoom(player);
    if (room.hostId !== player.id) {
      throw new RoomError('NOT_HOST', 'Solo el anfitrión puede elegir el método de conexión.');
    }
    if (!Object.hasOwn(METHODS, method)) throw new RoomError('BAD_REQUEST', 'Método de conexión desconocido.');
    if (room.method === method) return;
    room.method = method;
    // Cambiar de método invalida los "listo": cada uno debe confirmar de nuevo.
    for (const p of room.players.values()) p.ready = false;
    room.lastActivity = this.#now();
    this.#system(room, `Método de conexión: ${METHODS[method].label}.`);
    this.broadcastRoom(room);
  }

  chat(player, rawText) {
    const room = this.#requireRoom(player);
    const text = cleanText(rawText, LIMITS.chat);
    if (!text) return;
    this.#pushChat(room, { from: player.id, name: player.name, text, at: this.#now() });
  }

  // Reenvía un mensaje al otro jugador de la sala (señalización WebRTC, ping por relé).
  relayToPeer(player, type, payload) {
    const room = this.#requireRoom(player);
    for (const other of room.players.values()) {
      if (other.id !== player.id && other.connected) {
        other.conn.send(encode(type, { from: player.id, ...payload }));
        return true;
      }
    }
    return false;
  }

  snapshot(room) {
    return {
      code: room.code,
      hostId: room.hostId,
      method: room.method,
      createdAt: room.createdAt,
      players: [...room.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        steam: p.steam,
        ready: p.ready,
        connected: p.connected,
        rtt: p.rtt,
        graceEndsAt: p.graceEndsAt,
      })),
    };
  }

  chatHistory(room) {
    return room.chat;
  }

  broadcastRoom(room) {
    const data = encode(SERVER.ROOM, { room: this.snapshot(room) });
    for (const p of room.players.values()) if (p.connected) p.conn.send(data);
  }

  broadcastLatency() {
    for (const room of this.#rooms.values()) {
      const players = {};
      for (const p of room.players.values()) players[p.id] = p.rtt;
      const data = encode(SERVER.LATENCY, { players });
      for (const p of room.players.values()) if (p.connected) p.conn.send(data);
    }
  }

  // Elimina salas abandonadas (por ejemplo, alguien creó una y cerró el navegador).
  sweepIdle(maxIdleMs) {
    const limit = this.#now() - maxIdleMs;
    for (const room of [...this.#rooms.values()]) {
      // Una sala con alguien conectado nunca se considera abandonada.
      const anyoneConnected = [...room.players.values()].some((p) => p.connected);
      if (!anyoneConnected && room.lastActivity < limit) {
        for (const p of [...room.players.values()]) {
          p.conn?.send(encode(SERVER.LEFT, { reason: 'idle' }));
          this.#removePlayer(room, p);
        }
      }
    }
  }

  #addPlayer(room, conn, rawName) {
    const name = cleanText(rawName, LIMITS.name);
    if (!name) throw new RoomError('BAD_REQUEST', 'Escribe un nombre de jugador.');
    const { token, playerId } = this.#sessions.create(room.code);
    const player = {
      id: playerId,
      token,
      roomCode: room.code,
      name,
      steam: '',
      ready: false,
      connected: true,
      conn,
      rtt: null,
      graceTimer: null,
      graceEndsAt: null,
    };
    room.players.set(player.id, player);
    room.lastActivity = this.#now();
    return player;
  }

  #removePlayer(room, player) {
    clearTimeout(player.graceTimer);
    room.players.delete(player.id);
    this.#sessions.revoke(player.token);
    player.conn = null;
    player.connected = false;
    if (room.players.size === 0) {
      this.#rooms.delete(room.code);
      return;
    }
    if (room.hostId === player.id) room.hostId = room.players.keys().next().value;
    for (const p of room.players.values()) p.ready = false;
  }

  #expire(player) {
    const room = this.#rooms.get(player.roomCode);
    if (!room || player.connected) return;
    this.#removePlayer(room, player);
    if (this.#rooms.has(room.code)) {
      this.#system(room, `${player.name} no volvió a tiempo y ha salido de la sala.`);
      this.broadcastRoom(room);
    }
  }

  #requireRoom(player) {
    const room = this.#rooms.get(player.roomCode);
    if (!room || !room.players.has(player.id)) throw new RoomError('NOT_IN_ROOM', 'No estás en ninguna sala.');
    return room;
  }

  #system(room, text) {
    this.#pushChat(room, { from: null, name: 'Sistema', text, at: this.#now() });
  }

  #pushChat(room, entry) {
    room.chat.push(entry);
    if (room.chat.length > CHAT_HISTORY) room.chat.shift();
    const data = encode(SERVER.CHAT, entry);
    for (const p of room.players.values()) if (p.connected) p.conn.send(data);
  }
}
