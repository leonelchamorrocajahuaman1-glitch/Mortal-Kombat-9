// Prueba de extremo a extremo con dos navegadores Chromium independientes (Playwright).
//
//   npm install --no-save playwright && npx playwright install chromium
//   npm run test:e2e                      -> arranca un servidor local temporal
//   BASE_URL=https://tu-app.onrender.com npm run test:e2e   -> prueba un despliegue real
//
// Los dos navegadores se ejecutan en el MISMO equipo: comprueba la web, el WebSocket, WebRTC y
// la reconexión, pero no sustituye a la prueba en dos PCs de redes distintas (docs/PRUEBAS.md).
// El mando se simula inyectando un gamepad virtual en la Gamepad API: valida la detección y el
// mapeo de la web, no un mando físico.

const path = require('node:path');
const { pathToFileURL } = require('node:url');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Falta Playwright. Instálalo con:\n  npm install --no-save playwright\n  npx playwright install chromium');
  process.exit(2);
}

const results = [];
async function check(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ ok: true, name });
    console.log(`  ✔ ${name}${detail ? ` — ${detail}` : ''} (${Date.now() - started} ms)`);
  } catch (err) {
    results.push({ ok: false, name });
    console.log(`  ✘ ${name}\n      ${String(err.message).split('\n')[0]}`);
  }
}

// Gamepad virtual: sustituye navigator.getGamepads por un mando estándar controlado desde la prueba.
const VIRTUAL_PAD = () => {
  const pad = {
    id: 'Mando virtual de prueba (STANDARD GAMEPAD)',
    index: 0,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
  };
  window.__pad = {
    connect() {
      navigator.getGamepads = () => [pad, null, null, null];
      window.dispatchEvent(new Event('gamepadconnected'));
    },
    press(i, down) {
      pad.buttons[i] = { pressed: down, touched: down, value: down ? 1 : 0 };
      pad.timestamp++;
    },
  };
  navigator.getGamepads = () => [null, null, null, null];
};

(async () => {
  let base = process.env.BASE_URL?.replace(/\/+$/, '');
  let server = null;
  let restartServer = null;
  if (!base) {
    const { startServer } = await import(pathToFileURL(path.join(__dirname, '..', 'server', 'index.js')).href);
    const opts = { host: '127.0.0.1', reconnectGraceMs: 60_000, deadAfterMs: 4000, heartbeatMs: 1000 };
    server = startServer({ ...opts, port: 0 });
    const port = await server.ready;
    base = `http://127.0.0.1:${port}`;
    // Simula un reinicio del hosting (redespliegue o el plan gratuito que se duerme): se pierden las salas.
    restartServer = async () => {
      await server.close();
      server = startServer({ ...opts, port });
      await server.ready;
    };
  }
  console.log(`Probando ${base}\n`);

  const browser = await chromium.launch();
  const pageErrors = [];
  const newPlayer = async (label, viewport = { width: 1280, height: 900 }) => {
    // IGNORE_HTTPS_ERRORS=1 permite probar tras un proxy HTTPS local con certificado autofirmado.
    const ctx = await browser.newContext({ viewport, ignoreHTTPSErrors: !!process.env.IGNORE_HTTPS_ERRORS });
    await ctx.addInitScript(VIRTUAL_PAD);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => pageErrors.push(`${label}: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && pageErrors.push(`${label}: ${m.text()}`));
    return { ctx, page };
  };
  const text = (page, sel) => page.textContent(sel).then((t) => t.trim());
  const waitText = (page, sel, re, timeout = 15000) =>
    page.waitForFunction(([s, r]) => new RegExp(r).test(document.querySelector(s)?.textContent ?? ''), [sel, re.source], { timeout });

  const A = await newPlayer('A');
  const B = await newPlayer('B');
  const C = await newPlayer('C');
  let code;

  await check('La página carga y el WebSocket conecta', async () => {
    await A.page.goto(base);
    await A.page.waitForSelector('#conn-status[data-state="open"]', { timeout: 60000 });
    return text(A.page, '#conn-status');
  });

  await check('Crear una sala', async () => {
    await A.page.fill('#player-name', 'Ana');
    await A.page.click('#btn-create');
    await A.page.waitForSelector('#view-room:not([hidden])');
    code = await text(A.page, '#room-code');
    if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error(`código inesperado: ${code}`);
    return `código ${code}`;
  });

  await check('Unirse escribiendo el código (navegador B)', async () => {
    await B.page.goto(base);
    await B.page.waitForSelector('#conn-status[data-state="open"]');
    await B.page.fill('#player-name', 'Beto');
    await B.page.fill('#join-code', code.toLowerCase());
    await B.page.click('#join-form button[type="submit"]');
    await B.page.waitForSelector('#view-room:not([hidden])');
    await waitText(A.page, '#slot-1', /Beto/);
  });

  await check('Una tercera persona con el enlace ve «sala llena»', async () => {
    await C.page.goto(`${base}/?sala=${code}`);
    await C.page.waitForSelector('#conn-status[data-state="open"]');
    if ((await C.page.inputValue('#join-code')) !== code) throw new Error('el enlace no rellenó el código');
    await C.page.fill('#player-name', 'Carla');
    await C.page.click('#btn-play');
    await waitText(C.page, '#toasts', /dos jugadores/);
  });

  await check('Conexión directa WebRTC (P2P) en ambos navegadores', async () => {
    await waitText(A.page, '#m-p2p', /ms/);
    await waitText(B.page, '#m-p2p', /ms/);
    return `A: ${await text(A.page, '#m-p2p')} · B: ${await text(B.page, '#m-p2p')}`;
  });

  await check('Latencias medidas (servidor, rival y relé)', async () => {
    await waitText(A.page, '#m-relay', /ms/);
    await waitText(A.page, '#m-peer', /ms/);
    const vals = await Promise.all(['#m-self', '#m-peer', '#m-relay'].map((s) => text(A.page, s)));
    return `tú ${vals[0]} · rival ${vals[1]} · relé ${vals[2]} · ${await text(A.page, '#quality-text')}`;
  });

  await check('Chat entre los dos jugadores', async () => {
    await A.page.fill('#chat-input', 'hola Beto');
    await A.page.press('#chat-input', 'Enter');
    await waitText(B.page, '#chat-log', /hola Beto/);
    await B.page.fill('#chat-input', 'hola Ana');
    await B.page.press('#chat-input', 'Enter');
    await waitText(A.page, '#chat-log', /hola Ana/);
  });

  await check('Prueba de mandos en vivo: teclado de B visible en A', async () => {
    await B.page.click('h3#h-input');
    await B.page.keyboard.down('KeyU');
    await A.page.waitForSelector('#input-peer .chip.on[data-action="fp"]', { timeout: 3000 });
    await B.page.keyboard.up('KeyU');
    await A.page.waitForFunction(() => !document.querySelector('#input-peer .chip.on'), null, { timeout: 3000 });
    return `ruta ${await text(A.page, '#input-route')}`;
  });

  await check('Diagnóstico de red WebRTC (tipos de candidato ICE de este equipo)', async () => {
    await A.page.waitForFunction(() => {
      const t = document.querySelector('#m-net')?.textContent ?? '';
      return t && t !== '—' && t !== 'Comprobando…';
    }, null, { timeout: 15000 });
    return `${await text(A.page, '#m-net')} (${await A.page.getAttribute('#m-net', 'title')})`;
  });

  await check('Mando (gamepad virtual): detección, botón y reasignación', async () => {
    await A.page.evaluate(() => window.__pad.connect());
    await A.page.click('#open-controls');
    await waitText(A.page, '#pads-list', /Mando 1/);
    await A.page.click('.tab[data-device="gamepad"]');
    await A.page.evaluate(() => window.__pad.press(2, true)); // X = puñetazo frontal
    await A.page.waitForSelector('tr[data-action="fp"].on', { timeout: 2000 });
    await B.page.waitForSelector('#input-peer .chip.on[data-action="fp"]', { timeout: 3000 });
    await A.page.evaluate(() => window.__pad.press(2, false));
    await A.page.click('tr[data-action="throw"] .bind-btn');
    await A.page.evaluate(() => window.__pad.press(3, true)); // Y
    await waitText(A.page, 'tr[data-action="throw"] .bind-btn', /^Y$/);
    await A.page.evaluate(() => window.__pad.press(3, false));
    await A.page.keyboard.press('Escape');
    return 'X ilumina «Puñetazo frontal» en A y en B; «Agarre» reasignado a Y';
  });

  await check('Listo en ambos y método elegido por el anfitrión', async () => {
    await B.page.click('#toggle-ready');
    await A.page.click('#toggle-ready');
    await waitText(A.page, '#game-status', /Ambos listos/);
    if (!(await B.page.isDisabled('#method-select'))) throw new Error('el invitado puede cambiar el método');
    await A.page.selectOption('#method-select', 'parsec');
    await waitText(B.page, '#method-tag', /Streaming/);
    await A.page.selectOption('#method-select', 'steam-online');
    await waitText(B.page, '#method-tag', /local/);
  });

  await check('Botón «Abrir MK9 en Steam» apunta a steam://run/237110 y avisa si Steam no responde', async () => {
    const href = await A.page.getAttribute('#launch-game', 'href');
    if (href !== 'steam://run/237110') throw new Error(`href ${href}`);
    await A.page.click('#launch-game');
    await waitText(A.page, '#toasts', /No se abrió nada/, 6000);
    return 'en este entorno no hay Steam: se muestra el aviso';
  });

  await check('Recargar la página de B vuelve a la misma sala y rehace el P2P', async () => {
    await B.page.reload();
    await B.page.waitForSelector('#view-room:not([hidden])');
    if ((await text(B.page, '#room-code')) !== code) throw new Error('otra sala');
    await waitText(A.page, '#m-p2p', /ms/);
  });

  await check('Corte de red de B: A ve la cuenta atrás y B se reconecta solo', async () => {
    await B.ctx.setOffline(true);
    await waitText(A.page, '#slot-1', /Desconectado · \d+ s/, 20000);
    const seen = (await text(A.page, '#slot-1')).match(/Desconectado · \d+ s/)[0];
    await B.ctx.setOffline(false);
    await waitText(A.page, '#slot-1', /Conectado/, 30000);
    await waitText(A.page, '#m-p2p', /ms/, 20000);
    return `A vio «${seen}»`;
  });

  if (restartServer) {
    await check('Reinicio del servidor: ambos vuelven solos a la misma sala y al P2P', async () => {
      await restartServer();
      await waitText(A.page, '#toasts', /De vuelta en la sala/, 30000);
      await B.page.waitForSelector('#view-room:not([hidden])', { timeout: 30000 });
      await waitText(B.page, '#room-code', new RegExp(code), 30000);
      await waitText(A.page, '#room-code', new RegExp(code), 30000);
      await waitText(A.page, '#slot-1', /Conectado/, 30000);
      await waitText(B.page, '#m-p2p', /ms/, 30000);
      return `sala ${code} restaurada con los dos jugadores`;
    });
  } else {
    console.log('  – Reinicio del servidor: se omite al probar un despliegue remoto (BASE_URL)');
  }

  await check('Interfaz móvil (390×844) sin desbordamiento horizontal', async () => {
    const M = await newPlayer('M', { width: 390, height: 844 });
    await M.page.goto(`${base}/?sala=${code}`);
    await M.page.waitForSelector('#conn-status[data-state="open"]');
    const w = await M.page.evaluate(() => document.documentElement.scrollWidth);
    if (w > 390) throw new Error(`scrollWidth ${w}`);
    if (process.env.SCREENSHOTS) await M.page.screenshot({ path: path.join(process.env.SCREENSHOTS, 'movil.png'), fullPage: true });
    return `ancho ${w}px`;
  });

  if (process.env.SCREENSHOTS) await A.page.screenshot({ path: path.join(process.env.SCREENSHOTS, 'sala.png'), fullPage: true });

  await check('Sin errores de JavaScript en las páginas', async () => {
    const real = pageErrors.filter((e) => !/ERR_INTERNET_DISCONNECTED|net::ERR|steam:\/\//.test(e));
    if (real.length) throw new Error(real.join(' | '));
  });

  await browser.close();
  await server?.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} comprobaciones superadas.`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
