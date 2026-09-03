#!/usr/bin/env python3
"""
Drive the ReSpeaker's LED ring directly over the ESPHome API, bypassing MQTT.

Why this exists: the normal path is phone -> backend -> MQTT broker -> device,
and the device's connection to the broker is inbound to the machine running
Docker. A host firewall blocking that port makes the ring look broken when
every other part is fine. This talks to the device directly, so it separates
"the LEDs do not work" from "the message never arrived".

Also useful during RSSI calibration: hold a level while you walk around and
watch where the ring lands.

    python3 hardware/door-beacon/ring-test.py            # ramp 0..12 and back
    python3 hardware/door-beacon/ring-test.py 6          # hold 6 of 12
    python3 hardware/door-beacon/ring-test.py --host 192.168.88.204 3

Needs aioesphomeapi (it ships with esphome):
    ~/.venvs/esphome/bin/python hardware/door-beacon/ring-test.py
"""
import argparse
import asyncio
import sys

from aioesphomeapi import APIClient

DEFAULT_HOST = "192.168.88.204"
ACTION = "set_ring_level"


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("level", nargs="?", type=int, help="0-12; omit to ramp")
    ap.add_argument("--host", default=DEFAULT_HOST)
    ap.add_argument("--port", type=int, default=6053)
    args = ap.parse_args()

    client = APIClient(args.host, args.port, password=None)
    await client.connect(login=True)
    try:
        _, services = await client.list_entities_services()
        service = next((s for s in services if s.name == ACTION), None)
        if service is None:
            names = ", ".join(s.name for s in services) or "(none)"
            print(f"Device exposes no '{ACTION}' action. Found: {names}")
            print("Reflash respeaker-door-ring.yaml — the action lives in its api: block.")
            return 1

        if args.level is not None:
            await client.execute_service(service, {"level": args.level})
            print(f"{args.host}: ring -> {args.level} of 12")
            # The device clears the ring 3s after the last update, so hold it
            # open long enough to actually look at the thing.
            for _ in range(10):
                await asyncio.sleep(1)
                await client.execute_service(service, {"level": args.level})
            return 0

        print(f"{args.host}: ramping 0..12 and back")
        for level in list(range(13)) + list(range(11, -1, -1)):
            await client.execute_service(service, {"level": level})
            print(f"  {level:2d} " + "#" * level)
            await asyncio.sleep(0.25)
        return 0
    finally:
        await client.disconnect()


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        sys.exit(130)
