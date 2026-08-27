"""运行时：按后端拆分推理锁；同后端串行，跨后端可并行（受 GPU 并发上限约束）。

默认 ``ILP_GPU_PARALLEL=1``：同一时刻只跑一个 GPU 类任务，避免小显存 OOM。
OCR 等纯 CPU 路径不持有这些锁。
"""

from __future__ import annotations

import os
import threading
from collections.abc import Iterator
from contextlib import contextmanager

_BACKEND_LOCKS: dict[str, threading.RLock] = {
    "matting": threading.RLock(),
    "sam": threading.RLock(),
    "depth": threading.RLock(),
    "lama": threading.RLock(),
    "esrgan": threading.RLock(),
}

# Backward-compatible alias — historical call sites serialized everything on this lock.
INFERENCE_LOCK = _BACKEND_LOCKS["matting"]


def _gpu_parallel_slots() -> int:
    raw = str(os.environ.get("ILP_GPU_PARALLEL") or "1").strip()
    try:
        return max(1, min(4, int(raw)))
    except ValueError:
        return 1


_GPU_SLOTS = threading.Semaphore(_gpu_parallel_slots())


def inference_lock(backend: str = "matting") -> threading.RLock:
    key = (backend or "matting").strip().lower() or "matting"
    return _BACKEND_LOCKS.get(key) or _BACKEND_LOCKS["matting"]


@contextmanager
def hold_inference(backend: str = "matting") -> Iterator[None]:
    """Acquire per-backend lock + shared GPU slot (quality-safe default: 1 slot)."""
    lock = inference_lock(backend)
    with _GPU_SLOTS:
        with lock:
            yield
