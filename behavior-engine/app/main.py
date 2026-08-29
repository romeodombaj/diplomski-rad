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

from fastapi import FastAPI
from pydantic import BaseModel, Field

from .features import AccessEvent
from .model import MIN_EVENTS_TO_FIT, ModelStore
from .rules import evaluate
from .synthetic import generate_history

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("behavior-engine")

MODEL_DIR = Path(os.environ.get("MODEL_DIR", "/data/models"))
# Events kept in memory per person, for the rules and the gap feature. The
# backend's access_events table is the durable record; this is a working window.
HISTORY_WINDOW = int(os.environ.get("HISTORY_WINDOW", "500"))
# Refit every N new events rather than on each one: fitting 100 trees on every
# door open would make the engine the slowest thing in the request path.
REFIT_EVERY = int(os.environ.get("REFIT_EVERY", "25"))

app = FastAPI(title="Behaviour engine", version="1.0.0")
store = ModelStore(MODEL_DIR)
history: dict[str, Deque[AccessEvent]] = defaultdict(lambda: deque(maxlen=HISTORY_WINDOW))
since_fit: dict[str, int] = defaultdict(int)


# ── contracts ───────────────────────────────────────────────────────────────

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


class ScoreOut(BaseModel):
    event_id: str
    anomaly_score: float = Field(ge=0.0, le=1.0)
    is_anomaly: bool
    reason: str
    # Deterministic hits are returned separately from the model score: they are
    # certainties, not probabilities, and a dashboard should not average them
    # into a number that looks like a confidence.
    rule_hits: list[RuleHitOut] = []
    model_trained: bool
    events_in_baseline: int


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


# ── helpers ─────────────────────────────────────────────────────────────────

def _key(event: EventIn) -> str:
    """
    Models are keyed by person, falling back to DID.

    A person who replaces a stolen phone gets a new DID but is the same human
    with the same habits, so keying on the person keeps their baseline. The DID
    fallback exists because a denied event may not resolve to a person at all.
    """
    return event.person_id or event.did


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


# ── endpoints ───────────────────────────────────────────────────────────────

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
    previous = past[-1] if past else None

    verdict = store.score(key, domain, previous)
    hits = [RuleHitOut(**h.__dict__) for h in evaluate(domain, past)]

    # Remember it, then refit periodically so the baseline follows genuine
    # change (a new shift pattern) rather than freezing at enrolment.
    history[key].append(domain)
    since_fit[key] += 1
    if since_fit[key] >= REFIT_EVERY and len(history[key]) >= MIN_EVENTS_TO_FIT:
        store.fit(key, list(history[key]))
        since_fit[key] = 0

    # A hard rule outranks the model. The model expresses "unusual"; a rule
    # expresses "impossible", and impossible should never be softened by a
    # forest that has not seen enough data to disagree.
    high = [h for h in hits if h.severity == "high"]
    if high:
        return ScoreOut(
            event_id=event.event_id,
            anomaly_score=max(verdict.anomaly_score, 0.95),
            is_anomaly=True,
            reason=high[0].reason,
            rule_hits=hits,
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
            model_trained=verdict.model_trained,
            events_in_baseline=verdict.events_in_baseline,
        )

    return ScoreOut(
        event_id=event.event_id,
        anomaly_score=verdict.anomaly_score,
        is_anomaly=verdict.is_anomaly,
        reason=verdict.reason,
        rule_hits=hits,
        model_trained=verdict.model_trained,
        events_in_baseline=verdict.events_in_baseline,
    )


@app.post("/behavior/train")
def train(person_id: str, events: list[EventIn]) -> dict:
    """Fit a person's model from real history the backend already holds."""
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
