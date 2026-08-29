"""
The claim being tested is narrow and worth stating: fitted on two weeks of
ordinary weekdays, the engine should call an 08:47 Tuesday arrival normal and a
03:00 Sunday server-room entry anomalous — without anyone having labelled a
single example.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.features import AccessEvent, to_vector          # noqa: E402
from app.model import MIN_EVENTS_TO_FIT, ModelStore      # noqa: E402
from app.rules import evaluate                           # noqa: E402
from app.synthetic import generate_history               # noqa: E402


MONDAY = datetime(2026, 8, 24, 0, 0)  # a known Monday, so weekday maths is fixed


def ev(day_offset: int, hour: int, minute: int = 0, door: str = "MAIN-01",
       building: int = 1, success: bool = True, eid: str = "e") -> AccessEvent:
    return AccessEvent(
        event_id=eid,
        person_id="p1",
        did="did:ethr:sep:0xabc",
        door_code=door,
        building_id=building,
        timestamp=MONDAY + timedelta(days=day_offset, hours=hour, minutes=minute),
        success=success,
    )


# ── features ────────────────────────────────────────────────────────────────

def test_midnight_is_adjacent_to_itself():
    # A raw minute count would put 23:59 and 00:01 at opposite ends of the
    # range, so the model would read two minutes as the largest possible gap.
    before = to_vector(ev(0, 23, 59), None)[:2]
    after = to_vector(ev(1, 0, 1), None)[:2]
    distance = sum((a - b) ** 2 for a, b in zip(before, after)) ** 0.5
    assert distance < 0.02


def test_gap_is_relative_to_the_previous_event():
    previous = ev(0, 9, 0)
    close = to_vector(ev(0, 9, 5), previous)[4]
    far = to_vector(ev(0, 17, 0), previous)[4]
    assert far > close


# ── deterministic rules ─────────────────────────────────────────────────────

def test_same_identity_in_two_buildings_is_impossible():
    history = [ev(0, 9, 0, building=1)]
    hits = evaluate(ev(0, 9, 5, door="OTHER-01", building=2), history)
    assert any(h.rule == "impossible_travel" and h.severity == "high" for h in hits)


def test_normal_travel_between_buildings_is_fine():
    history = [ev(0, 9, 0, building=1)]
    hits = evaluate(ev(0, 11, 0, door="OTHER-01", building=2), history)
    assert not any(h.rule == "impossible_travel" for h in hits)


def test_interior_door_without_passing_an_entrance():
    history = [ev(0, 9, 0, door="OFFICE-02")]
    hits = evaluate(ev(0, 9, 30, door="SERVER-03"), history)
    assert any(h.rule == "no_entry_first" for h in hits)


def test_interior_door_is_fine_after_the_main_door():
    history = [ev(0, 8, 45, door="MAIN-01")]
    hits = evaluate(ev(0, 9, 0, door="SERVER-03"), history)
    assert not any(h.rule == "no_entry_first" for h in hits)


def test_repeated_failures_then_a_success():
    history = [ev(0, 9, m, success=False, eid=f"f{m}") for m in (0, 2, 4)]
    hits = evaluate(ev(0, 9, 6), history)
    assert any(h.rule == "failures_then_success" and h.severity == "high" for h in hits)


def test_night_access_needs_history_before_it_is_unusual():
    # With three prior events there is no basis to call 03:00 out of character.
    assert not any(h.rule == "unusual_hour" for h in evaluate(ev(0, 3, 0), [ev(-1, 9, 0)]))

    daytime = [ev(-d, 9, 0, eid=f"d{d}") for d in range(1, 21)]
    assert any(h.rule == "unusual_hour" for h in evaluate(ev(0, 3, 0), daytime))


# ── the model ───────────────────────────────────────────────────────────────

def test_no_baseline_is_not_an_anomaly(tmp_path: Path):
    # A new joiner must not be flagged on their first day.
    store = ModelStore(tmp_path)
    verdict = store.score("nobody", ev(0, 9, 0), None)
    assert verdict.is_anomaly is False
    assert verdict.model_trained is False


def test_refuses_to_fit_on_too_little_history(tmp_path: Path):
    store = ModelStore(tmp_path)
    store.fit("p1", [ev(-d, 9, 0, eid=f"e{d}") for d in range(5)])
    assert store.has_model("p1") is False


def test_learns_a_routine_and_flags_a_departure_from_it(tmp_path: Path):
    store = ModelStore(tmp_path)
    history = generate_history("p1", "did:x", days=21, seed=7, end=MONDAY)
    assert len(history) >= MIN_EVENTS_TO_FIT
    store.fit("p1", history)

    previous = history[-1]

    # A Tuesday morning arrival, exactly the shape of the training data.
    normal = store.score("p1", ev(1, 8, 47), previous)
    # 03:00 on a Sunday at an unusual door.
    odd = store.score("p1", ev(6, 3, 12, door="SERVER-03"), previous)

    assert odd.anomaly_score > normal.anomaly_score
    assert odd.is_anomaly is True
    assert normal.is_anomaly is False


def test_a_model_survives_a_restart(tmp_path: Path):
    ModelStore(tmp_path).fit("p1", generate_history("p1", "did:x", days=21, seed=7, end=MONDAY))
    # A fresh store with a cold cache must still find the fitted model.
    assert ModelStore(tmp_path).has_model("p1") is True


def test_forget_removes_the_model(tmp_path: Path):
    store = ModelStore(tmp_path)
    store.fit("p1", generate_history("p1", "did:x", days=21, seed=7, end=MONDAY))
    store.forget("p1")
    assert store.has_model("p1") is False


# ── synthetic history ───────────────────────────────────────────────────────

def test_synthetic_history_skips_weekends():
    events = generate_history("p1", "did:x", days=14, seed=1, end=MONDAY)
    assert events
    assert all(e.timestamp.weekday() < 5 for e in events)


def test_synthetic_history_is_marked_as_such():
    events = generate_history("p1", "did:x", days=7, seed=1, end=MONDAY)
    assert all(e.event_id.startswith("synthetic-") for e in events)


# ── the API ─────────────────────────────────────────────────────────────────

@pytest.fixture()
def client(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("MODEL_DIR", str(tmp_path))
    import importlib
    from app import main as main_module
    importlib.reload(main_module)
    return TestClient(main_module.app)


def test_health(client: TestClient):
    body = client.get("/health").json()
    assert body["status"] == "ok"


def test_seed_then_score(client: TestClient):
    seeded = client.post("/behavior/seed", json={
        "person_id": "p1", "did": "did:ethr:sep:0xabc", "days": 21, "seed": 3,
    }).json()
    assert seeded["events_generated"] > MIN_EVENTS_TO_FIT
    assert seeded["model_fitted"] is True
    assert seeded["synthetic"] is True

    def score(when: str, door: str = "MAIN-01", building: int = 1) -> dict:
        return client.post("/behavior/event", json={
            "event_id": "x", "person_id": "p1", "did": "did:ethr:sep:0xabc",
            "door_code": door, "building_id": building,
            "timestamp": when, "success": True,
        }).json()

    normal = score("2026-08-25T08:47:00")           # Tuesday morning
    odd = score("2026-08-30T03:12:00", "SERVER-03")  # Sunday, 03:12

    assert odd["anomaly_score"] > normal["anomaly_score"]
    assert odd["is_anomaly"] is True
    assert normal["model_trained"] is True


def test_a_hard_rule_outranks_the_model(client: TestClient):
    client.post("/behavior/seed", json={"person_id": "p1", "did": "did:x", "days": 21, "seed": 3})
    client.post("/behavior/event", json={
        "event_id": "a", "person_id": "p1", "did": "did:x", "door_code": "MAIN-01",
        "building_id": 1, "timestamp": "2026-08-25T09:00:00", "success": True,
    })
    # Same identity, other building, five minutes later — physically impossible.
    body = client.post("/behavior/event", json={
        "event_id": "b", "person_id": "p1", "did": "did:x", "door_code": "OTHER-01",
        "building_id": 2, "timestamp": "2026-08-25T09:05:00", "success": True,
    }).json()

    assert body["is_anomaly"] is True
    assert body["anomaly_score"] >= 0.95
    assert any(h["rule"] == "impossible_travel" for h in body["rule_hits"])


def test_unknown_person_is_scored_but_not_flagged(client: TestClient):
    body = client.post("/behavior/event", json={
        "event_id": "z", "person_id": "stranger", "did": "did:y",
        "door_code": "MAIN-01", "building_id": 1,
        "timestamp": "2026-08-25T09:00:00", "success": True,
    }).json()
    assert body["is_anomaly"] is False
    assert body["model_trained"] is False


def test_forget_endpoint(client: TestClient):
    client.post("/behavior/seed", json={"person_id": "p1", "did": "did:x", "days": 21, "seed": 3})
    assert client.delete("/behavior/p1").json()["forgotten"] is True
    body = client.post("/behavior/event", json={
        "event_id": "z", "person_id": "p1", "did": "did:x", "door_code": "MAIN-01",
        "building_id": 1, "timestamp": "2026-08-25T09:00:00", "success": True,
    }).json()
    assert body["model_trained"] is False
