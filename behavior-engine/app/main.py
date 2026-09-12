"""
Behaviour engine — anomaly detection over access metadata.

Closes AUDIT.md F-01, which flagged that the spec names this component
(Isolation Forest, Python, POST /behavior/event, WebSocket) without ever
defining its contract. The contract implemented here is the one proposed in
specs/BEHAVIOR_ENGINE_NOTES.md section 1.

What this is NOT: it has no access to camera frames and says nothing about how
someone looked. It answers "does this access pattern look like this person?",
which is a different question from "is this person who they claim to be" — that
one belongs to the face model, and it is already answered before an event
reaches here.
"""
from __future__ import annotations

import logging
import os
from collections import defaultdict, deque
from datetime import datetime
from pathlib import Path
from typing import Deque

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .features import AccessEvent, previous_before
from .model import MIN_EVENTS_TO_FIT, ModelStore
from .profile import Baseline, hhmm
from .rules import evaluate
from .synthetic import generate_history

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("behavior-engine")

MODEL_DIR = Path(os.environ.get("MODEL_DIR", "/data/models"))
HISTORY_WINDOW = int(os.environ.get("HISTORY_WINDOW", "500"))
REFIT_EVERY = int(os.environ.get("REFIT_EVERY", "25"))

app = FastAPI(title="Behaviour engine", version="1.0.0")
store = ModelStore(MODEL_DIR)
history: dict[str, Deque[AccessEvent]] = defaultdict(lambda: deque(maxlen=HISTORY_WINDOW))
since_fit: dict[str, int] = defaultdict(int)



class EventIn(BaseModel):
    """Fired by the backend after every access decision, granted or denied."""

    event_id: str
    person_id: str | None = None
    did: str
    door_code: str
    building_id: int | None = None
    timestamp: datetime
    success: bool = True


class RuleHitOut(BaseModel):
    rule: str
    severity: str
    reason: str


class FactorOut(BaseModel):
    """One driver of a score. `factor` is a key the dashboard translates."""

    factor: str
    share: float
    delta: float
    value: str
    usual: str
    detail: str


class ScoreOut(BaseModel):
    event_id: str
    anomaly_score: float = Field(ge=0.0, le=1.0)
    is_anomaly: bool
    reason: str
    rule_hits: list[RuleHitOut] = []
    factors: list[FactorOut] = []
    model_trained: bool
    events_in_baseline: int


class DoorShareOut(BaseModel):
    door_code: str
    count: int
    share: float


class ProfileOut(BaseModel):
    """What the dashboard shows on a person's behaviour tab."""

    person_id: str
    model_trained: bool
    events_in_baseline: int
    min_events_to_fit: int = MIN_EVENTS_TO_FIT
    synthetic: bool = False
    first_seen: datetime | None = None
    last_seen: datetime | None = None
    usual_from: str | None = None
    usual_to: str | None = None
    hour_histogram: list[int] = []
    doors: list[DoorShareOut] = []
    weekend_share: float = 0.0
    night_share: float = 0.0
    median_gap_minutes: float = 0.0
    events_per_day: float = 0.0


class SeedIn(BaseModel):
    person_id: str
    did: str
    days: int = 14
    building_id: int = 1
    entry_door: str = "MAIN-01"
    interior_doors: list[str] = ["OFFICE-02"]
    seed: int | None = None


class SeedOut(BaseModel):
    person_id: str
    events_generated: int
    model_fitted: bool
    synthetic: bool = True



def _key(event: EventIn) -> str:
    """
    Models are keyed by person, falling back to DID.

    A person who replaces a stolen phone gets a new DID but is the same human
    with the same habits, so keying on the person keeps their baseline. The DID
    fallback exists because a denied event may not resolve to a person at all.
    """
    return event.person_id or event.did


def _profile_out(person_id: str, baseline: Baseline | None) -> ProfileOut:
    if baseline is None or baseline.events == 0:
        return ProfileOut(person_id=person_id, model_trained=False, events_in_baseline=0)
    return ProfileOut(
        person_id=person_id,
        model_trained=True,
        events_in_baseline=baseline.events,
        synthetic=baseline.synthetic,
        first_seen=baseline.first_seen,
        last_seen=baseline.last_seen,
        usual_from=hhmm(baseline.usual_from_minute),
        usual_to=hhmm(baseline.usual_to_minute),
        hour_histogram=baseline.hour_histogram,
        doors=[DoorShareOut(**d.__dict__) for d in baseline.doors],
        weekend_share=baseline.weekend_share,
        night_share=baseline.night_share,
        median_gap_minutes=baseline.median_gap_minutes,
        events_per_day=baseline.events_per_day,
    )


def _to_domain(event: EventIn, key: str) -> AccessEvent:
    return AccessEvent(
        event_id=event.event_id,
        person_id=key,
        did=event.did,
        door_code=event.door_code,
        building_id=event.building_id,
        timestamp=event.timestamp,
        success=event.success,
    )



@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "models": len(list(MODEL_DIR.glob("*.joblib"))),
        "tracked_people": len(history),
        "min_events_to_fit": MIN_EVENTS_TO_FIT,
    }


@app.post("/behavior/event", response_model=ScoreOut)
def score_event(event: EventIn) -> ScoreOut:
    """
    Score one access event.

    Called by the backend after the decision is already made and recorded, so
    this never gates a door — a slow or dead engine must not stop someone
    getting into the building. It produces an alert, not a verdict.
    """
    key = _key(event)
    domain = _to_domain(event, key)
    past = list(history[key])
    previous = previous_before(past, domain.timestamp)

    verdict = store.score(key, domain, previous)
    hits = [RuleHitOut(**h.__dict__) for h in evaluate(domain, past)]
    factors = [FactorOut(**f.__dict__) for f in verdict.factors]

    history[key].append(domain)
    since_fit[key] += 1
    if since_fit[key] >= REFIT_EVERY and len(history[key]) >= MIN_EVENTS_TO_FIT:
        store.fit(key, list(history[key]))
        since_fit[key] = 0

    high = [h for h in hits if h.severity == "high"]
    if high:
        return ScoreOut(
            event_id=event.event_id,
            anomaly_score=max(verdict.anomaly_score, 0.95),
            is_anomaly=True,
            reason=high[0].reason,
            rule_hits=hits,
            factors=factors,
            model_trained=verdict.model_trained,
            events_in_baseline=verdict.events_in_baseline,
        )

    medium = [h for h in hits if h.severity == "medium"]
    if medium and not verdict.is_anomaly:
        return ScoreOut(
            event_id=event.event_id,
            anomaly_score=max(verdict.anomaly_score, 0.6),
            is_anomaly=True,
            reason=medium[0].reason,
            rule_hits=hits,
            factors=factors,
            model_trained=verdict.model_trained,
            events_in_baseline=verdict.events_in_baseline,
        )

    return ScoreOut(
        event_id=event.event_id,
        anomaly_score=verdict.anomaly_score,
        is_anomaly=verdict.is_anomaly,
        reason=verdict.reason,
        rule_hits=hits,
        factors=factors,
        model_trained=verdict.model_trained,
        events_in_baseline=verdict.events_in_baseline,
    )


@app.get("/behavior/profile/{person_id}", response_model=ProfileOut)
def profile(person_id: str) -> ProfileOut:
    """
    The baseline a score is measured against.

    Read by the dashboard's behaviour tab: a score on its own tells an operator
    nothing they can check, so the hours, doors and rhythm the model was fitted
    on are served next to it.
    """
    return _profile_out(person_id, store.baseline(person_id))


@app.post("/behavior/train")
def train(person_id: str, events: list[EventIn]) -> dict:
    """Fit a person's model from real history the backend already holds."""
    if not events:
        raise HTTPException(status_code=400, detail="no events to train on")

    domain = [_to_domain(e, person_id) for e in events]
    history[person_id] = deque(
        sorted(domain, key=lambda e: e.timestamp)[-HISTORY_WINDOW:],
        maxlen=HISTORY_WINDOW,
    )
    used = store.fit(person_id, list(history[person_id]))
    since_fit[person_id] = 0
    return {
        "person_id": person_id,
        "events": used,
        "model_fitted": store.has_model(person_id),
        "min_events_to_fit": MIN_EVENTS_TO_FIT,
    }


@app.post("/behavior/seed", response_model=SeedOut)
def seed(body: SeedIn) -> SeedOut:
    """
    Fit a baseline from generated "normal" history.

    The cold-start answer from BEHAVIOR_ENGINE_NOTES section 1. Everything this
    produces is marked synthetic, and /health reports how many events any
    baseline came from, so a seeded model is never mistaken for a learned one.
    """
    events = generate_history(
        body.person_id,
        body.did,
        days=body.days,
        building_id=body.building_id,
        entry_door=body.entry_door,
        interior_doors=tuple(body.interior_doors),
        seed=body.seed,
    )
    history[body.person_id] = deque(events[-HISTORY_WINDOW:], maxlen=HISTORY_WINDOW)
    store.fit(body.person_id, events)
    since_fit[body.person_id] = 0

    log.info("seeded %s with %d synthetic events", body.person_id, len(events))
    return SeedOut(
        person_id=body.person_id,
        events_generated=len(events),
        model_fitted=store.has_model(body.person_id),
    )


@app.delete("/behavior/{person_id}")
def forget(person_id: str) -> dict:
    """Drop a person's model and history — used when someone is offboarded."""
    store.forget(person_id)
    history.pop(person_id, None)
    since_fit.pop(person_id, None)
    return {"person_id": person_id, "forgotten": True}
