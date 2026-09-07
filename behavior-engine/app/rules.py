"""
Deterministic checks that run alongside the model.

Not everything needs machine learning, and pretending it does makes a system
weaker. "The same DID opened doors in two buildings five minutes apart" is
physically impossible — it is a hard rule, and expressing it as a hard rule
means it fires on the first occurrence rather than after the model has seen
enough examples to find it unusual.

The Isolation Forest handles the fuzzy cases: an unusual hour, an unusual
sequence. These handle the impossible ones. For a demo the rules are also the
more reliable half, because they need no training data at all.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import Sequence

from .features import AccessEvent


@dataclass(frozen=True)
class RuleHit:
    rule: str
    severity: str      # high | medium
    reason: str


# Travelling between two buildings takes time. Anything under this is either a
# cloned credential or two people sharing one identity; both are worth an alarm.
IMPOSSIBLE_TRAVEL_MINUTES = 15

# A door nobody normally reaches without passing a main entrance first.
# Configurable per building in a fuller system; hardcoded here to the pattern
# the spec names explicitly.
# "FRONT" and "GATE" were missing, and a building whose entrance is called
# FRONT-01 had every interior door flagged for "no entrance first" — the
# rule fired on ordinary movement all day and buried the real hits. The
# backend keeps the same list (behavior.service `seed`), and the two must
# not drift: one decides what to generate, the other what to suspect.
ENTRY_DOOR_HINTS = ("MAIN", "ENTRY", "ENTRANCE", "LOBBY", "ULAZ", "FRONT", "GATE", "RECEPTION")

NIGHT_START_MINUTE = 0      # 00:00
NIGHT_END_MINUTE = 5 * 60   # 05:00


def _is_entry_door(door_code: str) -> bool:
    upper = door_code.upper()
    return any(hint in upper for hint in ENTRY_DOOR_HINTS)


def evaluate(event: AccessEvent, history: Sequence[AccessEvent]) -> list[RuleHit]:
    """
    Run every rule against one event.

    `history` is that person's past events, chronological, excluding `event`.
    """
    hits: list[RuleHit] = []
    past = sorted(history, key=lambda e: e.timestamp)
    previous = past[-1] if past else None

    # 1. Physically impossible movement between buildings.
    if previous is not None and event.building_id is not None:
        if (
            previous.building_id is not None
            and previous.building_id != event.building_id
            and event.timestamp - previous.timestamp < timedelta(minutes=IMPOSSIBLE_TRAVEL_MINUTES)
        ):
            gap = (event.timestamp - previous.timestamp).total_seconds() / 60.0
            hits.append(RuleHit(
                rule="impossible_travel",
                severity="high",
                reason=(
                    f"Same identity used at building {previous.building_id} and "
                    f"{event.building_id} {gap:.0f} minutes apart."
                ),
            ))

    # 2. An interior door reached without passing an entrance first today.
    if not _is_entry_door(event.door_code):
        today = [e for e in past if e.timestamp.date() == event.timestamp.date()]
        if today and not any(_is_entry_door(e.door_code) for e in today):
            hits.append(RuleHit(
                rule="no_entry_first",
                severity="medium",
                reason=(
                    f"Entered {event.door_code} without passing a main entrance "
                    "earlier today."
                ),
            ))

    # 3. Small hours. Flagged as a rule rather than left to the model because
    #    with a thin history the model has not yet learned that 03:00 is odd.
    if NIGHT_START_MINUTE <= event.minute_of_day < NIGHT_END_MINUTE:
        # Only interesting if this person does not normally do it.
        night_history = [
            e for e in past
            if NIGHT_START_MINUTE <= e.minute_of_day < NIGHT_END_MINUTE
        ]
        if len(past) >= 10 and len(night_history) / len(past) < 0.05:
            hits.append(RuleHit(
                rule="unusual_hour",
                severity="medium",
                reason=(
                    f"Access at {event.timestamp:%H:%M}, which this person has "
                    "essentially never done before."
                ),
            ))

    # 4. Repeated failures then a success — the shape of someone trying codes.
    recent = [e for e in past if event.timestamp - e.timestamp < timedelta(minutes=10)]
    failures = [e for e in recent if not e.success]
    if event.success and len(failures) >= 3:
        hits.append(RuleHit(
            rule="failures_then_success",
            severity="high",
            reason=f"{len(failures)} failed attempts in the 10 minutes before this one succeeded.",
        ))

    return hits
