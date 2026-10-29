# MK9 Lobby Companion

Plataforma web de **salas privadas para organizar partidas online de Mortal Kombat 9 (Komplete Edition)** entre dos jugadores.

> **Qué es y qué no es.** Esta web **no ejecuta el juego** ni lo incluye. Mortal Kombat 9 es un ejecutable nativo de Windows (Unreal Engine 3) y no puede funcionar dentro de un navegador (ver [`docs/INFORME-VIABILIDAD.md`](docs/INFORME-VIABILIDAD.md)).
> La web sirve para:
> - reunir a los dos jugadores,
> - comprobar que ambos están conectados,
> - medir la latencia real entre sus equipos,
> - probar los mandos en vivo,
> - guiar la conexión del juego.
>
> El combate ocurre en el juego instalado en cada PC.
>
> Proyecto no oficial y sin afiliación con Warner Bros. Games ni NetherRealm Studios. Cada jugador necesita su propia copia legítima del juego.

**Índice:**
1. [Funciones](#funciones)
2. [Requisitos](#requisitos)
3. [Instalación en Windows](#instalación-en-windows)
4. [Ejecución desde Visual Studio Code](#ejecución-desde-visual-studio-code)
5. [Configuración del servidor](#configuración-del-servidor)
6. [Despliegue en Internet](#despliegue-en-internet)
7. [Cómo invitar a un amigo](#cómo-invitar-a-un-amigo)
8. [Cómo probar los mandos](#cómo-probar-los-mandos)
9. [Cómo conectar el juego](#cómo-conectar-el-juego)
10. [Pruebas](#pruebas)
11. [Limitaciones conocidas](#limitaciones-conocidas)
12. [Solución de errores frecuentes](#solución-de-errores-frecuentes)
13. [Estructura del proyecto](#estructura-del-proyecto)

## Funciones

| Función | Cómo funciona |
|---|---|
| Salas privadas | El servidor genera un código de 6 caracteres (sin 0/O ni 1/I/L). Máximo 2 jugadores. |
| Invitación | Código o enlace `https://tu-servidor/?sala=CODIGO`. El enlace rellena el código automáticamente. |
| Estado de conexión | Indicador en la barra superior (WebSocket) y estado de cada jugador en su tarjeta. |
| Latencia | Tú ↔ servidor, rival ↔ servidor, **directa P2P** (WebRTC) y vía servidor (relé). Incluye una valoración para juegos de lucha. |
| Desconexiones | Si se cae un jugador, su puesto se reserva 60 s con cuenta atrás. Al recargar o recuperar la red, se reconecta solo. |
| Listo / método | Cada jugador marca «Listo». El anfitrión elige el método de conexión, y la web indica si usa streaming o juego local. |
| Abrir el juego | Botón `steam://run/237110`, que abre MK9 instalado en Steam. Si Steam no responde en 3 s, la web lo avisa. |
| Prueba de mandos en vivo | Lo que pulsas (teclado o mando) se ilumina en la pantalla del rival en tiempo real, por P2P o por el servidor si el P2P falla. |
| Controles | Teclado y mandos (Gamepad API): detección de mandos, asignación por acción y prueba en vivo. Se guarda en el navegador. **No cambia los controles del juego.** |
| Chat de sala | Mensajes de texto y avisos del sistema (entradas, salidas, desconexiones). |

## Requisitos

- **Windows 10/11**
- **[Node.js](https://nodejs.org/) 18.17 o superior** (recomendado: 22 LTS, el que se usa en producción)
- **[Visual Studio Code](https://code.visualstudio.com/)**
- **[Git para Windows](https://git-scm.com/download/win)**
- Un navegador moderno: Chrome, Edge o Firefox actualizado
- Para jugar: *Mortal Kombat Komplete Edition* en tu biblioteca de Steam, según el método elegido (ver [Cómo conectar el juego](#cómo-conectar-el-juego))

## Instalación en Windows

1. **Instala Node.js 22 LTS** desde <https://nodejs.org/> con las opciones por defecto. Cierra y vuelve a abrir cualquier terminal, y comprueba la versión:
   ```bash
   node -v
   ```
2. **Instala Git para Windows** (opciones por defecto).
3. **Clona el proyecto** en la carpeta que prefieras:
   ```bash
   git clone -b claude/nice-carson-p57g80 https://github.com/leonelchamorrocajahuaman1-glitch/Mortal-Kombat-9.git
   ```
   El código está en la rama `claude/nice-carson-p57g80`. Si ya la has fusionado en `main`, omite `-b claude/nice-carson-p57g80`.
4. **Instala las dependencias** dentro de la carpeta del proyecto:
   ```bash
   cd Mortal-Kombat-9
   ```
   ```bash
   npm install
   ```

## Ejecución desde Visual Studio Code

1. *Archivo → Abrir carpeta…* → elige `Mortal-Kombat-9`.
2. Abre la terminal integrada: *Terminal → Nueva terminal* (``Ctrl+` ``).
3. Arranca el servidor:
   ```bash
   npm start
   ```
   Verás `MK9 Lobby Companion escuchando en http://localhost:3000`.
4. Abre <http://localhost:3000> en el navegador.
5. Para detener el servidor, pulsa `Ctrl+C` en la terminal.

| Comando | Para qué |
|---|---|
| `npm start` | Arranca el servidor |
| `npm run dev` | Arranca el servidor y lo reinicia al guardar cambios |
| `npm test` | Pruebas automáticas del servidor (servidor real + clientes WebSocket reales) |
| `npm run test:e2e` | Prueba con dos navegadores reales; requiere Playwright (ver [Pruebas](#pruebas)) |

**Probar solo en tu PC:** abre una ventana normal y otra de incógnito. Crea la sala en una y únete con el código en la otra. Cada ventana es un jugador.

## Configuración del servidor

El servidor se configura con variables de entorno; tienes un ejemplo comentado en [`.env.example`](.env.example). El servidor **no** lee el archivo `.env` automáticamente: las variables se definen en el sistema o en el panel del hosting. **No subas contraseñas, tokens ni credenciales TURN al repositorio**: `.env` ya está en `.gitignore`.

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto HTTP/WebSocket. Los servicios de hosting lo asignan solos. |
| `HOST` | `0.0.0.0` | Interfaz de escucha |
| `NODE_ENV` | — | `production` en el hosting (solo informativo en los registros) |
| `RECONNECT_GRACE_MS` | `60000` | Tiempo que se reserva el puesto de un jugador desconectado |
| `HEARTBEAT_MS` | `2000` | Intervalo del latido (medición de latencia) |
| `DEAD_AFTER_MS` | `10000` | Sin respuesta durante este tiempo, la conexión se da por perdida |
| `MAX_ROOMS` | `500` | Máximo de salas simultáneas |
| `ROOM_IDLE_MS` | `21600000` | Las salas sin nadie conectado e inactivas se eliminan pasado este tiempo (6 h) |
| `ALLOWED_ORIGINS` | vacío | Lista separada por comas, p. ej. `https://mk9-lobby-companion.onrender.com`. Rechaza WebSockets abiertos desde otras webs. |
| `ICE_SERVERS` | STUN de Google | JSON con servidores STUN/TURN para WebRTC |

Ejemplo en PowerShell:
```bash
$env:PORT=8080; npm start
```

Ejemplo en Command Prompt (cmd):
```bash
set PORT=8080 && npm start
```

**Endpoints:**
- `GET /health` → `{"ok":true,"rooms":N,"uptime":S}`, usado por el hosting para saber si el servicio está vivo.
- `/ws` → WebSocket.

**Seguridad incluida:**
- cabeceras CSP, `X-Frame-Options` y `nosniff`;
- límite de tamaño (16 KB) y de frecuencia de mensajes (30 por segundo);
- validación de todos los textos;
- protección contra *path traversal* y contra URLs mal codificadas.

## Despliegue en Internet

### Opción recomendada: Render (gratuito)

Render ejecuta servidores Node.js persistentes con WebSockets y HTTPS automático, sin tarjeta en el plan gratuito. Desde febrero de 2026 los mensajes WebSocket cuentan como actividad, así que una sala abierta mantiene el servidor despierto (el latido de la web envía uno cada 2 s). El repositorio incluye [`render.yaml`](render.yaml), así que no hay que configurar nada a mano.

1. Crea una cuenta en <https://render.com> con **Sign in with GitHub**.
2. Autoriza a Render a leer el repositorio `Mortal-Kombat-9`.
3. En el panel, elige **New → Blueprint**, selecciona el repositorio y la rama `claude/nice-carson-p57g80` (o `main` si la has fusionado), y pulsa **Apply**.
4. Espera a que el despliegue termine en verde (2–4 minutos). Tu URL será del tipo `https://mk9-lobby-companion.onrender.com` (Render puede añadir un sufijo si el nombre está ocupado).
5. Comprueba `https://TU-URL/health`: debe responder `{"ok":true,...}`.
6. Opcional: en *Environment*, pon `ALLOWED_ORIGINS=https://TU-URL` y guarda.

Si prefieres no usar el Blueprint, crea un **New → Web Service** con:
- **Build:** `npm ci --omit=dev`
- **Start:** `npm start`
- **Health check path:** `/health`
- **Instance type:** Free

**Limitaciones del plan gratuito de Render:**
- Tras 15 minutos sin tráfico el servicio se duerme. La primera visita después tarda alrededor de un minuto en despertarlo.
- Un reinicio o un nuevo despliegue borra las salas abiertas, porque viven en memoria. Los jugadores vuelven a la portada con el código rellenado y basta con crear la sala otra vez.

Puedes probar el despliegue desde tu PC con la prueba de navegadores:
```bash
$env:BASE_URL="https://TU-URL"; npm run test:e2e
```

### Alternativas

| Servicio | Sirve | Notas |
|---|---|---|
| **Render (Free)** | Sí, recomendado | Usa `render.yaml`. Se duerme tras 15 min sin tráfico. |
| **Koyeb** | Sí, con el [`Dockerfile`](Dockerfile) | El plan gratuito se duerme tras 1 h sin tráfico. Las condiciones para cuentas nuevas han cambiado (algunas fuentes indican que piden tarjeta): revísalas antes. |
| **Fly.io / VPS / cualquier Docker** | Sí, con el `Dockerfile` | Fly.io pide tarjeta. |
| **Tu PC + Cloudflare Tunnel** | Sí, para una tarde de juego | Ejecuta `npm start` y, en otra terminal, `cloudflared tunnel --url http://localhost:3000` ([descarga de cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)). Te da una URL `https://….trycloudflare.com` temporal mientras tu PC esté encendido. |
| Netlify, Vercel, GitHub Pages | **No** | Solo alojan webs estáticas o funciones sin servidor persistente: no mantienen WebSockets. |

### HTTPS, NAT, cortafuegos y P2P

- **HTTPS es necesario en Internet.** La web usa `wss://` automáticamente cuando se abre con `https://`. Los mandos (Gamepad API) y el botón «Copiar» solo funcionan en `https://` o en `localhost`. Si abres la web por IP (`http://192.168.x.x:3000`), aparece un aviso.
- **WebSocket** funciona detrás del proxy HTTPS de Render: verificado localmente con un proxy TLS equivalente (ver [Pruebas](#pruebas)).
- **WebRTC (P2P)** atraviesa la mayoría de routers domésticos con STUN. Falla con NAT simétrico o CG-NAT, frecuentes en redes móviles, de empresa o de universidad, y con cortafuegos que bloquean UDP. En ese caso la web muestra «No disponible», ofrece «Reintentar conexión P2P» y sigue midiendo por el relé del servidor. La solución definitiva es un servidor **TURN**: un [coturn](https://github.com/coturn/coturn) propio en un VPS, o un plan gratuito de un proveedor TURN. Se configura con `ICE_SERVERS` en el panel del hosting, nunca en el repositorio.
- **Cortafuegos de Windows:** con `npm start` en tu PC, Windows puede preguntar si Node.js puede usar la red. Acéptalo para «Redes privadas» si vas a probar desde otro dispositivo de tu red local.
- **El juego usa su propia red.** La latencia P2P medida es una buena referencia de la ruta entre vuestros equipos, pero MK9, Steam o Parsec pueden usar otra ruta.

## Cómo invitar a un amigo

1. Abre la web (tu URL de Render, por ejemplo), escribe tu nombre y pulsa **Crear sala privada**.
2. Pulsa **Copiar enlace de invitación** y envíaselo por WhatsApp, Discord, etc. También puedes dictarle el código de 6 caracteres.
3. Tu amigo abre el enlace, escribe su nombre y pulsa **Jugar · unirse a la sala**. También puede escribir el código en «Unirse».
4. En cuanto entre, veréis las dos tarjetas «Conectado» y la latencia entre vosotros.

## Cómo probar los mandos

1. Conecta el mando (USB o Bluetooth) y **pulsa cualquier botón**: los navegadores no muestran el mando hasta que se pulsa algo.
2. Abre **Controles** (arriba a la derecha). En la lista debe aparecer «Mando 1: …».
3. En la pestaña **Mando** o **Teclado**, pulsa cada botón: la acción correspondiente se ilumina. Para cambiar una asignación, haz clic en ella y pulsa el botón o la tecla nueva (Esc cancela).
4. Dentro de una sala, el panel **Prueba de mandos en vivo** muestra lo que pulsas tú y lo que pulsa tu rival, en tiempo real.
5. Configura la misma asignación dentro de MK9 (menú de opciones del juego): esta web **no** cambia los controles del juego.

Mandos tipo Xbox y PlayStation usan la asignación estándar del navegador. Algunos mandos genéricos no la siguen: reasígnalos desde la tabla.

## Cómo conectar el juego

Dentro de la sala, el anfitrión elige el método y la web muestra los pasos. Resumen:

| Método | ¿Streaming? | Quién necesita el juego | Estado (investigado en octubre de 2026) |
|---|---|---|---|
| **Online oficial de MK9 (Steam)** | No: el juego corre en cada PC | Ambos, en su biblioteca de Steam | **Sin confirmar.** El juego se retiró de la tienda de Steam en marzo de 2020 y ese año se cerró el online de PS3. Sobre el PC hay informes contradictorios y no hemos encontrado ninguna confirmación reciente. Pruébalo primero. |
| **Steam Remote Play Together** | **Sí:** solo el anfitrión ejecuta el juego | Solo el anfitrión | Funciona con juegos de Steam que tengan versus local. No hemos podido confirmar que Steam lo active para este juego. |
| **Parsec** | **Sí:** solo el anfitrión ejecuta el juego | Solo el anfitrión | Funciona con cualquier juego de PC. Gratuito para uso personal. |
| **RPCS3 + RPCN** | No: el emulador corre en cada PC | Ambos, con un volcado de **su propio** disco de PS3 | **Muy experimental.** No hay constancia de que MK9 sea compatible con RPCN. |

**Botón «Abrir MK9 en Steam»:** abre `steam://run/237110`, el identificador de *Mortal Kombat Komplete Edition* en Steam.
- Si Steam está instalado y el juego en tu biblioteca, Steam lo abre (puede que el navegador pregunte antes si quieres abrir Steam).
- Si no pasa nada en 3 s, la web muestra un aviso.

Hemos verificado que el enlace es correcto y que aparece el aviso cuando no hay Steam. **No hemos podido probar que abra el juego**, porque el entorno de desarrollo no tiene Steam ni MK9. Hazlo en tu PC siguiendo [`docs/PRUEBAS.md`](docs/PRUEBAS.md).

No se incluyen, descargan ni modifican archivos del juego, ni se elude ninguna protección.

## Pruebas

**Automáticas del servidor:** 16 pruebas con el servidor real y clientes WebSocket reales.
```bash
npm test
```

**Con dos navegadores reales:** 15 comprobaciones.
```bash
npm install --no-save playwright
```
```bash
npx playwright install chromium
```
```bash
npm run test:e2e
```

Comprueba:
- crear una sala, unirse por código y por enlace, y que un tercero vea la sala llena;
- WebRTC P2P, latencias y chat;
- prueba de mandos en vivo (teclado y gamepad virtual) y reasignación;
- «Listo», el método de conexión y el botón de Steam;
- reconexión tras recargar y tras un corte de red;
- vista móvil y ausencia de errores de JavaScript.

Detalles, y la lista para probar con dos PCs reales, en [`docs/PRUEBAS.md`](docs/PRUEBAS.md).

## Limitaciones conocidas

- La web **no ejecuta, controla ni sincroniza el juego**: eso lo hace el netcode de MK9 o el streaming. La «prueba de mandos en vivo» sincroniza entradas entre navegadores, no dentro del juego.
- El online de MK9 en PC no tiene rollback. Con latencias altas (más de 150 ms) se nota mucho.
- Sin servidor TURN, la conexión P2P puede fallar en redes con NAT estricto (ver arriba).
- Las salas viven en memoria: un reinicio del servidor las borra.
- En el plan gratuito de Render, el primer acceso tras 15 minutos de inactividad tarda alrededor de un minuto.
- Las pruebas automáticas usan dos navegadores en un mismo equipo y un mando virtual. Faltan la prueba entre dos PCs de redes distintas y la prueba con mandos físicos (ver `docs/PRUEBAS.md`).

## Solución de errores frecuentes

| Problema | Solución |
|---|---|
| `"node" no se reconoce como un comando…` | Node.js no está instalado o la terminal se abrió antes de instalarlo. Instálalo y abre una terminal nueva (en VS Code, cierra y vuelve a abrir VS Code). |
| PowerShell: `…no se puede cargar porque la ejecución de scripts está deshabilitada` | Cambia la terminal de VS Code a **Command Prompt** (flecha junto a `+`), o ejecuta una vez `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. |
| `Error: listen EADDRINUSE :::3000` | Otro programa usa el puerto 3000 (quizá otro `npm start`). Ciérralo o usa otro puerto: `$env:PORT=3001; npm start`. |
| La barra superior se queda en «Reconectando…» | El servidor está apagado, o en Render se está despertando (espera alrededor de un minuto). Comprueba `/health`. |
| «La sesión anterior ha caducado» | El servidor se reinició o pasaron más de 60 s desconectado. El código queda rellenado: vuelve a crear o unirte a la sala. |
| «La sala ya tiene dos jugadores» | Ya hay dos personas dentro. Si una eres tú en otra pestaña, ciérrala: cada pestaña cuenta como un jugador. |
| «Directa P2P: No disponible» | Red con NAT estricto o UDP bloqueado. Pulsa «Reintentar conexión P2P». Si persiste, la latencia se mide por el servidor. Para P2P garantizado, configura TURN (`ICE_SERVERS`). |
| No aparece el mando | Pulsa un botón del mando con la pestaña activa. Usa `https://` o `localhost`. Prueba con Chrome o Edge. |
| El botón «Abrir MK9 en Steam» no hace nada | Steam no está instalado o no está abierto, o el juego no está en tu biblioteca. Acepta el diálogo «¿Abrir Steam?» del navegador si aparece. |
| El modo online de MK9 no encuentra partidas | Posiblemente los servidores ya no estén activos (sin confirmar). Cambia el método a Remote Play Together o Parsec. |
| Render: el despliegue falla en `npm ci` | Asegúrate de que `package-lock.json` está en el repositorio (lo está) y de que la rama elegida es la correcta. |

## Estructura del proyecto

```
├── server/                 Servidor multijugador (Node.js)
│   ├── index.js            HTTP estático + WebSocket, latido, límites, cabeceras de seguridad
│   ├── rooms.js            Sistema de salas (crear, unirse, reconexión, anfitrión, limpieza)
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
├── test/server.test.js     Pruebas del servidor (npm test)
├── scripts/e2e-browser.cjs Prueba con dos navegadores (npm run test:e2e)
├── render.yaml             Despliegue en Render (Blueprint)
├── Dockerfile              Despliegue con contenedor (Koyeb, Fly.io, VPS…)
├── .env.example            Variables de entorno de ejemplo (sin secretos)
└── docs/
    ├── INFORME-VIABILIDAD.md   Por qué MK9 no puede ejecutarse en el navegador
    ├── ARQUITECTURA.md         Diseño técnico y protocolo
    └── PRUEBAS.md              Pruebas realizadas y lista para dos PCs
```
