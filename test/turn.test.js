// Pruebas del proveedor de servidores ICE con un fetch simulado.
// No contactan con Cloudflare: verifican la petición, el filtrado, la caché y la vuelta a STUN.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIceProvider } from '../server/turn.js';

const STUN = [{ urls: ['stun:stun.l.google.com:19302'] }];
const quiet = { warn() {} };

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return { ok: next.status === 200, status: next.status, json: async () => next.body };
  };
  fn.calls = calls;
  return fn;
}

test('sin TURN configurado devuelve los servidores estáticos sin llamar a la red', async () => {
  const fetchImpl = fakeFetch([]);
  const ice = createIceProvider({ staticServers: STUN, fetchImpl, log: quiet });
  assert.equal(ice.turnEnabled, false);
  assert.deepEqual(await ice.get(), STUN);
  assert.equal(fetchImpl.calls.length, 0);
});

test('pide credenciales con el token en la cabecera y descarta el puerto 53', async () => {
  const body = {
    iceServers: [
      { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
      {
        urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'],
        username: 'u',
        credential: 'c',
      },
    ],
  };
  const fetchImpl = fakeFetch([{ status: 200, body }]);
  const ice = createIceProvider({ staticServers: STUN, turnKeyId: 'KEY', turnApiToken: 'SECRETO', fetchImpl, log: quiet });
  const servers = await ice.get();
  const [{ url, init }] = fetchImpl.calls;
  assert.equal(url, 'https://rtc.live.cloudflare.com/v1/turn/keys/KEY/credentials/generate-ice-servers');
  assert.equal(init.headers.Authorization, 'Bearer SECRETO');
  assert.equal(JSON.parse(init.body).ttl, 86400);
  assert.deepEqual(servers[0].urls, ['stun:stun.cloudflare.com:3478']);
  assert.deepEqual(servers[1].urls, ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp']);
  assert.equal(servers[1].credential, 'c');
  assert.ok(!JSON.stringify(servers).includes('SECRETO'), 'el token no llega a los navegadores');
});

test('acepta el formato antiguo (iceServers como objeto)', async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: { iceServers: { urls: ['turn:t.example:3478'], username: 'u', credential: 'c' } } }]);
  const ice = createIceProvider({ staticServers: STUN, turnKeyId: 'K', turnApiToken: 'T', fetchImpl, log: quiet });
  assert.deepEqual((await ice.get())[0].urls, ['turn:t.example:3478']);
});

test('reutiliza las credenciales hasta la mitad de su vida y luego las renueva', async () => {
  let now = 0;
  const ok = { status: 200, body: { iceServers: [{ urls: ['turn:t.example:3478'], username: 'u', credential: 'c' }] } };
  const fetchImpl = fakeFetch([ok, ok]);
  const ice = createIceProvider({ staticServers: STUN, turnKeyId: 'K', turnApiToken: 'T', ttlSeconds: 100, fetchImpl, now: () => now, log: quiet });
  await Promise.all([ice.get(), ice.get(), ice.get()]);
  assert.equal(fetchImpl.calls.length, 1, 'peticiones simultáneas comparten una sola llamada');
  now = 49_000;
  await ice.get();
  assert.equal(fetchImpl.calls.length, 1);
  now = 51_000;
  await ice.get();
  assert.equal(fetchImpl.calls.length, 2);
});

test('si Cloudflare falla, vuelve a STUN y lo reintenta en la siguiente conexión', async () => {
  const fetchImpl = fakeFetch([{ status: 401, body: {} }, new Error('red caída'), { status: 200, body: { iceServers: [{ urls: ['turn:t.example:3478'] }] } }]);
  const ice = createIceProvider({ staticServers: STUN, turnKeyId: 'K', turnApiToken: 'T', fetchImpl, log: quiet });
  assert.deepEqual(await ice.get(), STUN);
  assert.deepEqual(await ice.get(), STUN);
  assert.deepEqual((await ice.get())[0].urls, ['turn:t.example:3478']);
});
