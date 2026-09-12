"""
The human-readable half of a baseline.

The forest answers "how unusual is this" with a number. That number is useless
to the operator who has to act on it: an alert that says 0.83 and nothing else
cannot be agreed or disagreed with. This module holds the same history the
forest was fitted on, summarised in the terms the spec actually uses — typical
hours, typical doors, how often this person comes and goes — so a score can be
shown next to what it was measured against.

It is descriptive statistics, deliberately. Anything the model could disagree
with belongs in the model; this is the evidence, not a second opinion.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Sequence

from .features import FEATURE_NAMES, AccessEvent, Familiarity, to_matrix


@dataclass(frozen=True)
class DoorShare:
    door_code: str
    count: int
    share: float


@dataclass
class Baseline:
    """What one person's history looks like, in plain terms."""

    events: int
    first_seen: datetime | None
    last_seen: datetime | None
    usual_from_minute: int
    usual_to_minute: int
    hour_histogram: list[int]
    doors: list[DoorShare]
    weekend_share: float
    night_share: float
    weekday_shares: tuple[float, ...]
    median_gap_minutes: float
    events_per_day: float
    synthetic_events: int
    familiarity: Familiarity = field(default_factory=lambda: Familiarity({}, (0.0,) * 7))
    typical_vector: list[float] = field(default_factory=list)

    @property
    def synthetic(self) -> bool:
        return self.synthetic_events >= self.events > 0


def hhmm(minute_of_day: int) -> str:
    """A minute of the day as a clock time. Shared so an explanation and the
    profile it refers to can never format the same instant differently."""
    return f"{minute_of_day // 60:02d}:{minute_of_day % 60:02d}"


def _percentile(values: Sequence[float], q: float) -> float:
    """Nearest-rank percentile. No numpy here: this runs on tiny lists."""
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(q * (len(ordered) - 1))))
    return ordered[index]


def _median(values: Sequence[float]) -> float:
    return _percentile(values, 0.5)


def build(events: Sequence[AccessEvent]) -> Baseline:
    """Summarise one person's history. Order does not matter; gaps are sorted."""
    ordered = sorted(events, key=lambda e: e.timestamp)
    total = len(ordered)
    if total == 0:
        return Baseline(
            events=0, first_seen=None, last_seen=None,
            usual_from_minute=0, usual_to_minute=0,
            hour_histogram=[0] * 24, doors=[], weekend_share=0.0, night_share=0.0,
            weekday_shares=(0.0,) * 7,
            median_gap_minutes=0.0, events_per_day=0.0, synthetic_events=0,
        )

    minutes = [e.minute_of_day for e in ordered]
    histogram = [0] * 24
    for e in ordered:
        histogram[e.timestamp.hour] += 1

    counts: dict[str, int] = {}
    for e in ordered:
        counts[e.door_code] = counts.get(e.door_code, 0) + 1
    doors = [
        DoorShare(code, n, round(n / total, 4))
        for code, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    ]

    gaps = [
        (b.timestamp - a.timestamp).total_seconds() / 60.0
        for a, b in zip(ordered, ordered[1:])
        if a.timestamp.date() == b.timestamp.date()
    ]

    span_days = max(1.0, (ordered[-1].timestamp - ordered[0].timestamp).total_seconds() / 86400.0)
    familiar = Familiarity.of(ordered)
    matrix = to_matrix(ordered, familiar)
    typical = [_median([row[i] for row in matrix]) for i in range(len(FEATURE_NAMES))]

    return Baseline(
        events=total,
        first_seen=ordered[0].timestamp,
        last_seen=ordered[-1].timestamp,
        usual_from_minute=int(_percentile(minutes, 0.05)),
        usual_to_minute=int(_percentile(minutes, 0.95)),
        hour_histogram=histogram,
        doors=doors,
        weekend_share=round(sum(1 for e in ordered if e.weekday >= 5) / total, 4),
        night_share=round(sum(1 for e in ordered if e.minute_of_day < 5 * 60) / total, 4),
        weekday_shares=familiar.weekdays,
        median_gap_minutes=round(_median(gaps), 1) if gaps else 0.0,
        events_per_day=round(total / span_days, 2),
        synthetic_events=sum(1 for e in ordered if e.event_id.startswith("synthetic-")),
        familiarity=familiar,
        typical_vector=typical,
    )


def door_share(baseline: Baseline, door_code: str) -> float:
    return baseline.familiarity.door(door_code)
