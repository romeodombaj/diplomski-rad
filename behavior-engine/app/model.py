"""
One Isolation Forest per person.

Per-user rather than one shared model, because the spec's claim is about what
is normal *for this user* — a 22:00 entry is unremarkable for a night-shift
cleaner and alarming for someone who has left at 17:00 every day for a year. A
single cross-user model would learn the average of both and flag neither.

Isolation Forest specifically: it needs no labelled anomalies, which is the
whole difficulty here. Nobody has a dataset of "break-ins by this employee".
It works by measuring how few random splits it takes to isolate a point —
outliers separate quickly.
"""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Sequence

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest

from . import profile as profiles
from .explain import Factor, contributions
from .features import AccessEvent, to_matrix, to_vector

log = logging.getLogger(__name__)

MIN_EVENTS_TO_FIT = 20

CONTAMINATION = 0.05

BLOB_VERSION = 2


@dataclass
class Verdict:
    anomaly_score: float
    is_anomaly: bool
    reason: str
    model_trained: bool
    events_in_baseline: int
    factors: list[Factor] = field(default_factory=list)
    baseline: profiles.Baseline | None = None


@dataclass(frozen=True)
class Fitted:
    """A person's model and the history it was fitted on, as one unit."""

    forest: IsolationForest
    events: int
    baseline: profiles.Baseline


class ModelStore:
    """
    Fitted models on disk, one file per person.

    Persisted so a restart does not throw away a baseline that took two weeks
    of real usage to accumulate.
    """

    def __init__(self, directory: Path) -> None:
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)
        self._cache: dict[str, Fitted] = {}
        self._lock = threading.Lock()

    def _path(self, person_id: str) -> Path:
        safe = "".join(c for c in person_id if c.isalnum() or c in "-_")
        return self.directory / f"{safe}.joblib"

    def fit(self, person_id: str, history: Sequence[AccessEvent]) -> int:
        """Fit this person's model. Returns the number of events used."""
        if len(history) < MIN_EVENTS_TO_FIT:
            return len(history)

        matrix = np.asarray(to_matrix(history), dtype=float)
        forest = IsolationForest(
            n_estimators=100,
            contamination=CONTAMINATION,
            random_state=42,
        )
        forest.fit(matrix)
        baseline = profiles.build(history)

        with self._lock:
            self._cache[person_id] = Fitted(forest, len(history), baseline)
            joblib.dump(
                {"v": BLOB_VERSION, "model": forest, "n": len(history), "baseline": baseline},
                self._path(person_id),
            )

        log.info("fitted model for %s on %d events", person_id, len(history))
        return len(history)

    def _load(self, person_id: str) -> Fitted | None:
        with self._lock:
            if person_id in self._cache:
                return self._cache[person_id]

        path = self._path(person_id)
        if not path.exists():
            return None
        try:
            blob = joblib.load(path)
            if blob.get("v") != BLOB_VERSION:
                log.warning(
                    "discarding model for %s: blob version %s, expected %s",
                    person_id, blob.get("v"), BLOB_VERSION,
                )
                return None
            entry = Fitted(blob["model"], blob["n"], blob["baseline"])
            with self._lock:
                self._cache[person_id] = entry
            return entry
        except Exception as exc:
            log.warning("could not load model for %s: %s", person_id, exc)
            return None

    def score(
        self,
        person_id: str,
        event: AccessEvent,
        previous: AccessEvent | None,
    ) -> Verdict:
        entry = self._load(person_id)
        if entry is None:
            return Verdict(
                anomaly_score=0.0,
                is_anomaly=False,
                reason="No baseline yet for this person.",
                model_trained=False,
                events_in_baseline=0,
            )

        row = to_vector(event, previous, entry.baseline.familiarity)
        vector = np.asarray([row], dtype=float)

        score = self._as_score(entry.forest, row)
        is_anomaly = bool(entry.forest.predict(vector)[0] == -1)

        factors = contributions(
            lambda v: self._as_score(entry.forest, v),
            row, entry.baseline, event, previous,
        )
        lead = factors[0] if factors and factors[0].delta > 0 else None

        return Verdict(
            anomaly_score=round(score, 4),
            is_anomaly=is_anomaly,
            reason=(
                (lead.detail if lead else "Pattern differs from this person's usual access behaviour.")
                if is_anomaly else "Consistent with this person's usual behaviour."
            ),
            model_trained=True,
            events_in_baseline=entry.events,
            factors=factors,
            baseline=entry.baseline,
        )

    @staticmethod
    def _as_score(forest: IsolationForest, row: Sequence[float]) -> float:
        """One feature vector as the 0..1 score the whole system quotes."""
        raw = float(forest.decision_function(np.asarray([row], dtype=float))[0])
        return float(np.clip(0.5 - raw, 0.0, 1.0))

    def has_model(self, person_id: str) -> bool:
        return self._load(person_id) is not None

    def baseline(self, person_id: str) -> profiles.Baseline | None:
        """This person's history as the model sees it, for the dashboard."""
        entry = self._load(person_id)
        return entry.baseline if entry else None

    def forget(self, person_id: str) -> None:
        with self._lock:
            self._cache.pop(person_id, None)
        self._path(person_id).unlink(missing_ok=True)
