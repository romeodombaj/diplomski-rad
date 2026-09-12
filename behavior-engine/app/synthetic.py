"""
Synthetic "normal you" history.

The spec expects one to two weeks of real usage before a baseline means
anything (sigurnosni-sustav-biometrija.md section 4). That data will not exist
before a thesis defence, and a model fitted on four events flags everything.

So: generate a plausible history — consistent arrival window, usual door, small
day-to-day jitter — and fit against that. The demo then shows the engine
distinguishing a 03:00 server-room entry from a normal 08:47 arrival, which is
the actual claim being made.

This is honest only if it is stated. Seeded history is clearly marked as
`synthetic: true` on every generated event, and the engine reports how many
events a baseline came from, so nobody mistakes a seeded model for a learned
one.
"""
from __future__ import annotations

import random
from datetime import datetime, timedelta

from .features import AccessEvent


def generate_history(
    person_id: str,
    did: str,
    *,
    days: int = 14,
    building_id: int = 1,
    entry_door: str = "MAIN-01",
    interior_doors: tuple[str, ...] = ("OFFICE-02",),
    arrive_minute: int = 8 * 60 + 45,
    leave_minute: int = 17 * 60 + 15,
    jitter_minutes: int = 25,
    seed: int | None = None,
    end: datetime | None = None,
) -> list[AccessEvent]:
    """
    A fortnight of unremarkable weekdays.

    Deliberately boring: arrive through the main door, pass an interior door
    shortly after, leave through the main door. Weekends are skipped, which is
    itself a signal the model picks up — a Saturday entry then reads as unusual
    without anyone encoding "weekends are odd" as a rule.
    """
    rng = random.Random(seed)
    end = end or datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    events: list[AccessEvent] = []
    counter = 0

    for day_offset in range(days, 0, -1):
        day = end - timedelta(days=day_offset)
        if day.weekday() >= 5:
            continue

        def at(minute: int) -> datetime:
            jittered = minute + rng.randint(-jitter_minutes, jitter_minutes)
            jittered = max(0, min(jittered, 1439))
            return day + timedelta(minutes=jittered)

        def add(door: str, when: datetime) -> None:
            nonlocal counter
            counter += 1
            events.append(AccessEvent(
                event_id=f"synthetic-{person_id}-{counter}",
                person_id=person_id,
                did=did,
                door_code=door,
                building_id=building_id,
                timestamp=when,
                success=True,
            ))

        arrival = at(arrive_minute)
        add(entry_door, arrival)

        if interior_doors and rng.random() < 0.85:
            add(
                rng.choice(list(interior_doors)),
                arrival + timedelta(minutes=rng.randint(2, 20)),
            )

        add(entry_door, at(leave_minute))

    events.sort(key=lambda e: e.timestamp)
    return events
