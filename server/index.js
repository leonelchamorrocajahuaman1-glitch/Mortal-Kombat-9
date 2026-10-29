// Servidor del Lobby Companion: sirve la web estática y gestiona las salas por WebSocket.
//   npm start   ->  http://localhost:3000

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { config } from './config.js';
import { CLIENT, LIMITS, METHODS, SERVER, encode, parseMessage } from './protocol.js';
import { RoomError, RoomManager } from './rooms.js';
import { SessionStore } from './sessions.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// Mensajes permitidos por segundo y por conexión (con ráfaga).
const RATE = { perSecond: 30, burst: 60 };

// Cabeceras de seguridad para todas las respuestas HTTP.
const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

async function serveStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    // URL mal codificada (p. ej. "/%E0%A4%A"): sin esta protección tumbaba el proceso.
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Petición no válida');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const filePath = path.resolve(PUBLIC_DIR, '.' + pathname);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not a file');
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(filePath).on('error', () => res.destroy()).pipe(res);
  } catch {
    if (!res.headersSent) res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('No encontrado');
  }
}

export function startServer(options = {}) {
  const cfg = { ...config, ...options };
  const sessions = new SessionStore();
  const rooms = new RoomManager({ sessions, graceMs: cfg.reconnectGraceMs, maxRooms: cfg.maxRooms });

  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.roomCount, uptime: Math.round(process.uptime()) }));
      return;
    }
    serveStatic(req, res).catch((err) => {
      console.error('[http] error inesperado', err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: cfg.maxPayloadBytes,
    // Con ALLOWED_ORIGINS solo se aceptan conexiones desde esas webs.
    verifyClient: ({ origin }) => cfg.allowedOrigins.length === 0 || cfg.allowedOrigins.includes(origin),
  });

  wss.on('connection', (ws) => {
    const conn = {
      send(data) {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      },
      close(code, reason) {
        ws.close(code, reason);
      },
    };
    let player = null;
    let tokens = RATE.burst;
    let lastRefill = Date.now();
    ws.lastPongAt = Date.now();
    ws.pingSentAt = 0;

    const fail = (code, message) => conn.send(encode(SERVER.ERROR, { code, message }));

    const enterRoom = (result) => {
      player = result.player;
      conn.send(
        encode(SERVER.JOINED, {
          token: player.token,
          playerId: player.id,
          room: rooms.snapshot(result.room),
          chat: rooms.chatHistory(result.room),
        }),
      );
    };

    ws.on('pong', () => {
      const now = Date.now();
      ws.lastPongAt = now;
      if (player && ws.pingSentAt) player.rtt = now - ws.pingSentAt;
    });

    ws.on('message', (raw, isBinary) => {
      const now = Date.now();
      tokens = Math.min(RATE.burst, tokens + ((now - lastRefill) / 1000) * RATE.perSecond);
      lastRefill = now;
      if (tokens < 1) return fail('RATE_LIMITED', 'Demasiados mensajes. Espera un momento.');
      tokens -= 1;

      const msg = isBinary ? null : parseMessage(raw.toString());
      if (!msg) return fail('BAD_REQUEST', 'Mensaje no válido.');

      try {
        switch (msg.type) {
          case CLIENT.PING:
            conn.send(encode(SERVER.PONG, { t: msg.t }));
            break;
          case CLIENT.CREATE:
            if (player) rooms.leave(player);
            enterRoom(rooms.createRoom(conn, msg.name));
            break;
          case CLIENT.JOIN:
            if (player) rooms.leave(player);
            enterRoom(rooms.joinRoom(conn, msg.code, msg.name));
            break;
          case CLIENT.RESUME:
            enterRoom(rooms.resume(conn, msg.token));
            break;
          case CLIENT.LEAVE:
            if (player) rooms.leave(player);
            player = null;
            conn.send(encode(SERVER.LEFT, { reason: 'leave' }));
            break;
          case CLIENT.UPDATE:
            requirePlayer();
            rooms.update(player, msg);
            break;
          case CLIENT.SET_METHOD:
            requirePlayer();
            rooms.setMethod(player, msg.method);
            break;
          case CLIENT.CHAT:
            requirePlayer();
            rooms.chat(player, msg.text);
            break;
          case CLIENT.SIGNAL:
            requirePlayer();
            if (JSON.stringify(msg.data ?? null).length > LIMITS.signal) throw new RoomError('BAD_REQUEST', 'Señal demasiado grande.');
            rooms.relayToPeer(player, SERVER.SIGNAL, { data: msg.data });
            break;
          case CLIENT.RELAY_PING:
          case CLIENT.RELAY_PONG:
            requirePlayer();
            if (typeof msg.t === 'number') rooms.relayToPeer(player, msg.type, { t: msg.t });
            break;
          default:
            fail('BAD_REQUEST', `Tipo de mensaje desconocido: ${String(msg.type).slice(0, 32)}`);
        }
      } catch (err) {
        if (err instanceof RoomError) fail(err.code, err.message);
        else {
          console.error('[ws] error inesperado', err);
          fail('INTERNAL', 'Error interno del servidor.');
        }
      }
    });

    // Errores de protocolo (p. ej. mensaje mayor que maxPayload): ws cierra la conexión solo.
    ws.on('error', (err) => console.warn('[ws]', err.message));

    ws.on('close', () => {
      if (player) rooms.disconnect(player, conn);
      player = null;
    });

    function requirePlayer() {
      if (!player) throw new RoomError('NOT_IN_ROOM', 'No estás en ninguna sala.');
    }

    conn.send(
      encode(SERVER.WELCOME, {
        serverTime: Date.now(),
        iceServers: cfg.iceServers,
        reconnectGraceMs: cfg.reconnectGraceMs,
        methods: METHODS,
      }),
    );
  });

  // Latido: mide la latencia real de cada jugador y corta conexiones muertas.
  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const ws of wss.clients) {
      if (now - ws.lastPongAt > cfg.deadAfterMs) {
        ws.terminate();
        continue;
      }
      ws.pingSentAt = now;
      ws.ping();
    }
    rooms.broadcastLatency();
  }, cfg.heartbeatMs);

  const sweeper = setInterval(() => rooms.sweepIdle(cfg.roomIdleMs), 60_000);

  const ready = new Promise((resolve) => {
    server.listen(cfg.port, cfg.host, () => resolve(server.address().port));
  });

  async function close() {
    clearInterval(heartbeat);
    clearInterval(sweeper);
    for (const ws of wss.clients) ws.terminate();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }

  return { ready, close, rooms };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const app = startServer();
  app.ready.then((port) => {
    console.log(`MK9 Lobby Companion escuchando en http://localhost:${port} (host ${config.host}, NODE_ENV=${process.env.NODE_ENV ?? 'development'})`);
    if (config.allowedOrigins.length) console.log(`Orígenes permitidos: ${config.allowedOrigins.join(', ')}`);
    console.log('Pulsa Ctrl+C para detenerlo.');
  });
  const shutdown = () => app.close().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
