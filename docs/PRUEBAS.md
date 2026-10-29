# Pruebas

## Automáticas (`npm test`)

Levantan el servidor real y conectan clientes WebSocket reales. Comprueban:
- crear sala y unirse
- sala llena y código inexistente
- sincronización de listo, perfil, método y chat
- permisos del anfitrión
- reenvío de la señalización WebRTC y del ping por relé
- medición de latencia por latido
- desconexión con puesto reservado y reanudación con token
- caducidad del puesto
- traspaso de anfitrión
- borrado de salas vacías
- validación de entradas

## Comprobado en desarrollo (dos navegadores Chromium independientes, mismo equipo)

- Crear sala → invitar con enlace → unirse con «Jugar».
- P2P WebRTC conectado y latencia medida en ambos lados.
- Prueba de mandos: una tecla pulsada en B se ilumina en A vía P2P y se apaga al soltarla.
- Listo en ambos → «¡Ambos listos!». El invitado no puede cambiar el método. El chat llega al rival.
- Recarga de la página de B: vuelve a la misma sala y el P2P se restablece.
- Corte de red de B: A ve «Desconectado · 60 s». Al volver la red, B se reconecta solo.
- Diálogo de controles: detección de teclas en vivo y reasignación.
- Sin desbordamiento horizontal a 360 y 390 px de ancho.

**Aún no comprobado:**
- dos PCs en redes distintas
- mandos físicos
- lanzamiento real del juego

## Fase 6 — lista para probar en dos PCs

Pruebas de la web:
1. [ ] El PC A arranca el servidor y lo publica (túnel o hosting, ver README).
2. [ ] B abre el enlace de invitación desde otra red (por ejemplo, datos móviles compartidos).
3. [ ] Ambos ven al rival «Conectado» y una latencia en «Directa P2P». Si pone «No disponible», anota el tipo de red: hace falta TURN.
4. [ ] La prueba de mandos funciona en los dos sentidos con mando físico.
5. [ ] Desactivar el Wi-Fi de B 10 s: A ve la cuenta atrás y B vuelve solo.

Pruebas del juego:
6. [ ] «Abrir MK9 en Steam» abre el juego en ambos PCs.
7. [ ] Online oficial: ¿conecta el modo online de MK9? Anotar el resultado y la fecha.
8. [ ] Si no conecta: Remote Play Together o Parsec, y comparar la sensación con la latencia medida.

Apunta los resultados aquí para documentar qué método funciona hoy.
