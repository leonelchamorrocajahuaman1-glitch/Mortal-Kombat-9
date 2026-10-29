// Prueba de extremo a extremo de «Jugar desde esta web»: transmisión WebRTC + mando virtual.
//
//   npm install --no-save playwright && npx playwright install chromium
//   python -m pip install "websockets>=13"
//   npm run test:stream            (HELPER_PYTHON=py en Windows si hace falta)
//
// Qué es real:  dos navegadores Chromium independientes, el servidor, WebRTC (vídeo y datos) y el
//               ayudante Python escuchando en ws://127.0.0.1:47800.
// Qué se simula: la pantalla del anfitrión (un lienzo animado en lugar de MK9), el mando físico
//               del invitado (Gamepad API inyectada) y el mando ViGEm (el ayudante corre con
//               --dry-run y escribe en la consola el estado que aplicaría).

const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Falta Playwright: npm install --no-save playwright && npx playwright install chromium');
  process.exit(2);
}

const ROOT = path.join(__dirname, '..');
const XB = { UP: 0x0001, A: 0x1000, X: 0x4000 };
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

// Pantalla sintética: lienzo animado + tono de audio, en lugar de la ventana de MK9.
const FAKE_SCREEN = () => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 });
    const ctx = canvas.getContext('2d');
    let frame = 0;
    setInterval(() => {
      frame += 1;
      ctx.fillStyle = `hsl(${(frame * 3) % 360} 70% 40%)`;
      ctx.fillRect(0, 0, 1280, 720);
      ctx.fillStyle = '#fff';
      ctx.font = '64px sans-serif';
      ctx.fillText(`Pantalla de prueba ${frame}`, 80, 360);
    }, 1000 / 30);
    const stream = canvas.captureStream(30);
    const audio = new AudioContext();
    const osc = audio.createOscillator();
    const dest = audio.createMediaStreamDestination();
    osc.connect(dest);
    osc.start();
    stream.addTrack(dest.stream.getAudioTracks()[0]);
    return stream;
  };
};

const VIRTUAL_PAD = () => {
  const pad = {
    id: 'Mando virtual de prueba (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
  };
  window.__pad = {
    press(i, down) {
      pad.buttons[i] = { pressed: down, touched: down, value: down ? 1 : 0 };
      pad.timestamp++;
    },
    axis(i, v) {
      pad.axes[i] = v;
      pad.timestamp++;
    },
  };
  navigator.getGamepads = () => [pad, null, null, null];
};

(async () => {
  // Servidor
  let base = process.env.BASE_URL?.replace(/\/+$/, '');
  let server = null;
  if (!base) {
    const { startServer } = await import(pathToFileURL(path.join(ROOT, 'server', 'index.js')).href);
    server = startServer({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${await server.ready}`;
  }

  // Ayudante real en modo prueba
  const python = process.env.HELPER_PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
  const helper = spawn(python, [path.join(ROOT, 'helper', 'mk9-ayudante.py'), '--dry-run', '--no-install'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const states = [];
  const helperReady = new Promise((resolve, reject) => {
    let out = '';
    helper.stdout.on('data', (d) => {
      out += d;
      let i;
      while ((i = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, i);
        out = out.slice(i + 1);
        if (line.includes('listo en ws://')) resolve();
        if (line.startsWith('ESTADO ')) states.push({ at: Date.now(), ...JSON.parse(line.slice(7)) });
      }
    });
    helper.stderr.on('data', (d) => process.stderr.write(`[ayudante] ${d}`));
    helper.on('exit', (code) => reject(new Error(`el ayudante terminó (código ${code})`)));
    setTimeout(() => reject(new Error('el ayudante no arrancó en 10 s')), 10000);
  });
  const waitState = async (pred, timeout = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const hit = states.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`el ayudante no recibió el estado esperado (último: ${JSON.stringify(states.at(-1) ?? null)})`);
  };

  console.log(`Probando ${base} con el ayudante (${python} --dry-run)\n`);
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const mk = async (label, init) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: !!process.env.IGNORE_HTTPS_ERRORS });
    await ctx.addInitScript(init);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
    return { ctx, page };
  };
  const waitText = (page, sel, re, timeout = 15000) =>
    page.waitForFunction(([s, r]) => new RegExp(r).test(document.querySelector(s)?.textContent ?? ''), [sel, re.source], { timeout });

  const H = await mk('anfitrión', FAKE_SCREEN);
  const G = await mk('invitado', VIRTUAL_PAD);

  try {
    await check('El ayudante arranca y escucha en ws://127.0.0.1:47800', () => helperReady);

    await check('Sala con el método «Jugar desde esta web» y dos jugadores', async () => {
      await H.page.goto(base);
      await H.page.fill('#player-name', 'Anfitrión');
      await H.page.click('#btn-create');
      await H.page.waitForSelector('#view-room:not([hidden])');
      const code = (await H.page.textContent('#room-code')).trim();
      await G.page.goto(`${base}/?sala=${code}`);
      await G.page.fill('#player-name', 'Invitado');
      await G.page.click('#btn-play');
      await G.page.waitForSelector('#view-room:not([hidden])');
      if ((await H.page.inputValue('#method-select')) !== 'web-stream') throw new Error('método por defecto distinto');
      await waitText(H.page, '#m-p2p', /ms/);
      return `sala ${code}`;
    });

    await check('La página del anfitrión detecta el ayudante', async () => {
      await waitText(H.page, '#helper-status', /Conectado/);
      return (await H.page.textContent('#helper-status')).trim();
    });

    await check('Transmisión WebRTC: el invitado recibe y reproduce el vídeo y el audio', async () => {
      await H.page.click('#stream-start');
      await G.page.waitForFunction(() => {
        const v = document.querySelector('#stream-video');
        return v.srcObject && v.videoWidth > 0 && v.currentTime > 0.5;
      }, null, { timeout: 20000 });
      const info = await G.page.evaluate(async () => {
        const v = document.querySelector('#stream-video');
        const t1 = v.currentTime;
        await new Promise((r) => setTimeout(r, 1000));
        return { w: v.videoWidth, h: v.videoHeight, advanced: v.currentTime - t1, audio: v.srcObject.getAudioTracks().length };
      });
      if (info.advanced < 0.5) throw new Error('el vídeo no avanza');
      if (!info.audio) throw new Error('sin pista de audio');
      await waitText(G.page, '#stream-guest-stats', /fps/, 10000);
      return `${info.w}×${info.h}, audio, ${(await G.page.textContent('#stream-guest-stats')).trim()}`;
    });

    await check('Teclado del invitado → mando virtual: «Puñetazo frontal» (U) llega como X', async () => {
      await G.page.click('#h-game');
      const t0 = Date.now();
      await G.page.keyboard.down('KeyU');
      const st = await waitState((s) => s.at >= t0 && s.b & XB.X);
      await G.page.keyboard.up('KeyU');
      await waitState((s) => s.at > st.at && (s.b & XB.X) === 0);
      return `recibido en ${st.at - t0} ms (mismo equipo)`;
    });

    await check('Mando del invitado → mando virtual: botón A, cruceta y stick izquierdo', async () => {
      const t0 = Date.now();
      await G.page.evaluate(() => {
        window.__pad.press(0, true);
        window.__pad.press(12, true);
        window.__pad.axis(0, -1);
      });
      const st = await waitState((s) => s.at >= t0 && s.b & XB.A && s.b & XB.UP && s.lx <= -32000);
      await G.page.evaluate(() => {
        window.__pad.press(0, false);
        window.__pad.press(12, false);
        window.__pad.axis(0, 0);
      });
      await waitState((s) => s.at > st.at && s.b === 0 && s.lx === 0);
      await waitText(H.page, '#guest-pad-status', /Recibiendo/);
      return `b=0x${st.b.toString(16)}, lx=${st.lx}; el anfitrión muestra «${(await H.page.textContent('#guest-pad-status')).trim()}»`;
    });

    await check('El invitado recarga la página: vuelve el vídeo sin que el anfitrión haga nada', async () => {
      await G.page.reload();
      await G.page.waitForFunction(() => {
        const v = document.querySelector('#stream-video');
        return v.srcObject && v.videoWidth > 0 && v.currentTime > 0.3;
      }, null, { timeout: 25000 });
    });

    await check('El anfitrión detiene la transmisión y el invitado lo ve', async () => {
      await H.page.click('#stream-stop');
      await G.page.waitForSelector('#video-empty:not([hidden])', { timeout: 10000 });
    });

    await check('Sin errores de JavaScript', async () => {
      if (errors.length) throw new Error(errors.join(' | '));
    });
  } finally {
    if (process.env.SCREENSHOTS) {
      await H.page.screenshot({ path: path.join(process.env.SCREENSHOTS, 'stream-anfitrion.png'), fullPage: true }).catch(() => {});
      await G.page.screenshot({ path: path.join(process.env.SCREENSHOTS, 'stream-invitado.png'), fullPage: true }).catch(() => {});
    }
    await browser.close();
    helper.kill();
    await server?.close();
  }
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} comprobaciones superadas.`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
