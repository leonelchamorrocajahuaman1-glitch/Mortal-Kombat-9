// Prueba de extremo a extremo de la Arena: dos navegadores Chromium independientes juegan un
// combate real a través de una sala (servidor + WebRTC), con teclado, y se comprueba que ambos
// calculan exactamente el mismo combate (vida, fase y huellas del estado sin desincronización).
//
//   npm install --no-save playwright && npx playwright install chromium
//   npm run test:arena
//
// Segunda pasada con RELAY=1 automático: se impide el P2P (UDP) para forzar el envío de las
// pulsaciones por el servidor, como en redes donde la conexión directa no es posible.

const path = require('node:path');
const { pathToFileURL } = require('node:url');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Falta Playwright: npm install --no-save playwright && npx playwright install chromium');
  process.exit(2);
}

const results = [];
async function check(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push(true);
    console.log(`  ✔ ${name}${detail ? ` — ${detail}` : ''} (${Date.now() - t0} ms)`);
  } catch (err) {
    results.push(false);
    console.log(`  ✘ ${name}\n      ${String(err.message).split('\n')[0]}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function match(base, { relay, shots }) {
  const args = relay ? ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] : [];
  const browser = await chromium.launch({ args });
  const errors = [];
  const mk = async (label) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
    return page;
  };
  const H = await mk('anfitrión');
  const G = await mk('invitado');
  const arena = (page) => page.evaluate(() => ({ ...window.__arena, hp: window.__arena.hp, frame: window.__arena.frame, phase: window.__arena.phase, stats: window.__arena.stats, running: window.__arena.running }));
  const label = relay ? '[por el servidor]' : '[P2P]';

  try {
    await check(`${label} Sala creada y amigo unido por enlace; modo Arena por defecto`, async () => {
      await H.goto(base);
      await H.fill('#player-name', 'Ana');
      await H.click('#btn-create');
      await H.waitForSelector('#view-room:not([hidden])');
      const code = (await H.textContent('#room-code')).trim();
      await G.goto(`${base}/?sala=${code}`);
      await G.fill('#player-name', 'Beto');
      await G.click('#btn-play');
      await G.waitForSelector('#view-room:not([hidden])');
      await H.waitForSelector('#arena-box:not([hidden])');
      await G.waitForSelector('#arena-box:not([hidden])');
      await H.waitForFunction(() => !document.querySelector('#arena-start').disabled, null, { timeout: 15000 });
      const p2p = (await H.textContent('#m-p2p')).trim();
      return `sala ${code}, P2P: ${p2p}`;
    });

    await check(`${label} El invitado pide el combate y empieza en los dos navegadores`, async () => {
      await G.click('#arena-start');
      await H.waitForFunction(() => window.__arena.running, null, { timeout: 10000 });
      await G.waitForFunction(() => window.__arena.running, null, { timeout: 10000 });
      await H.waitForFunction(() => window.__arena.phase === 'fight', null, { timeout: 10000 });
      await G.waitForFunction(() => window.__arena.phase === 'fight', null, { timeout: 10000 });
      const a = await arena(H);
      const b = await arena(G);
      return `fotograma A ${a.frame}, B ${b.frame}`;
    });

    await check(`${label} Pelea con teclado: ambos se acercan y golpean; la vida baja igual en las dos pantallas`, async () => {
      await H.click('#arena-canvas');
      await G.click('#arena-canvas');
      // A camina a la derecha y B a la izquierda hasta encontrarse.
      await H.keyboard.down('KeyD');
      await G.keyboard.down('KeyA');
      await sleep(1500);
      await H.keyboard.up('KeyD');
      await G.keyboard.up('KeyA');
      // A lanza puñetazos y patadas; B patea de vez en cuando.
      // Toques de unos 60 ms, como los de una persona, más un toque instantáneo (0 ms).
      const tap = async (page, key, ms = 60) => {
        await page.keyboard.down(key);
        if (ms) await sleep(ms);
        await page.keyboard.up(key);
      };
      for (let i = 0; i < 10; i += 1) {
        await tap(H, i % 2 ? 'KeyJ' : 'KeyU', i === 4 ? 0 : 60);
        if (i % 3 === 0) await tap(G, 'KeyJ');
        await sleep(220);
      }
      await sleep(1200); // dejar que se confirmen todas las entradas
      const a = await arena(H);
      const b = await arena(G);
      if (a.hp[0] === 1000 && a.hp[1] === 1000) throw new Error('nadie recibió daño');
      if (JSON.stringify(a.hp) !== JSON.stringify(b.hp)) throw new Error(`vidas distintas: A ve ${a.hp}, B ve ${b.hp}`);
      return `vida [Ana, Beto] = [${a.hp}] en ambas pantallas`;
    });

    await check(`${label} Netcode: huellas del estado comparadas sin desincronización`, async () => {
      await sleep(1500);
      const a = await arena(H);
      const b = await arena(G);
      if (a.stats.desync || b.stats.desync) throw new Error('desincronización');
      if (a.stats.checks < 2 || b.stats.checks < 2) throw new Error(`pocas comprobaciones (${a.stats.checks}/${b.stats.checks})`);
      return `comprobaciones A ${a.stats.checks}, B ${b.stats.checks}; rollbacks A ${a.stats.rollbacks} (máx ${a.stats.maxRolled} f), B ${b.stats.rollbacks} (máx ${b.stats.maxRolled} f); ${(await H.textContent('#arena-stats')).trim()}`;
    });

    if (shots) {
      await H.screenshot({ path: path.join(shots, `arena-${relay ? 'servidor' : 'p2p'}-anfitrion.png`) });
      await G.locator('#arena-frame').screenshot({ path: path.join(shots, `arena-${relay ? 'servidor' : 'p2p'}-invitado.png`) });
    }

    await check(`${label} Sin errores de JavaScript`, async () => {
      if (errors.length) throw new Error(errors.join(' | '));
    });
  } finally {
    await browser.close();
  }
}

(async () => {
  let base = process.env.BASE_URL?.replace(/\/+$/, '');
  let server = null;
  if (!base) {
    const { startServer } = await import(pathToFileURL(path.join(__dirname, '..', 'server', 'index.js')).href);
    server = startServer({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${await server.ready}`;
  }
  console.log(`Probando la Arena en ${base}\n`);
  await match(base, { relay: false, shots: process.env.SCREENSHOTS });
  await match(base, { relay: true, shots: process.env.SCREENSHOTS });
  await server?.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} comprobaciones superadas.`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
