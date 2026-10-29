// Guías para cada forma real de conectar dos jugadores de MK9.
// Esta web no ejecuta el juego: estos pasos se hacen en Steam / el juego / la aplicación indicada.

export const STEAM_APP_ID = 237110; // Mortal Kombat Komplete Edition

export const METHOD_GUIDES = {
  'web-stream': {
    streaming: true,
    whoNeedsGame: 'host',
    launch: `steam://run/${STEAM_APP_ID}`,
    steps: [
      'Solo el anfitrión necesita MK9 (Steam, Windows). El invitado solo necesita este navegador y su mando o teclado: no instala nada.',
      'Anfitrión: descarga el ayudante (abajo), instala Python 3 si no lo tienes y abre el ayudante con doble clic. La primera vez instala el controlador ViGEmBus: acéptalo.',
      'Anfitrión: abre MK9 en modo ventana o ventana sin bordes y entra en un combate versus local. El jugador 2 será el mando virtual del ayudante.',
      'Anfitrión: pulsa «Transmitir mi pantalla» y elige la ventana de MK9 (o la pantalla entera con «Compartir audio del sistema» para tener sonido).',
      'Invitado: el juego aparece aquí. Tu mando o teclado controla al jugador 2.',
    ],
    note: 'Es streaming: el juego solo se ejecuta en el PC del anfitrión y el invitado recibe vídeo (añade latencia, como Parsec). Probado entre navegadores con una pantalla y un mando simulados; el mando virtual en Windows con MK9 está pendiente de vuestra primera prueba.',
  },
  'steam-online': {
    streaming: false,
    whoNeedsGame: 'both',
    launch: `steam://run/${STEAM_APP_ID}`,
    steps: [
      'Ambos necesitáis Mortal Kombat Komplete Edition en vuestra biblioteca de Steam.',
      'Agregaos como amigos en Steam: cada uno escribe su nombre o código de amigo en «Tu perfil».',
      'Pulsad «Abrir MK9 en Steam» en los dos PCs.',
      'Dentro del juego, entrad en el modo online y cread una partida privada o invitad a vuestro amigo de Steam (Mayús+Tab abre la superposición de Steam).',
    ],
    note: 'Sin comprobar por nosotros: el juego se retiró de la tienda de Steam en marzo de 2020 y ese año se cerró el online de PS3. En un hilo del foro de Steam con respuestas de hace menos de un año, un jugador afirma que el online de PC sigue funcionando, aunque con pocas partidas. Para jugar con un amigo, usad la invitación de Steam en lugar de la búsqueda. Si no conecta, usad Remote Play Together o Parsec.',
  },
  'remote-play': {
    streaming: true,
    whoNeedsGame: 'host',
    launch: `steam://run/${STEAM_APP_ID}`,
    steps: [
      'Solo el anfitrión necesita el juego; el invitado necesita Steam.',
      'El anfitrión abre MK9 y entra en un combate versus local para dos jugadores.',
      'El anfitrión pulsa Mayús+Tab → Remote Play Together y elige a su amigo.',
      'El invitado acepta la invitación y controla al jugador 2 con su teclado o mando.',
    ],
    note: 'Esto es streaming de vídeo: el juego solo se ejecuta en el PC del anfitrión y se añade latencia. Sitios que recogen las categorías de Steam (como SteamSpy) incluyen «Remote Play Together» para este juego; no lo hemos probado.',
  },
  parsec: {
    streaming: true,
    whoNeedsGame: 'host',
    launch: `steam://run/${STEAM_APP_ID}`,
    steps: [
      'Ambos instaláis Parsec (gratuito para uso personal) desde parsec.app.',
      'El anfitrión abre MK9 en modo versus local y comparte su equipo con el invitado desde Parsec.',
      'El invitado se conecta y usa su mando como jugador 2.',
    ],
    note: 'Esto es streaming de vídeo: el juego solo se ejecuta en el PC del anfitrión.',
  },
  rpcs3: {
    streaming: false,
    whoNeedsGame: 'both',
    launch: null,
    steps: [
      'Ambos instaláis RPCS3 (rpcs3.net) y el firmware oficial de PS3 descargado de la web de Sony.',
      'Cada uno usa un volcado de su propio disco de MK9 para PS3.',
      'Configurad una cuenta RPCN en RPCS3 (Configuración → Red) y abrid el juego.',
      'Entrad en el modo online del juego para buscar a vuestro rival.',
    ],
    note: 'Muy experimental: no hemos encontrado constancia de que MK9 esté entre los juegos compatibles con RPCN, y los informes públicos de compatibilidad del emulador con este juego son antiguos. Exige un PC potente y hacer tú mismo el volcado de tu disco.',
  },
};
