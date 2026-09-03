"""
The claim being tested is narrow and worth stating: fitted on two weeks of
ordinary weekdays, the engine should call an 08:47 Tuesday arrival normal and a
03:00 Sunday server-room entry anomalous — without anyone having labelled a
single example.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import joblib
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.features import (                               # noqa: E402
    AccessEvent, Familiarity, previous_before, to_vector,
)
from app.model import MIN_EVENTS_TO_FIT, ModelStore      # noqa: E402
from app.profile import build as build_baseline          # noqa: E402
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


def test_a_door_is_encoded_by_how_familiar_it_is():
    # Not by an id or a hash: an unseen door has to land below everything in
    # the baseline, which is where an Isolation Forest isolates quickly. A
    # hashed id lands wherever the hash falls, usually mid-range, where the
    # forest sees nothing unusual.
    familiar = Familiarity.of([ev(-d, 9, 0, door="MAIN-01", eid=f"d{d}") for d in range(10)])
    known = to_vector(ev(0, 9, 0, door="MAIN-01"), None, familiar)[3]
    unknown = to_vector(ev(0, 9, 0, door="SERVER-03"), None, familiar)[3]
    assert known == 1.0
    assert unknown == 0.0


def test_an_unworked_day_is_encoded_as_unfamiliar():
    # `is_weekend` was constant for a weekday-only history, and a constant
    # column carries no split a tree can use — a Saturday was invisible.
    weekdays = generate_history("p1", "did:x", days=21, seed=7, end=MONDAY)
    familiar = Familiarity.of(weekdays)
    assert to_vector(ev(5, 9, 0), None, familiar)[2] == 0.0     # a Saturday
    assert to_vector(weekdays[0], None, familiar)[2] > 0.0


def test_utc_from_the_backend_becomes_local_wall_clock():
    # The backend sends "...Z"; the baseline is local time. Comparing the two
    # raises, and the endpoint used to 500 on the first real event it got.
    aware = AccessEvent(
        event_id="e", person_id="p1", did="did:x", door_code="MAIN-01", building_id=1,
        timestamp=datetime(2026, 9, 6, 3, 12, tzinfo=timezone.utc), success=True,
    )
    assert aware.timestamp.tzinfo is None
    assert aware.timestamp == datetime(2026, 9, 6, 3, 12, tzinfo=timezone.utc).astimezone().replace(tzinfo=None)
    # And it is then comparable with everything else the engine holds.
    assert previous_before([ev(0, 9, 0)], aware.timestamp) is not None


def test_the_previous_event_is_the_one_before_this_one():
    # History does not always arrive in order: a baseline is loaded in one go
    # and can end later than an event being scored. Taking the newest known
    # event regardless produced a negative gap, silently encoded as zero.
    history = [ev(0, 9, 0, eid="a"), ev(3, 9, 0, eid="d")]
    assert previous_before(history, ev(1, 9, 0).timestamp).event_id == "a"
    assert previous_before(history, ev(-1, 9, 0).timestamp) is None


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


def test_a_reloaded_model_scores_a_door_the_same_way(tmp_path: Path):
    # The door encoding used the builtin `hash`, which CPython salts per
    # process: the same door became a different feature value after a restart,
    # so a persisted baseline quietly stopped describing anything.
    history = generate_history("p1", "did:x", days=21, seed=7, end=MONDAY)
    ModelStore(tmp_path).fit("p1", history)
    event = ev(1, 9, 0, door="SERVER-03")
    previous = history[-1]

    fresh = ModelStore(tmp_path).score("p1", event, previous)
    subprocess_equivalent = ModelStore(tmp_path).score("p1", event, previous)
    assert fresh.anomaly_score == subprocess_equivalent.anomaly_score


def test_a_model_file_from_an_older_encoding_is_discarded(tmp_path: Path):
    # An old file is not merely incomplete: its doors were encoded under a
    # different scheme, so scoring against it would compare unlike things.
    store = ModelStore(tmp_path)
    store.fit("p1", generate_history("p1", "did:x", days=21, seed=7, end=MONDAY))
    path = next(tmp_path.glob("*.joblib"))
    blob = joblib.load(path)
    joblib.dump({**blob, "v": 1}, path)

    assert ModelStore(tmp_path).has_model("p1") is False


def test_a_normal_fortnight_is_not_flagged(tmp_path: Path):
    # The claim that matters operationally. An engine that cries wolf on the
    # ordinary week after the one it trained on is an engine nobody reads.
    store = ModelStore(tmp_path)
    history = list(generate_history("p1", "did:x", days=21, seed=7, end=MONDAY))
    store.fit("p1", history)

    later = [
        e for e in generate_history("p1", "did:x", days=14, seed=99, end=MONDAY + timedelta(days=14))
        if e.timestamp >= MONDAY
    ]
    flagged = 0
    for event in later:
        flagged += store.score("p1", event, previous_before(history, event.timestamp)).is_anomaly
        history.append(event)

    assert later, "the fixture must actually produce events"
    assert flagged == 0


# ── explaining a score ──────────────────────────────────────────────────────

def test_a_score_comes_with_the_reasons_for_it(tmp_path: Path):
    # A number an operator cannot check is a number they learn to ignore.
    store = ModelStore(tmp_path)
    history = generate_history("p1", "did:x", days=21, seed=7, end=MONDAY)
    store.fit("p1", history)

    night = ev(0, 3, 0, door="SERVER-03")
    verdict = store.score("p1", night, previous_before(history, night.timestamp))

    assert verdict.factors, "a trained model must say why"
    assert {f.factor for f in verdict.factors} == {
        "time_of_day", "day_of_week", "door", "interval", "first_of_day",
    }
    # Shares describe the push towards "unusual", so they add up to one.
    assert sum(f.share for f in verdict.factors) == pytest.approx(1.0, abs=0.01)
    # And the reason names the leading driver rather than restating the score.
    assert verdict.reason == verdict.factors[0].detail


def test_an_unusual_hour_is_attributed_to_the_hour(tmp_path: Path):
    # The explanation is a counterfactual, and it has to survive being checked:
    # moving only the clock has to move only the time-of-day share.
    store = ModelStore(tmp_path)
    history = generate_history("p1", "did:x", days=21, seed=7, end=MONDAY)
    store.fit("p1", history)
    previous = history[-1]

    def time_factor(hour: int):
        verdict = store.score("p1", ev(0, hour, 0), previous)
        return next(f for f in verdict.factors if f.factor == "time_of_day")

    night, morning = time_factor(3), time_factor(9)
    assert night.delta > morning.delta
    assert night.delta > 0
    assert night.value == "03:00"
    assert ":" in night.usual  # the window it is being compared against


def test_an_unfamiliar_door_is_attributed_to_the_door(tmp_path: Path):
    store = ModelStore(tmp_path)
    history = generate_history("p1", "did:x", days=21, seed=7, end=MONDAY)
    store.fit("p1", history)
    previous = history[-1]

    def door_factor(door: str):
        verdict = store.score("p1", ev(0, 9, 0, door=door), previous)
        return next(f for f in verdict.factors if f.factor == "door")

    stranger, usual = door_factor("SERVER-03"), door_factor("MAIN-01")
    assert stranger.delta > usual.delta
    assert stranger.usual == "never used before"


def test_an_unexplainable_score_says_so(tmp_path: Path):
    # No baseline, no factors — an unexplained number is reported as such
    # rather than dressed up with reasons nothing supports.
    verdict = ModelStore(tmp_path).score("nobody", ev(0, 3, 0), None)
    assert verdict.factors == []


# ── the baseline an operator is shown ───────────────────────────────────────

def test_the_baseline_describes_the_history_it_was_fitted_on(tmp_path: Path):
    store = ModelStore(tmp_path)
    history = generate_history("p1", "did:x", days=21, seed=7, end=MONDAY)
    store.fit("p1", history)
    baseline = store.baseline("p1")

    assert baseline.events == len(history)
    # Office hours, give or take the generator's jitter.
    assert 7 * 60 <= baseline.usual_from_minute <= 10 * 60
    assert 16 * 60 <= baseline.usual_to_minute <= 18 * 60
    assert baseline.doors[0].door_code == "MAIN-01"
    assert baseline.weekend_share == 0.0
    assert baseline.events_per_day > 1


def test_a_seeded_baseline_admits_that_it_is_seeded(tmp_path: Path):
    # The cold-start fix is only honest if it is stated: a generated baseline
    # must never be read as two weeks of watching someone.
    seeded = build_baseline(generate_history("p1", "did:x", days=21, seed=7, end=MONDAY))
    assert seeded.synthetic is True

    observed = build_baseline([ev(-d, 9, 0, eid=f"real-{d}") for d in range(1, 25)])
    assert observed.synthetic is False


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


def test_a_score_carries_its_factors_over_the_api(client: TestClient):
    client.post("/behavior/seed", json={"person_id": "p1", "did": "did:x", "days": 21, "seed": 3})
    body = client.post("/behavior/event", json={
        "event_id": "n", "person_id": "p1", "did": "did:x", "door_code": "SERVER-03",
        "building_id": 1, "timestamp": "2026-08-30T03:12:00", "success": True,
    }).json()

    assert body["factors"], "the dashboard has to be able to show why"
    lead = body["factors"][0]
    assert set(lead) == {"factor", "share", "delta", "value", "usual", "detail"}
    assert body["reason"] == lead["detail"]


def test_profile_serves_the_baseline_a_score_is_measured_against(client: TestClient):
    client.post("/behavior/seed", json={"person_id": "p1", "did": "did:x", "days": 21, "seed": 3})
    body = client.get("/behavior/profile/p1").json()

    assert body["model_trained"] is True
    assert body["events_in_baseline"] > MIN_EVENTS_TO_FIT
    # Seeded, and saying so — a generated baseline must never read as observed.
    assert body["synthetic"] is True
    assert body["doors"][0]["door_code"] == "MAIN-01"
    assert body["usual_from"] < body["usual_to"]
    assert sum(body["hour_histogram"]) == body["events_in_baseline"]


def test_profile_for_someone_with_no_history(client: TestClient):
    body = client.get("/behavior/profile/stranger").json()
    assert body["model_trained"] is False
    assert body["events_in_baseline"] == 0


def test_training_on_nothing_is_refused(client: TestClient):
    # This call replaces the working history, so an empty one would erase a
    # baseline rather than retrain it.
    assert client.post("/behavior/train?person_id=p1", json=[]).status_code == 400


def test_forget_endpoint(client: TestClient):
    client.post("/behavior/seed", json={"person_id": "p1", "did": "did:x", "days": 21, "seed": 3})
    assert client.delete("/behavior/p1").json()["forgotten"] is True
    body = client.post("/behavior/event", json={
        "event_id": "z", "person_id": "p1", "did": "did:x", "door_code": "MAIN-01",
        "building_id": 1, "timestamp": "2026-08-25T09:00:00", "success": True,
    }).json()
    assert body["model_trained"] is False
