// Sesiones de jugador. Un token secreto identifica al jugador entre reconexiones
// (recarga de página, caída de red) sin necesidad de cuentas de usuario.

import { randomBytes, randomUUID } from 'node:crypto';

export class SessionStore {
  #byToken = new Map(); // token -> { playerId, roomCode }

  create(roomCode) {
    const token = randomBytes(24).toString('base64url');
    const playerId = randomUUID().slice(0, 8);
    this.#byToken.set(token, { playerId, roomCode });
    return { token, playerId };
  }

  get(token) {
    if (typeof token !== 'string') return null;
    return this.#byToken.get(token) ?? null;
  }

  revoke(token) {
    this.#byToken.delete(token);
  }

  get size() {
    return this.#byToken.size;
  }
}
