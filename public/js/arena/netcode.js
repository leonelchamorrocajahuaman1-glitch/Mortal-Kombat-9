// Netcode con rollback para la Arena (estilo GGPO), independiente del transporte.
//
// Cada navegador simula el combate completo. Solo se envían las entradas. Si aún no ha llegado
// la entrada del rival para un fotograma, se predice (repite la última conocida); cuando llega
// la real y difiere, se vuelve a la instantánea de ese fotograma y se recalcula hasta el actual.
// Las huellas del estado confirmado se comparan entre ambos lados para detectar desincronizaciones.

const CHECK_EVERY = 60; // fotogramas entre comprobaciones de huella
const KEEP = 180; // fotogramas de historial que se conservan
const MAX_SEND = 32; // entradas por mensaje (redundancia ante pérdidas)

export class RollbackSession {
  constructor({ local, initial, step, clone, hash, delay = 2, maxRollback = 10, onDesync = () => {} }) {
    this.local = local; // 0 = izquierda (anfitrión), 1 = derecha
    this.delay = delay;
    this.maxRollback = maxRollback;
    this.step = step;
    this.clone = clone;
    this.hash = hash;
    this.onDesync = onDesync;

    this.state = clone(initial);
    this.frame = 0; // siguiente fotograma a simular
    this.snaps = new Map(); // fotograma -> estado antes de simularlo
    this.localIn = new Map();
    this.remoteIn = new Map();
    this.usedRemote = new Map();
    // Los primeros `delay` fotogramas no tienen entrada (la del jugador llega con retardo).
    for (let f = 0; f < delay; f += 1) {
      this.localIn.set(f, 0);
      this.remoteIn.set(f, 0);
    }
    this.latestLocal = delay - 1;
    this.remoteConfirmed = delay - 1; // último fotograma con entradas remotas contiguas
    this.remoteAck = -1; // último fotograma local que el rival confirma tener
    this.remoteFrame = 0; // fotograma actual del rival (informado)
    this.remoteFrameAt = 0;
    this.rollbackFrom = null;

    this.localChecks = new Map();
    this.remoteChecks = new Map();
    this.lastCheckSent = null;
    this.compared = new Set();
    this.stats = { rollbacks: 0, rolledFrames: 0, maxRolled: 0, stalls: 0, checks: 0, desync: false };
  }

  // Entrada local muestreada ahora: se aplica `delay` fotogramas después.
  pushLocal(bits) {
    const f = this.frame + this.delay;
    if (f > this.latestLocal) {
      this.localIn.set(f, bits);
      this.latestLocal = f;
    }
  }

  // Mensaje del rival: { f, i: [entradas desde f], a, rf, c: [fotograma, huella] }.
  receive(msg, now = 0) {
    if (!msg || !Array.isArray(msg.i)) return;
    for (let k = 0; k < msg.i.length; k += 1) {
      const f = msg.f + k;
      if (this.remoteIn.has(f) || f <= this.remoteConfirmed - KEEP) continue;
      const bits = msg.i[k] | 0;
      this.remoteIn.set(f, bits);
      if (f < this.frame && this.usedRemote.get(f) !== bits) {
        this.rollbackFrom = this.rollbackFrom == null ? f : Math.min(this.rollbackFrom, f);
      }
    }
    while (this.remoteIn.has(this.remoteConfirmed + 1)) this.remoteConfirmed += 1;
    if (typeof msg.a === 'number') this.remoteAck = Math.max(this.remoteAck, msg.a);
    if (typeof msg.rf === 'number' && msg.rf >= this.remoteFrame) {
      this.remoteFrame = msg.rf;
      this.remoteFrameAt = now;
    }
    if (Array.isArray(msg.c)) {
      this.remoteChecks.set(msg.c[0], msg.c[1]);
      this.#compare(msg.c[0]);
    }
  }

  // Cuántos fotogramas va este lado por delante del rival (para igualar el ritmo).
  advantage(now = 0, frameMs = 1000 / 60) {
    const remoteNow = this.remoteFrame + Math.max(0, (now - this.remoteFrameAt) / frameMs);
    return this.frame - remoteNow;
  }

  // Intenta avanzar un fotograma. Devuelve false si hay que esperar al rival.
  tick() {
    if (this.rollbackFrom != null) {
      const from = this.rollbackFrom;
      this.rollbackFrom = null;
      const snap = this.snaps.get(from);
      if (snap) {
        this.state = this.clone(snap);
        const to = this.frame;
        for (let f = from; f < to; f += 1) this.#simulate(f);
        const n = to - from;
        this.stats.rollbacks += 1;
        this.stats.rolledFrames += n;
        this.stats.maxRolled = Math.max(this.stats.maxRolled, n);
      }
    }
    if (this.frame - this.remoteConfirmed > this.maxRollback || !this.localIn.has(this.frame)) {
      this.stats.stalls += 1;
      return false;
    }
    this.#simulate(this.frame);
    this.frame += 1;
    this.#checksums();
    this.#prune();
    return true;
  }

  // Mensaje para el rival con las entradas que puede no tener todavía.
  outgoing() {
    const from = Math.max(this.remoteAck + 1, this.latestLocal - MAX_SEND + 1, 0);
    const i = [];
    for (let f = from; f <= this.latestLocal; f += 1) i.push(this.localIn.get(f) ?? 0);
    const msg = { f: from, i, a: this.remoteConfirmed, rf: this.frame };
    if (this.lastCheckSent) msg.c = this.lastCheckSent;
    return msg;
  }

  #predict(f) {
    if (this.remoteIn.has(f)) return this.remoteIn.get(f);
    return this.remoteIn.get(this.remoteConfirmed) ?? 0;
  }

  #simulate(f) {
    this.snaps.set(f, this.clone(this.state));
    const mine = this.localIn.get(f) ?? 0;
    const theirs = this.#predict(f);
    this.usedRemote.set(f, theirs);
    if (this.local === 0) this.step(this.state, mine, theirs);
    else this.step(this.state, theirs, mine);
  }

  // Huella de los fotogramas confirmados (todas las entradas conocidas) cada CHECK_EVERY.
  #checksums() {
    const confirmedUpTo = Math.min(this.remoteConfirmed + 1, this.frame);
    const last = this.lastCheckSent ? this.lastCheckSent[0] : 0;
    for (let f = last + CHECK_EVERY; f <= confirmedUpTo; f += CHECK_EVERY) {
      const s = f === this.frame ? this.state : this.snaps.get(f);
      if (!s) continue;
      const h = this.hash(s);
      this.localChecks.set(f, h);
      this.lastCheckSent = [f, h];
      this.#compare(f);
    }
  }

  #compare(f) {
    if (!this.localChecks.has(f) || !this.remoteChecks.has(f) || this.compared.has(f)) return;
    this.compared.add(f);
    this.stats.checks += 1;
    if (this.localChecks.get(f) !== this.remoteChecks.get(f) && !this.stats.desync) {
      this.stats.desync = true;
      this.onDesync(f);
    }
  }

  #prune() {
    const limit = Math.min(this.remoteConfirmed, this.frame) - KEEP;
    if (limit <= 0 || this.frame % 30 !== 0) return;
    for (const map of [this.snaps, this.localIn, this.remoteIn, this.usedRemote, this.localChecks, this.remoteChecks]) {
      for (const f of map.keys()) if (f < limit) map.delete(f);
    }
    for (const f of this.compared) if (f < limit) this.compared.delete(f);
  }
}
