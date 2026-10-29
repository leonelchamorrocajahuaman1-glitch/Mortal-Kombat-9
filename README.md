# MK9 Lobby Companion

Plataforma web de **salas privadas para organizar partidas online de Mortal Kombat 9 (Komplete Edition)** entre dos jugadores.

> **Qué es y qué no es.** Esta web **no ejecuta el juego** ni lo incluye. Mortal Kombat 9 es un ejecutable nativo de Windows (Unreal Engine 3) y no puede funcionar dentro de un navegador. Ver [`docs/INFORME-VIABILIDAD.md`](docs/INFORME-VIABILIDAD.md).
> La web reúne a los dos jugadores, comprueba que ambos están conectados, mide la latencia real entre sus equipos, permite probar los mandos en vivo y guía la conexión. El combate ocurre en el juego instalado en cada PC.
>
> Proyecto no oficial y sin afiliación con Warner Bros. Games ni NetherRealm Studios. Cada jugador necesita su propia copia legítima del juego.

## Funciones

| Función | Cómo funciona |
|---|---|
| Salas privadas | El servidor genera un código de 6 caracteres (sin 0/O ni 1/I/L). Máximo 2 jugadores. |
| Invitación | Código o enlace `https://tu-servidor/?sala=CODIGO`. El enlace rellena el código automáticamente. |
| Estado de conexión | Indicador en la barra superior (WebSocket) y estado de cada jugador en su tarjeta. |
| Latencia | Tú ↔ servidor, rival ↔ servidor (latido del servidor), **directa P2P** (WebRTC DataChannel) y vía servidor (relé). Incluye una valoración para juegos de lucha. |
| Desconexiones | Si se cae un jugador, su puesto se reserva 60 s con cuenta atrás. Al recargar o recuperar la red, se reconecta solo. |
| Listo / método | Cada jugador marca «Listo». El anfitrión elige el método: online oficial, Remote Play Together, Parsec o RPCS3. Se muestran los pasos de cada uno. |
| Lanzar el juego | Botón `steam://run/237110`, que abre MK9 instalado en Steam. |
| Prueba de mandos en vivo | Lo que pulsas en tu teclado o mando se ilumina en la pantalla del rival en tiempo real, por P2P o por el servidor si el P2P falla. |
| Controles | Teclado y mandos (Gamepad API): asignación por acción, detección de mandos y prueba en vivo. Se guarda en el navegador. **No cambia los controles del juego.** |
| Chat de sala | Mensajes de texto y avisos del sistema (entradas, salidas, desconexiones). |

## Requisitos

- **Windows 10/11**
- **[Node.js](https://nodejs.org/) 18.17 o superior** (recomendado: la versión LTS)
- **[Visual Studio Code](https://code.visualstudio.com/)**
- **[Git](https://git-scm.com/download/win)** (opcional, para clonar)
- Un navegador moderno: Chrome, Edge o Firefox
- Para jugar: *Mortal Kombat Komplete Edition* en tu biblioteca de Steam, según el método elegido

## Instalación y ejecución en Windows con Visual Studio Code

1. **Instala Node.js LTS** desde <https://nodejs.org/> con las opciones por defecto. Comprueba la instalación en una terminal nueva:
   ```bash
   node -v
   ```
2. **Obtén el proyecto.** Puedes clonarlo:
   ```bash
   git clone https://github.com/leonelchamorrocajahuaman1-glitch/Mortal-Kombat-9.git
   ```
   o descargar el ZIP desde GitHub y descomprimirlo.
3. **Ábrelo en VS Code**: *Archivo → Abrir carpeta…* → carpeta `Mortal-Kombat-9`.
4. **Abre la terminal integrada**: *Terminal → Nueva terminal* (o ``Ctrl+` ``).
5. **Instala las dependencias** (solo la primera vez):
   ```bash
   npm install
   ```
6. **Arranca el servidor**:
   ```bash
   npm start
   ```
   Verás `MK9 Lobby Companion escuchando en http://localhost:3000`.
7. **Abre <http://localhost:3000>** en el navegador.

Para detener el servidor, pulsa `Ctrl+C` en la terminal.

> Si PowerShell bloquea `npm` con un error de *ejecución de scripts*, cambia la terminal de VS Code a **Command Prompt** (flecha junto al `+` de la terminal), o ejecuta una sola vez `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

### Otros comandos

| Comando | Para qué |
|---|---|
| `npm run dev` | Reinicia el servidor al guardar cambios |
| `npm test` | Ejecuta las pruebas automáticas (servidor real + dos clientes WebSocket) |

### Probar solo en un PC

Abre dos ventanas del navegador (una normal y otra privada/incógnito). Crea la sala en una y únete con el código en la otra. Cada pestaña es un jugador distinto.

## Jugar con un amigo por Internet

Tu amigo debe poder abrir tu servidor desde Internet. Hay dos opciones gratuitas.

### Opción A — Túnel desde tu PC (rápido, sin cuenta)

1. Arranca el servidor con `npm start`.
2. Descarga **cloudflared** para Windows desde <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/>.
3. En otra terminal, ejecuta:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
4. Cloudflare muestra una URL `https://xxxx.trycloudflare.com`. Ábrela tú, crea la sala y envía el enlace de invitación a tu amigo.

La URL cambia cada vez que reinicias el túnel, y el servidor solo está disponible mientras tu PC lo ejecuta.

### Opción B — Hospedarlo en un servicio gratuito

Funciona en cualquier servicio que ejecute Node.js y admita WebSockets (por ejemplo, el plan gratuito de Render: *New → Web Service*):

- Comando de build: `npm install`
- Comando de inicio: `npm start`

El servidor usa la variable `PORT` que asigne el servicio. Los planes gratuitos suelen «dormir» el servidor tras un rato sin uso, así que la primera visita puede tardar.

### Después: conectar el juego

Dentro de la sala, el anfitrión elige el **método de conexión** y la web muestra los pasos:

| Método | ¿Sin streaming? | Quién necesita el juego | Estado |
|---|---|---|---|
| Online oficial de MK9 (Steam) | Sí | Ambos | **No verificado** que los servidores sigan activos |
| Steam Remote Play Together | No (streaming) | Solo el anfitrión | Funciona con juegos de Steam con versus local; no confirmado para este juego |
| Parsec | No (streaming) | Solo el anfitrión | Funciona con cualquier juego de PC |
| RPCS3 + RPCN | Sí | Ambos (volcado propio de PS3) | Experimental, no verificado |

## Configuración (variables de entorno)

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto HTTP/WebSocket |
| `HOST` | `0.0.0.0` | Interfaz de escucha |
| `RECONNECT_GRACE_MS` | `60000` | Tiempo que se reserva el puesto de un jugador desconectado |
| `HEARTBEAT_MS` | `2000` | Intervalo del latido (medición de latencia) |
| `DEAD_AFTER_MS` | `10000` | Sin respuesta durante este tiempo, la conexión se da por perdida |
| `MAX_ROOMS` | `500` | Máximo de salas simultáneas |
| `ICE_SERVERS` | STUN de Google | JSON de `iceServers` para WebRTC; sirve para añadir un servidor TURN propio |

En PowerShell, por ejemplo:

```bash
$env:PORT=8080; npm start
```

## Estructura del proyecto

```
├── server/                 Servidor multijugador (Node.js)
│   ├── index.js            HTTP estático + WebSocket, latido, límites
│   ├── rooms.js            Sistema de salas (crear, unirse, reconexión, anfitrión)
│   ├── sessions.js         Gestión de sesiones (tokens de reconexión)
│   ├── protocol.js         Protocolo de mensajes y validación
│   └── config.js           Configuración por variables de entorno
├── public/                 Interfaz web (sin frameworks ni build)
│   ├── index.html
│   ├── css/styles.css
│   ├── assets/emblem.svg   Emblema original del proyecto
│   └── js/
│       ├── app.js          Controlador de la interfaz
│       ├── net.js          Comunicación con el servidor (WebSocket + reconexión)
│       ├── rtc.js          Comunicación directa entre jugadores (WebRTC)
│       ├── controls.js     Teclado y mandos (Gamepad API)
│       └── methods.js      Integración con el juego: métodos de conexión y lanzamiento
├── test/server.test.js     Pruebas de integración
└── docs/
    ├── INFORME-VIABILIDAD.md   Por qué MK9 no puede ejecutarse en el navegador
    ├── ARQUITECTURA.md         Diseño técnico y protocolo
    └── PRUEBAS.md              Lista de pruebas entre dos PCs (Fase 6)
```

## Limitaciones conocidas

- La web **no controla ni sincroniza el juego**. La sincronización del combate la hace el netcode de MK9 (o el streaming). La «prueba de mandos en vivo» sincroniza entradas entre navegadores; no dentro del juego.
- **P2P (WebRTC)** usa solo STUN gratuito. Con algunos NAT estrictos (redes móviles, redes corporativas) la conexión directa falla; la web lo indica y mide la latencia por el servidor. Para esos casos hace falta un servidor TURN propio (`ICE_SERVERS`).
- Las salas viven en memoria: si reinicias el servidor, se pierden.
- La **latencia P2P** medida es la de la red entre vuestros dos equipos. Es una buena referencia, pero el juego puede usar otra ruta.
