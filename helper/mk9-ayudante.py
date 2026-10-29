#!/usr/bin/env python3
"""
MK9 Lobby — ayudante del mando virtual (PC del anfitrión, Windows).

Crea un mando virtual de Xbox 360 (con el controlador ViGEmBus) y lo mueve según lo que
el invitado pulsa en la web. Mortal Kombat 9 lo ve como un mando normal: el jugador 2.

    Uso: doble clic en este archivo, o en una terminal:
        py mk9-ayudante.py

La página de la sala (en el PC del anfitrión) se conecta a ws://127.0.0.1:47800.
Solo acepta conexiones desde este mismo equipo y desde las webs permitidas (--origins).

Requisitos: Windows 10/11 y Python 3.9+ (https://www.python.org/downloads/, marca
"Add python.exe to PATH"). La primera vez instala 'websockets' y 'vgamepad' con pip;
'vgamepad' abre el instalador oficial del controlador ViGEmBus: acéptalo.
"""

import argparse
import asyncio
import json
import os
import subprocess
import sys
import time

VERSION = "1.0.0"
DEFAULT_PORT = 47800
# Webs desde las que se acepta la conexión. Los subdominios de onrender.com son las
# direcciones gratuitas de Render; añade la tuya con --origins si usas otro dominio.
DEFAULT_ORIGINS = "http://localhost:*,http://127.0.0.1:*,https://*.onrender.com,https://*.trycloudflare.com"
# Si el invitado deja de enviar estado (red caída), se sueltan todos los botones.
RELEASE_AFTER_S = 1.0

# Botones XInput (mismos valores que XUSB_BUTTON de vgamepad / XINPUT_GAMEPAD_*).
XUSB_BITS = [
    0x0001, 0x0002, 0x0004, 0x0008,  # cruceta arriba, abajo, izquierda, derecha
    0x0010, 0x0020, 0x0040, 0x0080,  # start, back, L3, R3
    0x0100, 0x0200, 0x0400,          # LB, RB, guía
    0x1000, 0x2000, 0x4000, 0x8000,  # A, B, X, Y
]


def ensure_packages(dry_run):
    """Instala las dependencias que falten (solo la primera vez)."""
    missing = []
    try:
        import websockets  # noqa: F401
        if int(websockets.__version__.split(".")[0]) < 13:
            missing.append("websockets>=13")
    except ImportError:
        missing.append("websockets>=13")
    if not dry_run:
        try:
            import vgamepad  # noqa: F401
        except ImportError:
            missing.append("vgamepad")
    if not missing:
        return
    print(f"Instalando dependencias: {', '.join(missing)}")
    print("Si aparece el instalador de ViGEmBus, acéptalo: es el controlador del mando virtual.")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "--user", "--upgrade", *missing])
    import importlib
    import site
    # pip --user instala en una carpeta que puede no estar aún en sys.path en esta ejecución.
    user_site = site.getusersitepackages()
    if user_site not in sys.path:
        sys.path.append(user_site)
    importlib.invalidate_caches()


class FakePad:
    """Mando de prueba: no crea ningún dispositivo, escribe cada estado en la consola."""

    mode = "prueba"

    def apply(self, state):
        print("ESTADO " + json.dumps(state, sort_keys=True), flush=True)


class VigemPad:
    """Mando virtual de Xbox 360 real (ViGEmBus a través de vgamepad)."""

    mode = "vigem"

    def __init__(self):
        import vgamepad as vg
        self.vg = vg
        self.pad = vg.VX360Gamepad()

    def apply(self, state):
        pad = self.pad
        pad.reset()
        for bit in XUSB_BITS:
            if state["b"] & bit:
                pad.press_button(button=self.vg.XUSB_BUTTON(bit))
        pad.left_trigger(value=state["lt"])
        pad.right_trigger(value=state["rt"])
        pad.left_joystick(x_value=state["lx"], y_value=state["ly"])
        pad.right_joystick(x_value=state["rx"], y_value=state["ry"])
        pad.update()


def clamp(value, low, high):
    try:
        value = int(value)
    except (TypeError, ValueError):
        return 0
    return max(low, min(high, value))


def normalize(msg):
    return {
        "b": clamp(msg.get("b"), 0, 0xFFFF) & sum(XUSB_BITS),
        "lt": clamp(msg.get("lt"), 0, 255),
        "rt": clamp(msg.get("rt"), 0, 255),
        "lx": clamp(msg.get("lx"), -32768, 32767),
        "ly": clamp(msg.get("ly"), -32768, 32767),
        "rx": clamp(msg.get("rx"), -32768, 32767),
        "ry": clamp(msg.get("ry"), -32768, 32767),
    }


NEUTRAL = {"b": 0, "lt": 0, "rt": 0, "lx": 0, "ly": 0, "rx": 0, "ry": 0}


def origin_allowed(origin, patterns):
    """Compara el Origin con patrones tipo https://*.onrender.com o http://localhost:*."""
    if not origin:
        return False
    for pattern in patterns:
        scheme, _, rest = pattern.partition("://")
        o_scheme, _, o_rest = origin.partition("://")
        if scheme != o_scheme:
            continue
        host_pat, _, port_pat = rest.partition(":")
        o_host, _, o_port = o_rest.partition(":")
        if port_pat and port_pat != "*" and port_pat != o_port:
            continue
        if not port_pat and o_port:
            continue
        if host_pat.startswith("*."):
            if o_host.endswith(host_pat[1:]) and o_host != host_pat[2:]:
                return True
        elif host_pat == o_host:
            return True
    return False


class Helper:
    def __init__(self, pad, origins):
        self.pad = pad
        self.origins = origins
        self.current = None  # conexión activa (solo una página controla el mando)
        self.last_seq = -1
        self.last_state = dict(NEUTRAL)
        self.last_msg_at = 0.0
        self.received = 0

    def apply(self, state):
        self.last_state = state
        self.pad.apply(state)

    def release(self):
        if self.last_state != NEUTRAL:
            self.apply(dict(NEUTRAL))

    def check_origin(self, connection, request):
        origin = request.headers.get("Origin")
        if not origin_allowed(origin, self.origins):
            print(f"Conexión rechazada desde {origin!r}. Añádela con --origins si es tu web.", flush=True)
            return connection.respond(403, "Origen no permitido\n")
        return None

    async def handler(self, ws):
        if self.current is not None:
            await self.current.close(code=4000, reason="otra pagina tomo el control")
        self.current = ws
        self.last_seq = -1
        origin = ws.request.headers.get("Origin")
        print(f"Página conectada: {origin}", flush=True)
        await ws.send(json.dumps({"t": "hello", "version": VERSION, "mode": self.pad.mode}))
        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except (TypeError, ValueError):
                    continue
                kind = msg.get("t")
                if kind == "state":
                    seq = msg.get("seq")
                    # Estado completo e idempotente: se ignoran paquetes atrasados.
                    if isinstance(seq, int) and seq <= self.last_seq:
                        continue
                    if isinstance(seq, int):
                        self.last_seq = seq
                    self.last_msg_at = time.monotonic()
                    self.received += 1
                    self.apply(normalize(msg))
                elif kind == "reset":
                    self.last_seq = -1
                    self.release()
                elif kind == "ping":
                    await ws.send(json.dumps({"t": "pong", "id": msg.get("id"), "received": self.received}))
        finally:
            if self.current is ws:
                self.current = None
                self.release()
                print("Página desconectada: botones liberados.", flush=True)

    async def watchdog(self):
        while True:
            await asyncio.sleep(0.2)
            if self.last_state != NEUTRAL and time.monotonic() - self.last_msg_at > RELEASE_AFTER_S:
                self.release()


async def main_async(args):
    from websockets.asyncio.server import serve

    if args.dry_run:
        pad = FakePad()
    else:
        try:
            pad = VigemPad()
        except Exception as err:  # controlador ausente o sin permisos
            print("\nNo se pudo crear el mando virtual:", err)
            print("Instala ViGEmBus: https://github.com/nefarius/ViGEmBus/releases")
            print("y vuelve a abrir este ayudante.")
            return 1
    origins = [o.strip() for o in args.origins.split(",") if o.strip()]
    helper = Helper(pad, origins)
    async with serve(helper.handler, "127.0.0.1", args.port, process_request=helper.check_origin):
        print(f"MK9 ayudante {VERSION} listo en ws://127.0.0.1:{args.port} (modo {pad.mode}).", flush=True)
        print("Deja esta ventana abierta mientras juegas. Ctrl+C para cerrar.", flush=True)
        asyncio.create_task(helper.watchdog())
        await asyncio.Future()


def main():
    parser = argparse.ArgumentParser(description="Mando virtual de Xbox para MK9 Lobby")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--origins", default=os.environ.get("MK9_ORIGINS", DEFAULT_ORIGINS),
                        help="Webs permitidas, separadas por comas")
    parser.add_argument("--dry-run", action="store_true",
                        help="Sin mando virtual: muestra los estados recibidos (para pruebas)")
    parser.add_argument("--no-install", action="store_true", help="No instalar dependencias con pip")
    args = parser.parse_args()

    if not args.no_install:
        ensure_packages(args.dry_run)
    try:
        code = asyncio.run(main_async(args))
    except KeyboardInterrupt:
        code = 0
    except OSError as err:
        print(f"No se pudo abrir el puerto {args.port}: {err}. ¿Hay otro ayudante abierto?")
        code = 1
    if code and sys.platform == "win32" and not sys.stdin.closed:
        input("Pulsa Enter para cerrar…")
    sys.exit(code or 0)


if __name__ == "__main__":
    main()
