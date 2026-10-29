# Informe de viabilidad: Mortal Kombat 9 (2011) en el navegador

Resumen de la investigación previa a la implementación. Solo se ha investigado: el juego no se ha probado (no había una copia disponible en el entorno de desarrollo).

## 1. ¿Puede ejecutarse MK9 directamente en un navegador?

**No.**

| Versión | Qué es técnicamente | Motivo |
|---|---|---|
| PC (Komplete Edition, 2013) | Ejecutable x86 de Windows, Unreal Engine 3, Direct3D, protegido con Steam | WebAssembly no ejecuta `.exe`. Haría falta emular x86 en WASM, reimplementar Windows (estilo Wine) y traducir Direct3D a WebGL/WebGPU. Proyectos como Boxedwine o v86 lo consiguen con juegos 2D o 3D muy antiguos, no con un juego UE3. Además obligaría a tocar la protección de Steam. |
| PS3 / Xbox 360 | Binarios Cell / PowerPC | Los emuladores (RPCS3, Xenia) necesitan JIT, SIMD avanzado y acceso directo a la GPU. No existe ningún port a WASM. |
| PS Vita | Binario ARM | No hay emulador de Vita en navegador. |

La única vía real sería recompilar el código fuente, que es privado (Warner Bros./NetherRealm).

## 2. ¿Existen proyectos que lo permitan?

No se ha encontrado ninguno. Contexto:
- El juego se retiró de la tienda de Steam en 2020.
- El online de PS3 se cerró.
- El estado del online de PC es contradictorio según las fuentes.

## 3. Formas reales de jugar a distancia

1. **Juego local en cada PC + online oficial.** Sin streaming. Depende de que los servidores sigan activos.
2. **RPCS3 + RPCN.** Sin streaming. Experimental y no verificado con MK9.
3. **Streaming** (Steam Remote Play Together, Parsec). Funciona, pero el juego solo corre en el PC del anfitrión.

## 4. Decisión

Se construye un **Lobby Companion**: salas, invitaciones, estado de conexión, latencia real P2P, prueba de mandos y guía de conexión. El juego se ejecuta fuera del navegador, en el PC de cada jugador.

## Aspectos legales

- No se distribuye ni se modifica el juego.
- No se usan logotipos, personajes, arte ni sonidos de la franquicia. Todo el arte de la web es original.
- El nombre del juego solo se usa para identificar con qué título es compatible la herramienta.

## Fuentes

- https://techraptor.net/gaming/news/mortal-kombat-komplete-edition-taken-down-online-shut-down
- https://www.eventhubs.com/news/2020/mar/22/mortal-kombat-2011-no-longer-available-download-digitally-xbox-360-and-steam-online-multiplayer-servers-shutting-down-ps3
- https://delistedgames.com/?p=10097
- https://steamcommunity.com/app/237110/discussions/0/3150808675341450251
- https://www.gamesradar.com/ps3-emulator-devs-have-a-massive-update-on-netplay-touting-online-support-for-co-op-metal-gear-classic-fighting-games-and-more

## Actualización (octubre de 2026)

- **Online de PC:** no se ha encontrado ninguna confirmación reciente de que siga activo. Las fuentes de 2020 se contradicen sobre si el cierre afectó solo a PS3. Hay que comprobarlo con el juego.
- **RPCS3 + RPCN:** la lista de juegos activos de RPCN no incluye MK9. Los informes públicos de compatibilidad del emulador con este juego son de 2017–2018.
- **Hosting de la web:** se elige Render (plan gratuito con WebSockets; desde febrero de 2026 los mensajes WebSocket cuentan como actividad). Koyeb queda como alternativa con el Dockerfile.

Fuentes adicionales:
- https://render.com/changelog/free-web-services-now-remain-active-while-receiving-websocket-messages
- https://render.com/docs/free
- https://www.rpcs3.net/rpcn
- https://forums.rpcs3.net/printthread.php?tid=177156
- https://eteknix.com/mortal-kombat-komplete-edition-is-given-a-fatality-on-steam/amp

## Actualización (finales de octubre de 2026)

- **Online de PC:** en un hilo del foro de Steam con respuestas de hace menos de un año, un jugador afirma que el online sigue funcionando (búsqueda en todo el mundo, poca gente). Es un informe anecdótico, no verificado.
- **Remote Play Together:** SteamSpy y otros sitios que recogen las categorías de Steam lo incluyen para la app 237110. No se ha probado.
- **Navegador:** sin cambios. No existe ninguna implementación de MK9 en el navegador.

Fuentes:
- https://steamcommunity.com/app/237110/discussions/0/690870825661970524/
- https://www.steamspy.com/app/237110
- https://developers.cloudflare.com/realtime/turn/faq/
- https://developers.cloudflare.com/realtime/pricing/
