"""Pruebas del ayudante con un mando simulado y clientes WebSocket reales.

    python -m venv .venv && .venv/bin/pip install "websockets>=13"
    .venv/bin/python helper/test_ayudante.py

No crea un mando ViGEm (eso solo es posible en Windows con el controlador instalado).
"""

import asyncio
import importlib.util
import json
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("ayudante", pathlib.Path(__file__).with_name("mk9-ayudante.py"))
ayudante = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ayudante)

from websockets.asyncio.client import connect  # noqa: E402
from websockets.asyncio.server import serve  # noqa: E402
from websockets.exceptions import InvalidStatus  # noqa: E402


class RecordingPad:
    mode = "prueba"

    def __init__(self):
        self.states = []

    def apply(self, state):
        self.states.append(state)


class AyudanteTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.pad = RecordingPad()
        self.helper = ayudante.Helper(self.pad, ["https://*.onrender.com", "http://localhost:*"])
        self.server = await serve(self.helper.handler, "127.0.0.1", 0, process_request=self.helper.check_origin)
        self.port = self.server.sockets[0].getsockname()[1]
        self.watchdog = asyncio.create_task(self.helper.watchdog())

    async def asyncTearDown(self):
        self.watchdog.cancel()
        self.server.close()
        await self.server.wait_closed()

    def url(self):
        return f"ws://127.0.0.1:{self.port}"

    async def test_aplica_estados_y_descarta_atrasados(self):
        async with connect(self.url(), origin="https://mk9-lobby.onrender.com") as ws:
            hello = json.loads(await ws.recv())
            self.assertEqual(hello["t"], "hello")
            self.assertEqual(hello["mode"], "prueba")
            await ws.send(json.dumps({"t": "state", "seq": 1, "b": 0x4000 | 0x0001, "rt": 255, "lx": -40000}))
            await ws.send(json.dumps({"t": "state", "seq": 0, "b": 0x1000}))  # atrasado
            await ws.send(json.dumps({"t": "ping", "id": 7}))
            pong = json.loads(await ws.recv())
            self.assertEqual(pong["received"], 1)
        self.assertEqual(self.pad.states[0], {"b": 0x4001, "lt": 0, "rt": 255, "lx": -32768, "ly": 0, "rx": 0, "ry": 0})
        # Al cerrar la página se sueltan todos los botones.
        await asyncio.sleep(0.05)
        self.assertEqual(self.pad.states[-1], ayudante.NEUTRAL)

    async def test_suelta_botones_si_dejan_de_llegar_estados(self):
        async with connect(self.url(), origin="http://localhost:3000") as ws:
            await ws.recv()
            await ws.send(json.dumps({"t": "state", "seq": 1, "b": 0x2000}))
            await asyncio.sleep(ayudante.RELEASE_AFTER_S + 0.4)
            self.assertEqual(self.pad.states[-1], ayudante.NEUTRAL)

    async def test_rechaza_webs_no_permitidas(self):
        with self.assertRaises(InvalidStatus) as ctx:
            async with connect(self.url(), origin="https://web-maliciosa.example"):
                pass
        self.assertEqual(ctx.exception.response.status_code, 403)
        with self.assertRaises(InvalidStatus):
            async with connect(self.url()):  # sin Origin (otro programa)
                pass
        self.assertEqual(self.pad.states, [])

    async def test_origenes(self):
        ok = ayudante.origin_allowed
        pats = ["https://*.onrender.com", "http://localhost:*"]
        self.assertTrue(ok("https://mk9.onrender.com", pats))
        self.assertFalse(ok("https://onrender.com", pats))
        self.assertFalse(ok("https://mk9.onrender.com.evil.com", pats))
        self.assertFalse(ok("http://mk9.onrender.com", pats))
        self.assertTrue(ok("http://localhost:3000", pats))
        self.assertFalse(ok("http://localhost.evil.com", pats))


if __name__ == "__main__":
    unittest.main(verbosity=2)
