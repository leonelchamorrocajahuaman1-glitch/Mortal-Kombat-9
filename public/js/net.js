// Conexión WebSocket con el servidor de salas, con reconexión automática
// y medición de latencia navegador ↔ servidor.

const PING_EVERY_MS = 2000;
const BACKOFF = { minMs: 500, maxMs: 8000 };

export class Connection extends EventTarget {
  #url;
  #ws = null;
  #attempt = 0;
  #pingTimer = null;
  #retryTimer = null;
  state = 'connecting'; // connecting | open | reconnecting | closed
  rtt = null;

  constructor(url) {
    super();
    this.#url = url;
    window.addEventListener('online', () => this.#retryNow());
  }

  connect() {
    clearTimeout(this.#retryTimer);
    this.#setState(this.#attempt === 0 ? 'connecting' : 'reconnecting');
    const ws = new WebSocket(this.#url);
    this.#ws = ws;

    ws.addEventListener('open', () => {
      this.#attempt = 0;
      this.#setState('open');
      this.#startPing();
    });
    ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === 'pong' && typeof msg.t === 'number') {
        this.rtt = Math.round(performance.now() - msg.t);
        this.dispatchEvent(new CustomEvent('rtt', { detail: this.rtt }));
        return;
      }
      this.dispatchEvent(new CustomEvent('message', { detail: msg }));
    });
    ws.addEventListener('close', (event) => {
      if (this.#ws !== ws) return;
      this.#stopPing();
      this.rtt = null;
      this.#ws = null;
      // 4001: la misma sesión se abrió en otra pestaña; no se reconecta para no pelear por ella.
      if (event.code === 4001) {
        this.#setState('closed');
        this.dispatchEvent(new CustomEvent('replaced'));
        return;
      }
      this.#scheduleRetry();
    });
  }

  send(type, payload = {}) {
    if (this.#ws?.readyState !== WebSocket.OPEN) return false;
    this.#ws.send(JSON.stringify({ type, ...payload }));
    return true;
  }

  get isOpen() {
    return this.#ws?.readyState === WebSocket.OPEN;
  }

  #scheduleRetry() {
    this.#attempt += 1;
    const base = Math.min(BACKOFF.maxMs, BACKOFF.minMs * 2 ** (this.#attempt - 1));
    const delay = base / 2 + Math.random() * (base / 2);
    this.#setState('reconnecting');
    this.#retryTimer = setTimeout(() => this.connect(), delay);
  }

  #retryNow() {
    if (this.state === 'reconnecting') {
      clearTimeout(this.#retryTimer);
      this.connect();
    }
  }

  #startPing() {
    this.#stopPing();
    const ping = () => this.send('ping', { t: performance.now() });
    ping();
    this.#pingTimer = setInterval(ping, PING_EVERY_MS);
  }

  #stopPing() {
    clearInterval(this.#pingTimer);
    this.#pingTimer = null;
  }

  #setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.dispatchEvent(new CustomEvent('state', { detail: state }));
  }
}
