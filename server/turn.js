// Servidores ICE (STUN/TURN) para WebRTC.
//
// Sin TURN, la conexión P2P falla en redes con NAT estricto (CG-NAT de operadores móviles,
// redes de empresa o universidad). Si se configuran TURN_KEY_ID y TURN_KEY_API_TOKEN (servicio
// TURN de Cloudflare, con un tramo gratuito mensual), el servidor pide credenciales temporales
// y las entrega a los navegadores. El token de la API nunca sale del servidor.

const CLOUDFLARE_URL = (keyId) =>
  `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`;

// Normaliza la respuesta: { iceServers: [...] } o { iceServers: {...} } (formato antiguo).
function parseIceServers(body) {
  const raw = body?.iceServers;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list
    .map((server) => {
      const urls = (Array.isArray(server.urls) ? server.urls : [server.urls])
        .filter((u) => typeof u === 'string')
        // Los navegadores bloquean el puerto 53 y su intento solo retrasa la conexión.
        .filter((u) => !/:53(\?|$)/.test(u));
      return urls.length ? { ...server, urls } : null;
    })
    .filter(Boolean);
}

export function createIceProvider({
  staticServers,
  turnKeyId,
  turnApiToken,
  ttlSeconds = 24 * 60 * 60,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  log = console,
}) {
  const enabled = Boolean(turnKeyId && turnApiToken);
  let cache = null; // { servers, expiresAt }
  let inflight = null;

  async function fetchTurn() {
    const res = await fetchImpl(CLOUDFLARE_URL(turnKeyId), {
      method: 'POST',
      headers: { Authorization: `Bearer ${turnApiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: ttlSeconds }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Cloudflare TURN respondió ${res.status}`);
    const servers = parseIceServers(await res.json());
    if (!servers.length) throw new Error('Cloudflare TURN no devolvió servidores');
    return servers;
  }

  return {
    turnEnabled: enabled,
    // Devuelve siempre una lista utilizable: si TURN falla, se usa la configuración estática (STUN).
    async get() {
      if (!enabled) return staticServers;
      // Se renuevan a mitad de vida para no entregar credenciales a punto de caducar.
      if (cache && now() < cache.expiresAt) return cache.servers;
      inflight ??= fetchTurn()
        .then((servers) => {
          cache = { servers, expiresAt: now() + (ttlSeconds * 1000) / 2 };
          return servers;
        })
        .catch((err) => {
          log.warn(`[turn] ${err.message}; se usa solo STUN.`);
          return staticServers;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
  };
}
