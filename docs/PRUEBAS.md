# Pruebas

## 1. Pruebas automáticas del servidor — `npm test`

23 pruebas (servidor real con clientes WebSocket reales, y proveedor TURN con respuestas simuladas) y clientes WebSocket reales. Comprueban:
- crear sala y unirse;
- sala llena y código inexistente;
- sincronización de listo, perfil, método y chat;
- permisos del anfitrión;
- reenvío de la señalización WebRTC y del ping por relé;
- latencia medida por latido;
- desconexión con puesto reservado y reanudación con token;
- caducidad del puesto;
- traspaso de anfitrión;
- borrado de salas vacías;
- validación de entradas;
- URL mal codificada (devuelve 400 y el servidor no se cae);
- cabeceras de seguridad y HEAD;
- *path traversal*;
- `ALLOWED_ORIGINS`;
- limpieza de salas abandonadas;
- recrear una sala con su código anterior (`CODE_TAKEN` si ya existe);
- servidores ICE entregados en la bienvenida y `turn` en `/health`;
- TURN de Cloudflare simulado: petición con token, filtrado del puerto 53, formato antiguo, caché y renovación, vuelta a STUN si falla. **No se ha probado contra Cloudflare real.**

## 2. Prueba con dos navegadores — `npm run test:e2e`

Dos navegadores Chromium **independientes** (contextos separados, sin almacenamiento compartido) **en el mismo equipo**. 17 comprobaciones:

1. La página carga y el WebSocket conecta.
2. Crear una sala.
3. Unirse escribiendo el código.
4. Abrir el enlace de invitación rellena el código; un tercer jugador recibe «sala llena».
5. Conexión directa WebRTC (DataChannel) en ambos navegadores.
6. Latencias: tú ↔ servidor, rival ↔ servidor, relé.
7. Chat en los dos sentidos.
8. Diagnóstico de red «Tu red»: tipos de candidato ICE del equipo.
9. Prueba de mandos en vivo: una tecla pulsada en B se ilumina en A (vía P2P) y se apaga al soltarla.
10. Mando: un gamepad **virtual** inyectado en la Gamepad API se detecta, su botón ilumina la acción en A y en B, y se puede reasignar.
11. «Listo» en ambos; solo el anfitrión cambia el método; la etiqueta streaming/local cambia en el otro navegador.
12. El botón del juego apunta a `steam://run/237110` y, sin Steam, aparece el aviso.
13. Recargar la página de B vuelve a la misma sala y rehace el P2P.
14. Corte de red de B: A ve «Desconectado · 60 s» y B se reconecta solo.
15. Reinicio real del servidor (se pierden las salas en memoria): A y B vuelven solos a la misma sala y rehacen el P2P. Solo con servidor local.
16. Vista móvil 390×844 sin desbordamiento horizontal.
17. Ninguna página produce errores de JavaScript.

### Resultados registrados (29/10/2026, entorno de desarrollo Linux, Node 22, Chromium de Playwright)

| Ejecución | Resultado |
|---|---|
| `npm test` | 29/29 superadas (incluye la Arena: determinismo, mecánicas, KO al mejor de 3 y rollback con 20 % de pérdida y desorden, idéntico a la referencia) |
| `npm run test:arena` | 10/10 superadas: combate entre dos navegadores por P2P y forzando el servidor; vida idéntica en ambas pantallas, 8 comparaciones de huella sin desincronización en cada modo |
| `npm run test:stream` (transmisión WebRTC + ayudante real en `--dry-run`) | 9/9 superadas: vídeo y audio recibidos y reproduciéndose; tecla U → X y botón A + cruceta + stick → mando virtual en unos 40 ms en el mismo equipo; vídeo recuperado tras recargar; parada correcta |
| `python helper/test_ayudante.py` | 4/4 superadas: estados, paquetes atrasados, soltar botones si se corta la red, rechazo de webs no permitidas |
| `npm run test:e2e` contra el servidor local (HTTP) | 17/17 superadas |
| `npm run test:e2e` tras un proxy TLS local (HTTPS + `wss://`, `NODE_ENV=production`, como el balanceador de Render) | 16/16 superadas (la prueba de reinicio se omite porque necesita controlar el servidor local) |
| Instalación desde cero (`git clone` + `npm ci` + `npm test`) | Superada |

### Qué NO cubren estas pruebas

- **Dos equipos en redes distintas.** En el mismo equipo, WebRTC conecta por la red local (`host`). Entre casas distintas hace falta atravesar NAT (`srflx`) o usar TURN (`relay`). En el entorno de desarrollo, el diagnóstico solo obtiene candidatos `host` porque su red bloquea UDP hacia STUN; en una conexión doméstica debería aparecer `srflx`.
- **Mandos físicos.** El mando virtual valida la lógica de la web, no los controladores de Windows ni un modelo concreto de mando.
- **Abrir el juego de verdad.** El entorno de pruebas no tiene Steam ni MK9.
- **El despliegue en Render.** No se pudo hacer desde el entorno de desarrollo. Cuando lo publiques, ejecuta la prueba contra tu URL:
  ```bash
  $env:BASE_URL="https://TU-URL"; npm run test:e2e
  ```

## 3. Lista para probar con dos PCs reales

Hacedla con un amigo en **redes distintas**: otra casa, o uno de los dos con datos móviles compartidos.

### Web

1. [ ] La web está publicada (Render o túnel) y `https://TU-URL/health` responde `{"ok":true,...}`.
2. [ ] PC A crea la sala; PC B abre el enlace de invitación y entra.
3. [ ] Antes de que entre el amigo, el panel «Tu red» de cada uno dice: A ______ / B ______ (pasa el ratón para ver los candidatos).
   [ ] Ambos ven al rival «Conectado» y un valor en «Directa P2P». Anotad la ruta (red local / directa / TURN). Si pone «No disponible», anotad el tipo de red: hace falta TURN.
4. [ ] Latencia P2P medida: ____ ms (A) / ____ ms (B).
5. [ ] El chat funciona en los dos sentidos.
6. [ ] Mando físico: aparece en «Controles» y la prueba en vivo se ve en el otro PC. Modelo de mando: ______
7. [ ] Desactivar el Wi-Fi de B 10 s: A ve la cuenta atrás y B vuelve solo.

### Jugar desde esta web (anfitrión con MK9)

- [ ] El ayudante muestra «modo vigem» y la sala dice «Conectado · mando virtual activo».
- [ ] En el «Panel de control → Dispositivos» de Windows aparece un mando de Xbox 360 nuevo.
- [ ] El invitado ve el juego. Latencia percibida: ______
- [ ] En versus local, el jugador 2 responde al mando o teclado del invitado.

### Juego

8. [ ] «Abrir MK9 en Steam» abre el juego en el PC A.
9. [ ] Ídem en el PC B.
10. [ ] Online oficial: ¿el modo online de MK9 conecta y permite invitar al amigo? Resultado y fecha: ______
11. [ ] Si no: Remote Play Together. ¿Steam ofrece la opción para este juego? Resultado: ______
12. [ ] Si no: Parsec. Resultado: ______

Apuntad aquí los resultados para documentar qué método funciona hoy.
