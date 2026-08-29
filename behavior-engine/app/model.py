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
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest

from .features import AccessEvent, to_matrix, to_vector

log = logging.getLogger(__name__)

# Below this, a "baseline" is noise. Scoring against three events would flag
# almost anything, so the engine says "still learning" instead of guessing.
MIN_EVENTS_TO_FIT = 20

# Expected share of the training data that is anomalous. Left low on purpose:
# the history is assumed to be mostly normal behaviour.
CONTAMINATION = 0.05


@dataclass
class Verdict:
    anomaly_score: float          # 0..1, higher = more unusual
    is_anomaly: bool
    reason: str
    model_trained: bool           # False when there was no baseline to compare to
    events_in_baseline: int


class ModelStore:
    """
    Fitted models on disk, one file per person.

    Persisted so a restart does not throw away a baseline that took two weeks
    of real usage to accumulate.
    """

    def __init__(self, directory: Path) -> None:
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)
        self._cache: dict[str, tuple[IsolationForest, int]] = {}
        # FastAPI serves requests concurrently; fitting mutates the cache.
        self._lock = threading.Lock()

    def _path(self, person_id: str) -> Path:
        # person_id is a UUID from the backend, but never trust it as a filename.
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
            random_state=42,   # reproducible: the same history gives the same model
        )
        forest.fit(matrix)

        with self._lock:
            self._cache[person_id] = (forest, len(history))
            joblib.dump({"model": forest, "n": len(history)}, self._path(person_id))

        log.info("fitted model for %s on %d events", person_id, len(history))
        return len(history)

    def _load(self, person_id: str) -> tuple[IsolationForest, int] | None:
        with self._lock:
            if person_id in self._cache:
                return self._cache[person_id]

        path = self._path(person_id)
        if not path.exists():
            return None
        try:
            blob = joblib.load(path)
            entry = (blob["model"], blob["n"])
            with self._lock:
                self._cache[person_id] = entry
            return entry
        except Exception as exc:  # a corrupt file must not take the service down
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
            # Not an anomaly — an unknown. Reporting 0.0 rather than a guess
            # keeps a new joiner from being flagged on their first day.
            return Verdict(
                anomaly_score=0.0,
                is_anomaly=False,
                reason="No baseline yet for this person.",
                model_trained=False,
                events_in_baseline=0,
            )

        forest, n = entry
        vector = np.asarray([to_vector(event, previous)], dtype=float)

        # decision_function: positive is normal, negative is an outlier, and it
        # is roughly in [-0.5, 0.5]. Mapped to 0..1 so the dashboard has one
        # consistent scale to colour by.
        raw = float(forest.decision_function(vector)[0])
        score = float(np.clip(0.5 - raw, 0.0, 1.0))
        is_anomaly = bool(forest.predict(vector)[0] == -1)

        return Verdict(
            anomaly_score=round(score, 4),
            is_anomaly=is_anomaly,
            reason=(
                "Pattern differs from this person's usual access behaviour."
                if is_anomaly else "Consistent with this person's usual behaviour."
            ),
            model_trained=True,
            events_in_baseline=n,
        )

    def has_model(self, person_id: str) -> bool:
        return self._load(person_id) is not None

    def forget(self, person_id: str) -> None:
        with self._lock:
            self._cache.pop(person_id, None)
        self._path(person_id).unlink(missing_ok=True)
