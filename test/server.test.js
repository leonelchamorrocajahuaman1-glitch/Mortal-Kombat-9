// Pruebas de integración: servidor real + dos clientes WebSocket reales.
//   npm test

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { WebSocket } from 'ws';
import { startServer } from '../server/index.js';

let app;
let url;

before(async () => {
  app = startServer({ port: 0, host: '127.0.0.1', reconnectGraceMs: 400, heartbeatMs: 100, deadAfterMs: 2000 });
  const port = await app.ready;
  url = `ws://127.0.0.1:${port}/ws`;
});

after(() => app.close());

// Cliente de prueba que guarda los mensajes y permite esperar uno concreto.
async function client() {
  const ws = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    inbox.push(msg);
    for (const w of [...waiters]) {
      if (w.match(msg)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(msg);
      }
    }
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return {
    ws,
    inbox,
    send: (type, payload = {}) => ws.send(JSON.stringify({ type, ...payload })),
    next(type, pred = () => true, timeoutMs = 2000) {
      const found = inbox.find((m) => m.type === type && pred(m) && !m.seen);
      if (found) {
        found.seen = true;
        return Promise.resolve(found);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout esperando ${type}`)), timeoutMs);
        waiters.push({
          match: (m) => m.type === type && pred(m),
          resolve: (m) => {
            clearTimeout(timer);
            m.seen = true;
            resolve(m);
          },
        });
      });
    },
    close: () => new Promise((resolve) => {
      ws.once('close', resolve);
      ws.close();
    }),
  };
}

async function roomWithTwo() {
  const a = await client();
  const b = await client();
  a.send('create', { name: 'Ana' });
  const joinedA = await a.next('joined');
  b.send('join', { code: joinedA.room.code.toLowerCase(), name: 'Beto' });
  const joinedB = await b.next('joined');
  return { a, b, joinedA, joinedB, code: joinedA.room.code };
}

test('saluda con la configuración ICE y los métodos de conexión', async () => {
  const c = await client();
  const welcome = await c.next('welcome');
  assert.ok(Array.isArray(welcome.iceServers));
  assert.ok(welcome.methods['steam-online']);
  await c.close();
});

test('crea una sala y otro jugador se une con el código', async () => {
  const { a, b, joinedA, joinedB, code } = await roomWithTwo();
  assert.match(code, /^[A-HJKMNP-Z2-9]{6}$/);
  assert.equal(joinedB.room.code, code);
  assert.equal(joinedB.room.players.length, 2);
  assert.equal(joinedB.room.hostId, joinedA.playerId);
  const roomA = await a.next('room', (m) => m.room.players.length === 2);
  assert.deepEqual(roomA.room.players.map((p) => p.name), ['Ana', 'Beto']);
  await a.close();
  await b.close();
});

test('rechaza un tercer jugador y códigos inexistentes', async () => {
  const { a, b, code } = await roomWithTwo();
  const c = await client();
  c.send('join', { code, name: 'Carla' });
  assert.equal((await c.next('error')).code, 'ROOM_FULL');
  c.send('join', { code: 'ZZZZZZ', name: 'Carla' });
  assert.equal((await c.next('error')).code, 'ROOM_NOT_FOUND');
  await Promise.all([a.close(), b.close(), c.close()]);
});

test('sincroniza listo, perfil, método y chat entre ambos jugadores', async () => {
  const { a, b } = await roomWithTwo();
  b.send('update', { ready: true, steam: 'beto_steam' });
  const seen = await a.next('room', (m) => m.room.players.some((p) => p.name === 'Beto' && p.ready));
  assert.equal(seen.room.players.find((p) => p.name === 'Beto').steam, 'beto_steam');

  b.send('set-method', { method: 'parsec' });
  assert.equal((await b.next('error')).code, 'NOT_HOST');

  a.send('set-method', { method: 'remote-play' });
  const changed = await b.next('room', (m) => m.room.method === 'remote-play');
  assert.ok(changed.room.players.every((p) => !p.ready), 'cambiar de método reinicia «listo»');

  a.send('chat', { text: '  hola\u0007 ' });
  const chat = await b.next('chat', (m) => m.from !== null);
  assert.equal(chat.text, 'hola');
  await a.close();
  await b.close();
});

test('reenvía la señalización WebRTC y el ping por relé solo al rival', async () => {
  const { a, b, joinedA } = await roomWithTwo();
  a.send('signal', { data: { kind: 'offer', sdp: { type: 'offer', sdp: 'x' } } });
  const sig = await b.next('signal');
  assert.equal(sig.from, joinedA.playerId);
  assert.equal(sig.data.kind, 'offer');

  a.send('relay-ping', { t: 123 });
  const ping = await b.next('relay-ping');
  b.send('relay-pong', { t: ping.t });
  assert.equal((await a.next('relay-pong')).t, 123);
  assert.ok(!a.inbox.some((m) => m.type === 'signal'), 'el emisor no recibe su propia señal');
  await a.close();
  await b.close();
});

test('mide la latencia de cada jugador con el latido del servidor', async () => {
  const { a, b, joinedA, joinedB } = await roomWithTwo();
  const lat = await a.next('latency', (m) => m.players[joinedA.playerId] != null && m.players[joinedB.playerId] != null);
  assert.ok(lat.players[joinedB.playerId] >= 0);
  await a.close();
  await b.close();
});

test('reserva el puesto al desconectarse y permite reanudar con el token', async () => {
  const { a, b, joinedB } = await roomWithTwo();
  await b.close();
  const down = await a.next('room', (m) => m.room.players.some((p) => p.id === joinedB.playerId && !p.connected));
  assert.ok(down.room.players.find((p) => p.id === joinedB.playerId).graceEndsAt > 0);

  const b2 = await client();
  b2.send('resume', { token: joinedB.token });
  const resumed = await b2.next('joined');
  assert.equal(resumed.playerId, joinedB.playerId);
  assert.ok(resumed.chat.some((m) => /desconectado/.test(m.text)));
  await a.next('room', (m) => m.room.players.find((p) => p.id === joinedB.playerId)?.connected);
  await a.close();
  await b2.close();
});

test('libera el puesto cuando vence el tiempo de reconexión', async () => {
  const { a, b, joinedB } = await roomWithTwo();
  await b.close();
  await a.next('chat', (m) => /no volvió a tiempo/.test(m.text), 3000);
  const b2 = await client();
  b2.send('resume', { token: joinedB.token });
  assert.equal((await b2.next('error')).code, 'SESSION_EXPIRED');
  await a.close();
  await b2.close();
});

test('el anfitrión pasa al otro jugador si el anfitrión sale', async () => {
  const { a, b, joinedB } = await roomWithTwo();
  a.send('leave');
  await a.next('left');
  const room = await b.next('room', (m) => m.room.players.length === 1 && m.room.hostId === joinedB.playerId);
  assert.equal(room.room.hostId, joinedB.playerId);
  await a.close();
  await b.close();
});

test('la sala se elimina cuando la abandonan todos', async () => {
  const before = app.rooms.roomCount;
  const a = await client();
  a.send('create', { name: 'Solo' });
  await a.next('joined');
  assert.equal(app.rooms.roomCount, before + 1);
  a.send('leave');
  await a.next('left');
  assert.equal(app.rooms.roomCount, before);
  await a.close();
});

test('valida entradas: nombre vacío y JSON incorrecto', async () => {
  const c = await client();
  c.send('create', { name: '   ' });
  assert.equal((await c.next('error')).code, 'BAD_REQUEST');
  c.ws.send('esto no es json');
  assert.equal((await c.next('error')).code, 'BAD_REQUEST');
  c.send('chat', { text: 'sin sala' });
  assert.equal((await c.next('error')).code, 'NOT_IN_ROOM');
  await c.close();
});
