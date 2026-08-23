"""Lazy OpenCLIP encoder for layout / color / style towers.

Requires optional extras: pip install -e ".[clip]"
"""

from __future__ import annotations

import logging
import threading
from typing import Any

from PIL import Image

logger = logging.getLogger(__name__)

MODEL_ID = "openclip-vit-b-32"
EMB_DIM = 512

_lock = threading.Lock()
_model: Any = None
_preprocess: Any = None
_device: str = "cpu"
_load_error: str | None = None


def clip_available() -> bool:
    try:
        import numpy  # noqa: F401
        import open_clip  # noqa: F401
        import torch  # noqa: F401

        return True
    except Exception:
        return False


def _ensure_model() -> None:
    global _model, _preprocess, _device, _load_error
    if _model is not None:
        return
    with _lock:
        if _model is not None:
            return
        try:
            import os
            import time

            import open_clip
            import torch

            # China-friendly HF mirror if not already set (weights download).
            os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

            t0 = time.time()
            msg = "[exec] +0.00s mode=embed phase=clip_load_start"
            logger.info(msg)
            print(msg, flush=True)

            device = "cuda" if torch.cuda.is_available() else "cpu"
            model, _, preprocess = open_clip.create_model_and_transforms(
                "ViT-B-32",
                pretrained="openai",
            )
            model = model.to(device)
            model.eval()
            _model = model
            _preprocess = preprocess
            _device = device
            _load_error = None
            took = time.time() - t0
            logger.info("OpenCLIP ViT-B-32 loaded on %s", device)
            done = (
                f"[exec] +{took:6.2f}s mode=embed phase=clip_load_done "
                f"device={device!r} took_s={took:.2f}"
            )
            logger.info(done)
            print(done, flush=True)
        except Exception as exc:
            _load_error = str(exc)
            logger.exception("OpenCLIP load failed")
            raise RuntimeError(
                "OpenCLIP 权重未就绪。首次需能访问 HuggingFace（可设 HF_ENDPOINT=https://hf-mirror.com）。"
                f" 原始错误: {exc}"
            ) from exc


def clip_status() -> dict[str, Any]:
    return {
        "available": clip_available(),
        "loaded": _model is not None,
        "device": _device,
        "model": MODEL_ID,
        "dim": EMB_DIM,
        "error": _load_error,
        "hint": (
            None
            if clip_available()
            else 'Install extras: pip install -e ".[clip]" (torch + open-clip-torch + numpy)'
        ),
    }


def encode_pil(img: Image.Image) -> Any:
    """Return L2-normalized float32 vector (EMB_DIM,)."""
    import numpy as np
    import torch

    _ensure_model()
    assert _model is not None and _preprocess is not None
    with torch.no_grad():
        t = _preprocess(img).unsqueeze(0).to(_device)
        feat = _model.encode_image(t)
        feat = feat / feat.norm(dim=-1, keepdim=True)
        vec = feat.squeeze(0).detach().cpu().numpy().astype(np.float32)
    return vec


def encode_text(text: str) -> Any:
    """CLIP text tower → L2-normalized float32 vector (for pre-draw RAG)."""
    import numpy as np
    import open_clip
    import torch

    _ensure_model()
    assert _model is not None
    query = (text or "").strip() or "clean modern UI design"
    # Keep short — CLIP text encoder truncates heavily.
    query = query[:240]
    tokenizer = open_clip.get_tokenizer("ViT-B-32")
    with torch.no_grad():
        tokens = tokenizer([query]).to(_device)
        feat = _model.encode_text(tokens)
        feat = feat / feat.norm(dim=-1, keepdim=True)
        vec = feat.squeeze(0).detach().cpu().numpy().astype(np.float32)
    return vec


def encode_towers(
    layout_img: Image.Image,
    color_img: Image.Image,
    style_img: Image.Image,
) -> dict[str, Any]:
    """Encode three views → little-endian float32 blobs + dim."""
    layout = encode_pil(layout_img)
    color = encode_pil(color_img)
    style = encode_pil(style_img)
    return {
        "layout_emb": layout.tobytes(order="C"),
        "color_emb": color.tobytes(order="C"),
        "style_emb": style.tobytes(order="C"),
        "dim": int(layout.shape[0]),
    }
