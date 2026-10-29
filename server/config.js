// Configuración del servidor. Todo se puede sobrescribir con variables de entorno.

function int(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function iceServers() {
  // ICE_SERVERS admite un JSON con el formato de RTCConfiguration.iceServers,
  // por ejemplo para añadir un servidor TURN propio.
  if (process.env.ICE_SERVERS) {
    try {
      return JSON.parse(process.env.ICE_SERVERS);
    } catch {
      console.warn('[config] ICE_SERVERS no es JSON válido; se usa el STUN por defecto.');
    }
  }
  return [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
}

export const config = {
  port: int('PORT', 3000),
  host: process.env.HOST ?? '0.0.0.0',
  // Tiempo que se reserva el puesto de un jugador desconectado.
  reconnectGraceMs: int('RECONNECT_GRACE_MS', 60_000),
  // Intervalo del latido WebSocket (mide la latencia y detecta conexiones muertas).
  heartbeatMs: int('HEARTBEAT_MS', 2_000),
  // Sin respuesta durante este tiempo, la conexión se da por perdida.
  deadAfterMs: int('DEAD_AFTER_MS', 10_000),
  maxRooms: int('MAX_ROOMS', 500),
  // Salas sin actividad se eliminan pasado este tiempo.
  roomIdleMs: int('ROOM_IDLE_MS', 6 * 60 * 60 * 1000),
  maxPayloadBytes: 16 * 1024,
  // Lista separada por comas, p. ej. "https://mk9-lobby.onrender.com". Vacía = cualquier origen.
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean),
  iceServers: iceServers(),
  // TURN de Cloudflare (opcional). Defínelos solo en el panel del hosting, nunca en el repositorio.
  turnKeyId: process.env.TURN_KEY_ID ?? '',
  turnApiToken: process.env.TURN_KEY_API_TOKEN ?? '',
};
