# Arquitectura

```
 Navegador A ──WebSocket──┐                 ┌──WebSocket── Navegador B
   (app.js)               ├── Servidor Node ┤                (app.js)
                          │  salas, sesiones │
                          │  señalización    │
                          └──────────────────┘
 Navegador A ◄════════ WebRTC DataChannel (P2P) ════════► Navegador B
   ping/pong cada 1 s · prueba de mandos en vivo

 PC A: MK9 (Steam) ◄──── netcode del juego / streaming ────► PC B: MK9
```

## Por qué WebSocket + WebRTC

| Necesidad | Tecnología | Motivo |
|---|---|---|
| Salas, presencia, chat, estado | WebSocket (`ws`) | Necesita un servidor fiable y ordenado. Socket.IO no aporta nada imprescindible aquí y añade peso. |
| Latencia real entre jugadores | WebRTC DataChannel (no ordenado, sin reintentos) | Mide la ruta directa entre los dos equipos, que es la que importa para un juego de lucha. |
| Señalización WebRTC | Reenviada por el mismo WebSocket | No hace falta otro servicio. |
| NAT traversal | STUN público gratuito; TURN opcional (`ICE_SERVERS`) | Prototipo sin servicios de pago. |
| WebAssembly / WebGL | No se usan | No aportan nada sin poder ejecutar el juego (ver informe). |

## Protocolo (JSON por WebSocket, ruta `/ws`)

**Cliente → servidor:**
- `create {name}`
- `join {code,name}`
- `resume {token}`
- `leave`
- `update {name?,steam?,ready?}`
- `set-method {method}` (solo el anfitrión)
- `chat {text}`
- `ping {t}`
- `signal {data}`
- `relay-ping {t}`
- `relay-pong {t}`

**Servidor → cliente:**
- `welcome {serverTime, iceServers, reconnectGraceMs, methods}`
- `joined {token, playerId, room, chat}`
- `room {room}`
- `latency {players}`
- `chat {...}`
- `pong`
- `signal {from,data}`
- `relay-ping` / `relay-pong`
- `left`
- `error {code,message}`

**Códigos de error:** `ROOM_NOT_FOUND`, `ROOM_FULL`, `SESSION_EXPIRED`, `NOT_HOST`, `NOT_IN_ROOM`, `BAD_REQUEST`, `RATE_LIMITED`, `SERVER_FULL`, `INTERNAL`.

## Sesiones y reconexión

- Al entrar en una sala, el servidor entrega un **token secreto**. El navegador lo guarda en `sessionStorage`, por pestaña, para que dos pestañas puedan ser dos jugadores.
- **Si se cierra el WebSocket:** el jugador queda «desconectado» y su puesto se reserva `RECONNECT_GRACE_MS`. El cliente reintenta con espera exponencial (0,5 s → 8 s) y envía `resume {token}`.
- **Si la misma sesión se abre en otra pestaña:** gana la nueva y la anterior se cierra con el código `4001`.
- **Si vence el plazo:** el puesto se libera, el token se revoca y, si el anfitrión se fue, el otro jugador pasa a ser anfitrión.
- **Conexiones muertas:** el servidor envía un ping WebSocket cada `HEARTBEAT_MS`. El tiempo de respuesta es la latencia de cada jugador, y sin respuesta en `DEAD_AFTER_MS` la conexión se cierra.

## WebRTC

- Inicia la oferta el jugador con el `playerId` menor, para que solo la cree uno de los dos.
- Cada intento lleva un identificador de sesión, y se ignoran las señales de intentos anteriores.
- Si falla, se muestra «Reintentar conexión P2P», y la latencia se sigue midiendo por el relé del servidor.

## Seguridad

- Mensajes validados y limitados:
  - 16 KB por mensaje y 30 mensajes por segundo con ráfaga de 60
  - nombre: 24 caracteres
  - Steam: 64 caracteres
  - chat: 300 caracteres
  - caracteres de control eliminados
- La interfaz pinta los textos con `textContent`, nunca con `innerHTML`.
- El servidor estático impide el path traversal.
- Las salas inactivas se eliminan a las 6 horas.
