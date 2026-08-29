"""
Turning an access event into something an Isolation Forest can fit.

The engine never sees a camera frame. It has access *metadata* only —
timestamp, door, sequence, gap since the previous entry — which is exactly the
point: it answers "does this look like Ana?" where the face model answers
"is this Ana?". Someone coerced into unlocking a door passes the face check and
fails this one.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime
from typing import Sequence


@dataclass(frozen=True)
class AccessEvent:
    """One access decision, as the backend forwards it."""

    event_id: str
    person_id: str
    did: str
    door_code: str
    building_id: int | None
    timestamp: datetime
    success: bool

    @property
    def minute_of_day(self) -> int:
        return self.timestamp.hour * 60 + self.timestamp.minute

    @property
    def weekday(self) -> int:
        return self.timestamp.weekday()  # 0 = Monday


# Feature vector layout, kept as a constant so the model and the explanation
# code cannot drift apart.
FEATURE_NAMES = (
    "sin_time",       # time of day, encoded on a circle
    "cos_time",
    "is_weekend",
    "door_hash",      # which door, as a stable bucket
    "gap_minutes",    # log-scaled gap since this person's previous event
    "is_first_today",
)


def _cyclical(minute_of_day: int) -> tuple[float, float]:
    """
    Time of day as a point on a circle.

    A raw minute count would put 23:59 and 00:01 at opposite ends of the range,
    so a model would read a one-minute difference as the largest possible one.
    Sin/cos keeps midnight adjacent to itself, which is what "unusual hour"
    needs to mean.
    """
    angle = 2.0 * math.pi * (minute_of_day / 1440.0)
    return math.sin(angle), math.cos(angle)


def _door_bucket(door_code: str, buckets: int = 32) -> float:
    """
    Doors are strings; the model needs a number.

    Hashed into a fixed number of buckets rather than one-hot encoded, so a
    building adding a door does not change the width of every stored model.
    Collisions are acceptable here: the door feature is a weak signal next to
    time and sequence, and the deterministic rules catch what matters.
    """
    return (hash(door_code) % buckets) / float(buckets)


def to_vector(event: AccessEvent, previous: AccessEvent | None) -> list[float]:
    """One event as a feature vector, relative to that person's previous one."""
    sin_t, cos_t = _cyclical(event.minute_of_day)

    if previous is None:
        gap_minutes = 0.0
        is_first_today = 1.0
    else:
        delta = (event.timestamp - previous.timestamp).total_seconds() / 60.0
        # Log-scaled: the difference between 5 and 30 minutes matters far more
        # than between 5 and 30 hours, and raw minutes would let a weekend gap
        # dominate every other feature.
        gap_minutes = math.log1p(max(delta, 0.0))
        is_first_today = 1.0 if previous.timestamp.date() != event.timestamp.date() else 0.0

    return [
        sin_t,
        cos_t,
        1.0 if event.weekday >= 5 else 0.0,
        _door_bucket(event.door_code),
        gap_minutes,
        is_first_today,
    ]


def to_matrix(events: Sequence[AccessEvent]) -> list[list[float]]:
    """
    A person's history as a feature matrix, in chronological order.

    Order matters: the gap feature is defined against the preceding event, so
    shuffling the input silently changes what the model learns.
    """
    ordered = sorted(events, key=lambda e: e.timestamp)
    rows: list[list[float]] = []
    previous: AccessEvent | None = None
    for event in ordered:
        rows.append(to_vector(event, previous))
        previous = event
    return rows
