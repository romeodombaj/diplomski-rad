"""
Why a score is what it is.

An Isolation Forest gives one number and no account of itself, and a security
operator cannot act on that: "0.83" is not a thing you can agree or disagree
with, and an alert nobody can check is an alert everybody learns to ignore.

The account given here is a counterfactual, one feature group at a time: score
the event as it happened, then score it again with a single group replaced by
what this person normally does, and attribute the difference to that group.
"This entry would have looked ordinary at your usual hour" is a claim an
operator can check against the door and the person, which is the point.

It is an attribution, not a proof — the forest is not additive, so the parts do
not have to sum to the whole. They are reported as shares of the push towards
"unusual" precisely so nobody reads them as a decomposition of the score.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Sequence

from .features import AccessEvent
from .profile import Baseline, door_share, hhmm

FACTOR_GROUPS: tuple[tuple[str, tuple[int, ...]], ...] = (
    ("time_of_day", (0, 1)),
    ("day_of_week", (2,)),
    ("door", (3,)),
    ("interval", (4,)),
    ("first_of_day", (5,)),
)

WEEKDAY_NAMES = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


@dataclass(frozen=True)
class Factor:
    """One driver of a score, in terms an operator can check."""

    factor: str
    share: float
    delta: float
    value: str
    usual: str
    detail: str


def _humanise_gap(minutes: float) -> str:
    if minutes < 90:
        return f"{minutes:.0f} min"
    if minutes < 48 * 60:
        return f"{minutes / 60:.1f} h"
    return f"{minutes / 1440:.1f} days"


def _describe(
    name: str,
    event: AccessEvent,
    previous: AccessEvent | None,
    baseline: Baseline,
) -> tuple[str, str, str]:
    """(value, usual, sentence) for one factor group."""
    if name == "time_of_day":
        value = hhmm(event.minute_of_day)
        usual = f"{hhmm(baseline.usual_from_minute)}–{hhmm(baseline.usual_to_minute)}"
        return value, usual, f"Access at {value}; usual hours are {usual}."

    if name == "day_of_week":
        share = baseline.weekday_shares[event.weekday] if baseline.weekday_shares else 0.0
        value = WEEKDAY_NAMES[event.weekday]
        usual = "never before" if share == 0 else f"{share * 100:.0f}% of history"
        return value, usual, f"{value}: {usual}."

    if name == "door":
        share = door_share(baseline, event.door_code)
        value = event.door_code
        usual = "never used before" if share == 0 else f"{share * 100:.0f}% of history"
        return value, usual, f"Door {value}: {usual}."

    if name == "interval":
        if previous is None:
            return "first known event", "—", "No previous event to measure an interval against."
        gap = (event.timestamp - previous.timestamp).total_seconds() / 60.0
        value = _humanise_gap(max(gap, 0.0))
        usual = _humanise_gap(baseline.median_gap_minutes)
        return value, usual, f"{value} since the previous event; usual gap is {usual}."

    first = previous is None or previous.timestamp.date() != event.timestamp.date()
    value = "first entry of the day" if first else "follow-on entry"
    usual = f"{baseline.events_per_day:.1f} events per day"
    return value, usual, f"{value.capitalize()}, against {usual}."


def contributions(
    score_fn: Callable[[Sequence[float]], float],
    vector: Sequence[float],
    baseline: Baseline,
    event: AccessEvent,
    previous: AccessEvent | None,
) -> list[Factor]:
    """
    Attribute a score across the feature groups.

    `score_fn` maps a feature vector to the same 0..1 anomaly score the model
    reports, so an explanation can never drift from the number it explains.
    """
    typical = baseline.typical_vector
    if len(typical) != len(vector):
        return []

    base = score_fn(vector)
    factors: list[Factor] = []
    for name, indices in FACTOR_GROUPS:
        counterfactual = list(vector)
        for i in indices:
            counterfactual[i] = typical[i]
        delta = base - score_fn(counterfactual)
        value, usual, detail = _describe(name, event, previous, baseline)
        factors.append(Factor(
            factor=name, share=0.0, delta=round(delta, 4),
            value=value, usual=usual, detail=detail,
        ))

    pushing = sum(f.delta for f in factors if f.delta > 0)
    if pushing > 0:
        factors = [
            Factor(**{**f.__dict__, "share": round(max(f.delta, 0.0) / pushing, 4)})
            for f in factors
        ]

    factors.sort(key=lambda f: f.delta, reverse=True)
    return factors
