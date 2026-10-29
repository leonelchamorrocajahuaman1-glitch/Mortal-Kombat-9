// Guías para cada forma real de conectar dos jugadores de MK9.
// Esta web no ejecuta el juego: estos pasos se hacen en Steam / el juego / la aplicación indicada.

export const STEAM_APP_ID = 237110; // Mortal Kombat Komplete Edition

export const METHOD_GUIDES = {
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
    note: 'No está confirmado que el online de MK9 en PC siga activo: en 2020 se cerró el de PS3 y el juego se retiró de la tienda de Steam. Si no conecta, probad Steam Remote Play Together.',
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
    note: 'Esto es streaming de vídeo: el juego solo se ejecuta en el PC del anfitrión y se añade latencia. No hemos podido confirmar que Steam lo habilite para este juego.',
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
    note: 'Experimental: no está verificado que MK9 funcione online con RPCN. Exige un PC potente.',
  },
};
