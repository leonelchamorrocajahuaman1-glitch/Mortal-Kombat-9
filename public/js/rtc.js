// Enlace directo entre los dos navegadores (WebRTC DataChannel).
// El servidor solo reenvía la señalización; después, los paquetes van de un equipo a otro.
// Se usa para medir la latencia real entre jugadores y para la prueba de mandos en vivo.

const PING_EVERY_MS = 1000;

export class PeerLink extends EventTarget {
  #pc = null;
  #channel = null;
  #session = null;
  #sendSignal;
  #iceServers;
  #pingTimer = null;
  #pendingCandidates = [];
  state = 'idle'; // idle | connecting | connected | failed | closed
  rtt = null;
  jitter = null;
  route = null; // 'host' | 'srflx' | 'relay' (tipo de candidato ICE elegido)

  constructor({ sendSignal, iceServers }) {
    super();
    this.#sendSignal = sendSignal;
    this.#iceServers = iceServers;
  }

  // Lado que inicia: crea la oferta.
  async start() {
    this.#reset(crypto.randomUUID());
    const channel = this.#pc.createDataChannel('lobby', { ordered: false, maxRetransmits: 0 });
    this.#bindChannel(channel);
    const offer = await this.#pc.createOffer();
    await this.#pc.setLocalDescription(offer);
    this.#sendSignal({ kind: 'offer', session: this.#session, sdp: this.#pc.localDescription });
  }

  async handleSignal(data) {
    if (!data || typeof data !== 'object') return;
    try {
      if (data.kind === 'offer') {
        this.#reset(data.session);
        await this.#pc.setRemoteDescription(data.sdp);
        await this.#flushCandidates();
        const answer = await this.#pc.createAnswer();
        await this.#pc.setLocalDescription(answer);
        this.#sendSignal({ kind: 'answer', session: this.#session, sdp: this.#pc.localDescription });
      } else if (data.session !== this.#session || !this.#pc) {
        // Señal de un intento anterior: se ignora.
      } else if (data.kind === 'answer') {
        await this.#pc.setRemoteDescription(data.sdp);
        await this.#flushCandidates();
      } else if (data.kind === 'candidate' && data.candidate) {
        if (this.#pc.remoteDescription) await this.#pc.addIceCandidate(data.candidate);
        else this.#pendingCandidates.push(data.candidate);
      }
    } catch (err) {
      console.warn('[rtc] error de señalización', err);
      this.#setState('failed');
    }
  }

  send(obj) {
    if (this.#channel?.readyState !== 'open') return false;
    this.#channel.send(JSON.stringify(obj));
    return true;
  }

  get isOpen() {
    return this.#channel?.readyState === 'open';
  }

  close() {
    clearInterval(this.#pingTimer);
    this.#channel?.close();
    this.#pc?.close();
    this.#pc = null;
    this.#channel = null;
    this.#session = null;
    this.rtt = null;
    this.jitter = null;
    this.route = null;
    this.#setState('closed');
  }

  #reset(session) {
    clearInterval(this.#pingTimer);
    this.#pc?.close();
    this.#channel = null;
    this.#pendingCandidates = [];
    this.#session = session;
    this.rtt = null;
    this.jitter = null;
    this.route = null;
    this.#setState('connecting');

    const pc = new RTCPeerConnection({ iceServers: this.#iceServers });
    this.#pc = pc;
    pc.addEventListener('icecandidate', (event) => {
      if (event.candidate && this.#pc === pc) {
        this.#sendSignal({ kind: 'candidate', session, candidate: event.candidate.toJSON() });
      }
    });
    pc.addEventListener('connectionstatechange', () => {
      if (this.#pc !== pc) return;
      if (pc.connectionState === 'failed') this.#setState('failed');
      if (pc.connectionState === 'disconnected') this.#setState('connecting');
    });
    pc.addEventListener('datachannel', (event) => this.#bindChannel(event.channel));
  }

  async #flushCandidates() {
    const pending = this.#pendingCandidates;
    this.#pendingCandidates = [];
    for (const candidate of pending) await this.#pc.addIceCandidate(candidate);
  }

  #bindChannel(channel) {
    this.#channel = channel;
    channel.addEventListener('open', () => {
      this.#setState('connected');
      this.#detectRoute();
      const ping = () => this.send({ k: 'ping', t: performance.now() });
      ping();
      this.#pingTimer = setInterval(ping, PING_EVERY_MS);
    });
    channel.addEventListener('close', () => {
      clearInterval(this.#pingTimer);
      if (this.#channel === channel && this.state === 'connected') this.#setState('connecting');
    });
    channel.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.k === 'ping') this.send({ k: 'pong', t: msg.t });
      else if (msg.k === 'pong' && typeof msg.t === 'number') this.#recordRtt(performance.now() - msg.t);
      else this.dispatchEvent(new CustomEvent('data', { detail: msg }));
    });
  }

  #recordRtt(sample) {
    const prev = this.rtt;
    // Media móvil exponencial y variación (jitter) al estilo RFC 3550.
    this.rtt = prev == null ? sample : prev * 0.8 + sample * 0.2;
    if (prev != null) this.jitter = (this.jitter ?? 0) + (Math.abs(sample - prev) - (this.jitter ?? 0)) / 16;
    this.dispatchEvent(new CustomEvent('rtt', { detail: this.rtt }));
  }

  async #detectRoute() {
    try {
      const stats = await this.#pc.getStats();
      let pair = null;
      stats.forEach((s) => {
        if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s;
      });
      const local = pair && stats.get(pair.localCandidateId);
      this.route = local?.candidateType ?? null;
      this.dispatchEvent(new CustomEvent('state', { detail: this.state }));
    } catch {
      /* getStats no disponible: no es crítico */
    }
  }

  #setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.dispatchEvent(new CustomEvent('state', { detail: state }));
  }
}
