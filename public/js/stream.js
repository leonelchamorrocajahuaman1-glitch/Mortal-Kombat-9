// Transmisión del juego desde la web (streaming WebRTC) y enlace con el ayudante del mando virtual.
//
// Anfitrión: comparte la ventana de MK9 (getDisplayMedia) con el invitado por WebRTC y reenvía
//            el mando del invitado al ayudante local (ws://127.0.0.1:47800), que crea un mando
//            virtual de Xbox 360: el jugador 2 para el juego.
// Invitado:  ve el vídeo en la página y envía su mando/teclado por el canal P2P de la sala.
//
// Es una conexión WebRTC propia, separada del canal de datos de la sala, y siempre la inicia
// el anfitrión que transmite.

const VIDEO_MAX_BITRATE = 8_000_000;

function newSession() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export class StreamLink extends EventTarget {
  #pc = null;
  #session = null;
  #pending = [];
  #sendSignal;
  #iceServers;
  role = null; // 'host' | 'guest'
  state = 'idle'; // idle | connecting | live | failed | closed
  localStream = null;
  remoteStream = null;

  constructor({ sendSignal, iceServers }) {
    super();
    this.#sendSignal = sendSignal;
    this.#iceServers = iceServers;
  }

  // Pide al navegador la pantalla o ventana que se va a transmitir.
  static async capture() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('Este navegador no permite compartir la pantalla. Usa Chrome o Edge en Windows.');
    }
    return navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 60, max: 60 }, width: { max: 1920 }, height: { max: 1080 } },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  }

  async startHost(stream) {
    this.role = 'host';
    this.localStream = stream;
    this.#reset(newSession());
    const pc = this.#pc;
    for (const track of stream.getTracks()) {
      if (track.kind === 'video') track.contentHint = 'motion';
      const sender = pc.addTrack(track, stream);
      track.addEventListener('ended', () => this.stop()); // «Dejar de compartir» del navegador
      if (track.kind === 'video') this.#tuneSender(sender);
    }
    this.#preferH264();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.#sendSignal({ kind: 'stream-offer', session: this.#session, sdp: pc.localDescription });
  }

  async handleSignal(data) {
    try {
      if (data.kind === 'stream-offer') {
        this.role = 'guest';
        this.#reset(data.session);
        await this.#pc.setRemoteDescription(data.sdp);
        await this.#flush();
        await this.#pc.setLocalDescription(await this.#pc.createAnswer());
        this.#sendSignal({ kind: 'stream-answer', session: this.#session, sdp: this.#pc.localDescription });
      } else if (data.kind === 'stream-stop') {
        this.#close();
        this.dispatchEvent(new CustomEvent('stopped'));
      } else if (data.session !== this.#session || !this.#pc) {
        // señal de una transmisión anterior
      } else if (data.kind === 'stream-answer') {
        await this.#pc.setRemoteDescription(data.sdp);
        await this.#flush();
      } else if (data.kind === 'stream-candidate' && data.candidate) {
        if (this.#pc.remoteDescription) await this.#pc.addIceCandidate(data.candidate);
        else this.#pending.push(data.candidate);
      }
    } catch (err) {
      console.warn('[stream] error de señalización', err);
      this.#setState('failed');
    }
  }

  // Detiene la transmisión y avisa al otro lado.
  stop() {
    if (this.state === 'closed' || this.state === 'idle') return;
    this.#sendSignal({ kind: 'stream-stop', session: this.#session });
    this.#close();
    this.dispatchEvent(new CustomEvent('stopped'));
  }

  // Estadísticas de vídeo: fps, resolución, kbit/s y retardo del búfer (invitado).
  async stats() {
    if (!this.#pc) return null;
    const report = await this.#pc.getStats();
    let out = null;
    report.forEach((s) => {
      const isVideo = s.kind === 'video' || s.mediaType === 'video';
      if (!isVideo) return;
      if (s.type === 'inbound-rtp' || (s.type === 'outbound-rtp' && !out)) {
        out = {
          fps: s.framesPerSecond ?? null,
          width: s.frameWidth ?? null,
          height: s.frameHeight ?? null,
          bytes: s.type === 'inbound-rtp' ? s.bytesReceived : s.bytesSent,
          jitterMs: s.jitterBufferEmittedCount ? Math.round((s.jitterBufferDelay / s.jitterBufferEmittedCount) * 1000) : null,
          at: s.timestamp,
        };
      }
    });
    return out;
  }

  #reset(session) {
    this.#pc?.close();
    this.#pending = [];
    this.#session = session;
    this.remoteStream = null;
    this.#setState('connecting');
    const pc = new RTCPeerConnection({ iceServers: this.#iceServers });
    this.#pc = pc;
    pc.addEventListener('icecandidate', (e) => {
      if (e.candidate && this.#pc === pc) {
        this.#sendSignal({ kind: 'stream-candidate', session, candidate: e.candidate.toJSON() });
      }
    });
    pc.addEventListener('connectionstatechange', () => {
      if (this.#pc !== pc) return;
      if (pc.connectionState === 'connected') this.#setState('live');
      else if (pc.connectionState === 'failed') this.#setState('failed');
      else if (pc.connectionState === 'disconnected') this.#setState('connecting');
    });
    pc.addEventListener('track', (e) => {
      // Mínimo búfer de reproducción: prioridad a la latencia sobre la suavidad.
      if ('jitterBufferTarget' in e.receiver) e.receiver.jitterBufferTarget = 0;
      else if ('playoutDelayHint' in e.receiver) e.receiver.playoutDelayHint = 0;
      this.remoteStream = e.streams[0] ?? new MediaStream([e.track]);
      this.dispatchEvent(new CustomEvent('remote-stream', { detail: this.remoteStream }));
    });
  }

  async #flush() {
    const pending = this.#pending;
    this.#pending = [];
    for (const c of pending) await this.#pc.addIceCandidate(c);
  }

  #tuneSender(sender) {
    try {
      const params = sender.getParameters();
      params.encodings = params.encodings?.length ? params.encodings : [{}];
      params.encodings[0].maxBitrate = VIDEO_MAX_BITRATE;
      params.encodings[0].maxFramerate = 60;
      params.degradationPreference = 'maintain-framerate';
      sender.setParameters(params).catch(() => {});
    } catch {
      /* no todos los navegadores lo permiten antes de negociar */
    }
  }

  // H.264 suele tener codificación por hardware en Windows: menos carga para el PC que juega.
  #preferH264() {
    const caps = globalThis.RTCRtpSender?.getCapabilities?.('video');
    if (!caps) return;
    const h264 = caps.codecs.filter((c) => c.mimeType === 'video/H264');
    if (!h264.length) return;
    const rest = caps.codecs.filter((c) => c.mimeType !== 'video/H264');
    for (const t of this.#pc.getTransceivers()) {
      if (t.sender.track?.kind === 'video' && t.setCodecPreferences) {
        try {
          t.setCodecPreferences([...h264, ...rest]);
        } catch {
          /* sin preferencia */
        }
      }
    }
  }

  #close() {
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.#pc?.close();
    this.#pc = null;
    this.#session = null;
    this.remoteStream = null;
    this.#setState('closed');
  }

  #setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.dispatchEvent(new CustomEvent('state', { detail: state }));
  }
}

// Conexión con el ayudante del mando virtual en el PC del anfitrión.
export class HelperLink extends EventTarget {
  url;
  state = 'off'; // off | connecting | ok
  mode = null; // 'vigem' (mando real) | 'prueba' (sin mando)
  #ws = null;
  #enabled = false;
  #retry = null;

  constructor(url = 'ws://127.0.0.1:47800') {
    super();
    this.url = url;
  }

  enable() {
    if (this.#enabled) return;
    this.#enabled = true;
    this.#connect();
  }

  disable() {
    this.#enabled = false;
    clearTimeout(this.#retry);
    this.#ws?.close();
    this.#ws = null;
    this.#set('off');
  }

  retryNow() {
    clearTimeout(this.#retry);
    if (this.#enabled && this.state !== 'ok') this.#connect();
  }

  send(msg) {
    if (this.#ws?.readyState === WebSocket.OPEN && this.state === 'ok') {
      this.#ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  #connect() {
    this.#set('connecting');
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.#schedule();
      return;
    }
    this.#ws = ws;
    ws.addEventListener('message', (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.t === 'hello') {
        this.mode = msg.mode;
        this.#set('ok');
      }
    });
    ws.addEventListener('close', () => {
      if (this.#ws !== ws) return;
      this.#ws = null;
      this.mode = null;
      this.#set('off');
      this.#schedule();
    });
  }

  #schedule() {
    if (!this.#enabled) return;
    this.#retry = setTimeout(() => this.#connect(), 3000);
  }

  #set(state) {
    if (this.state === state) return;
    this.state = state;
    this.dispatchEvent(new CustomEvent('state', { detail: state }));
  }
}
