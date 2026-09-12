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

    def __post_init__(self) -> None:
        """
        Pin every timestamp to naive local wall-clock time.

        The backend sends UTC ("...Z"); synthetic history and everything this
        engine reasons about is local time, because "03:12 is unusual for this
        person" is a claim about the clock on the wall and not about UTC — an
        hour of offset would move an entry into or out of the small hours.
        Mixing the two is also not merely inconsistent: comparing an aware and
        a naive datetime raises, which took the scoring endpoint down entirely.

        Normalised here, in the one place every event passes through, rather
        than at each caller — the next caller would forget.
        """
        if self.timestamp.tzinfo is not None:
            object.__setattr__(
                self, "timestamp", self.timestamp.astimezone().replace(tzinfo=None),
            )

    @property
    def minute_of_day(self) -> int:
        return self.timestamp.hour * 60 + self.timestamp.minute

    @property
    def weekday(self) -> int:
        return self.timestamp.weekday()


FEATURE_NAMES = (
    "sin_time",
    "cos_time",
    "weekday_familiarity",
    "door_familiarity",
    "gap_minutes",
    "is_first_today",
)


@dataclass(frozen=True)
class Familiarity:
    """
    How much of a person's own history each door and each weekday accounts for.

    Categories are encoded as their share of the baseline rather than as an id,
    because an Isolation Forest splits on numeric order and an id has none: two
    doors whose hashes happen to sit either side of a split are "far apart" for
    no reason, and a door the person has never used lands wherever its hash
    falls — usually in the middle of the training values, where the forest sees
    nothing unusual at all. Encoded as a share, anything new is 0.0, below
    everything in the baseline, which is exactly where isolation is quick.

    The same argument retires `is_weekend`: for someone who has only ever
    worked weekdays that column is constant, and a constant column carries no
    split a tree can use, so a Saturday entry was invisible to the model.
    """

    doors: dict[str, float]
    weekdays: tuple[float, ...]

    @classmethod
    def of(cls, events: Sequence[AccessEvent]) -> "Familiarity":
        total = len(events)
        if total == 0:
            return cls({}, (0.0,) * 7)

        doors: dict[str, float] = {}
        weekdays = [0.0] * 7
        for event in events:
            doors[event.door_code] = doors.get(event.door_code, 0.0) + 1.0
            weekdays[event.weekday] += 1.0
        return cls(
            {code: n / total for code, n in doors.items()},
            tuple(n / total for n in weekdays),
        )

    def door(self, door_code: str) -> float:
        return self.doors.get(door_code, 0.0)

    def weekday(self, index: int) -> float:
        return self.weekdays[index]


UNKNOWN = Familiarity({}, (0.0,) * 7)


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


def to_vector(
    event: AccessEvent,
    previous: AccessEvent | None,
    familiar: Familiarity = UNKNOWN,
) -> list[float]:
    """
    One event as a feature vector, relative to that person's previous one.

    `familiar` must be the same baseline the model was fitted on — scoring a
    live event against shares computed from a different history would compare
    it to somebody else's normal.
    """
    sin_t, cos_t = _cyclical(event.minute_of_day)

    if previous is None:
        gap_minutes = 0.0
        is_first_today = 1.0
    else:
        delta = (event.timestamp - previous.timestamp).total_seconds() / 60.0
        gap_minutes = math.log1p(max(delta, 0.0))
        is_first_today = 1.0 if previous.timestamp.date() != event.timestamp.date() else 0.0

    return [
        sin_t,
        cos_t,
        familiar.weekday(event.weekday),
        familiar.door(event.door_code),
        gap_minutes,
        is_first_today,
    ]


def to_matrix(
    events: Sequence[AccessEvent],
    familiar: Familiarity | None = None,
) -> list[list[float]]:
    """
    A person's history as a feature matrix, in chronological order.

    Order matters: the gap feature is defined against the preceding event, so
    shuffling the input silently changes what the model learns.

    The shares default to those of `events` itself: the training rows describe
    how usual each door and day is *within the history being fitted*, which is
    the same question asked of a live event later.
    """
    ordered = sorted(events, key=lambda e: e.timestamp)
    shares = familiar if familiar is not None else Familiarity.of(ordered)
    rows: list[list[float]] = []
    previous: AccessEvent | None = None
    for event in ordered:
        rows.append(to_vector(event, previous, shares))
        previous = event
    return rows


def previous_before(events: Sequence[AccessEvent], moment: datetime) -> AccessEvent | None:
    """
    The event the gap feature is measured against: this person's latest one
    that happened before `moment`.

    Not simply "the last one we were told about". Events do not always arrive
    in order — a baseline trained from stored history is loaded in one go, and
    a live event can be scored against it — and taking the newest known event
    regardless of when it happened produced a negative gap, which
    `to_vector` clamps to zero. That silently encoded "no time has passed"
    for an entry hours after the previous one.
    """
    earlier = [e for e in events if e.timestamp <= moment]
    return max(earlier, key=lambda e: e.timestamp) if earlier else None
