"""Timing and memory of a job, reported in the summary so the operator sees how the
system performs (seconds per step, file sizes, memory of the worker)."""

from __future__ import annotations

import time


def peak_memory_mb() -> float | None:
    """Highest memory the worker process has used so far (Linux), in MB.

    The worker is reused between jobs, so this is the peak of the process, a ceiling for
    this job rather than its exact use."""

    try:
        import resource
    except ImportError:  # Windows (development only)
        return None
    return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)


class Stopwatch:
    def __init__(self) -> None:
        self.started = time.perf_counter()
        self.last = self.started
        self.steps: dict[str, float] = {}

    def lap(self, name: str) -> None:
        now = time.perf_counter()
        self.steps[name] = round(self.steps.get(name, 0.0) + now - self.last, 2)
        self.last = now

    def report(self, **extra: object) -> dict[str, object]:
        return {
            "seconds": self.steps,
            "totalSeconds": round(time.perf_counter() - self.started, 2),
            "peakMemoryMb": peak_memory_mb(),
            **{key: value for key, value in extra.items() if value is not None},
        }
