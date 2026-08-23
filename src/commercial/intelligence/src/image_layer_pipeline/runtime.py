"""运行时：多任务并发时串行化 GPU/ONNX 推理，避免竞态。"""

from __future__ import annotations

import threading

# rembg / LaMa / Depth 模型非线程安全，多 worker 时通过此锁串行推理
INFERENCE_LOCK = threading.RLock()
