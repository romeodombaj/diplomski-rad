#!/usr/bin/env python3
"""
Forward door proximity from MQTT to the ReSpeaker's LED ring.

WHY THIS EXISTS
---------------
The device can subscribe to MQTT itself (see the `mqtt:` block in
respeaker-door-ring.yaml), and when it can, that is the simpler arrangement.
But that connection runs device -> broker, which is INBOUND to the machine
hosting Docker, and a host firewall that blocks the broker's port makes the
whole feature look broken while every individual piece is fine.

This bridge inverts the direction. It subscribes to the broker over loopback,
which no firewall touches, and pushes to the device over the ESPHome API, which
is OUTBOUND from this machine. Both legs are already-permitted directions, so
it needs no firewall change and no administrator rights.

    ~/.venvs/esphome/bin/python hardware/door-beacon/ring-bridge.py

Either path works; do not run both at once, or two writers will fight over the
same twelve LEDs.
"""
import argparse
import asyncio
import contextlib
import json
import logging

import paho.mqtt.client as mqtt
from aioesphomeapi import APIClient
from aioesphomeapi.core import APIConnectionError

log = logging.getLogger("ring-bridge")

KEEPALIVE_S = 0.3
UNLOCK_FLASH_S = 2.0


class Bridge:
    def __init__(self, host: str, port: int, topic: str) -> None:
        self.host, self.port, self.topic = host, port, topic
        self.client: APIClient | None = None
        self.action = None
        self.level = 0
        self.flash_until = 0.0
        self.loop: asyncio.AbstractEventLoop | None = None

    async def reconnect_device(self) -> None:
        """Reconnect to the device, backing off so a long outage is not a busy loop."""
        delay = 1.0
        while True:
            with contextlib.suppress(Exception):
                await self.client.disconnect()
            try:
                await self.connect_device()
                return
            except Exception as err:  # noqa: BLE001 - any failure means keep trying
                log.warning("reconnect failed (%s); retrying in %.0fs", err, delay)
                await asyncio.sleep(delay)
                delay = min(delay * 2, 30.0)

    async def connect_device(self) -> None:
        self.client = APIClient(self.host, self.port, password=None)
        await self.client.connect(login=True)
        _, services = await self.client.list_entities_services()
        self.action = next((s for s in services if s.name == "set_ring_level"), None)
        if self.action is None:
            raise SystemExit(
                "Device exposes no 'set_ring_level' action — reflash "
                "respeaker-door-ring.yaml, which defines it in its api: block."
            )
        log.info("connected to device %s", self.host)


    def on_message(self, _c, _u, msg) -> None:
        try:
            payload = json.loads(msg.payload.decode())
        except (ValueError, UnicodeDecodeError):
            log.warning("ignoring non-JSON on %s", msg.topic)
            return

        if msg.topic.endswith("/proximity"):
            levels = int(payload.get("levels") or 0)
            self.level = (int(payload.get("level", 0)) * 12) // levels if levels else 0
            log.info("proximity %s -> %d/12", payload.get("level"), self.level)
        elif payload.get("action") == "unlock":
            assert self.loop is not None
            self.flash_until = self.loop.time() + UNLOCK_FLASH_S
            log.info("unlock -> flash")

    async def run(self, broker: str, broker_port: int) -> None:
        self.loop = asyncio.get_running_loop()
        await self.connect_device()

        m = mqtt.Client()
        m.on_message = self.on_message
        m.connect(broker, broker_port, 60)
        m.subscribe([(f"{self.topic}/proximity", 0), (self.topic, 0)])
        m.loop_start()
        log.info("subscribed to %s and %s/proximity", self.topic, self.topic)

        last_sent = None
        try:
            while True:
                lit = 12 if self.loop.time() < self.flash_until else self.level
                if lit != last_sent or lit > 0:
                    try:
                        await self.client.execute_service(self.action, {"level": lit})
                        last_sent = lit
                    except (APIConnectionError, OSError) as err:
                        log.warning("device connection lost (%s) — reconnecting", err)
                        last_sent = None
                        await self.reconnect_device()
                await asyncio.sleep(KEEPALIVE_S)
        finally:
            m.loop_stop()
            with contextlib.suppress(Exception):
                await self.client.disconnect()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--host", default="192.168.88.204", help="ReSpeaker IP")
    ap.add_argument("--port", type=int, default=6053)
    ap.add_argument("--broker", default="127.0.0.1")
    ap.add_argument("--broker-port", type=int, default=1883)
    ap.add_argument("--topic", default="123", help="the door's doors.mqtt_topic")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    try:
        asyncio.run(Bridge(a.host, a.port, a.topic).run(a.broker, a.broker_port))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
