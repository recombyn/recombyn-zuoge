"""CLIP text embeddings + RAG helpers (LangChain Embeddings / Documents / splitter).

Local OpenCLIP has no ``init_embeddings`` provider — expose ``ClipTextEmbeddings``.
MySQL still stores vectors; retrieve ranks precomputed blobs via cosine.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any, Callable

from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings
from langchain_core.prompts import PromptTemplate, format_document

logger = logging.getLogger(__name__)


def encode_text_vec(text: str) -> Any | None:
    """L2-normalized float32 vector, or None if CLIP unavailable / failed."""
    query = (text or "").strip()
    if not query:
        return None
    t0 = time.time()
    try:
        from app.services.agent_memory.clip_encoder import (
            clip_available,
            clip_status,
            encode_text,
        )

        avail = clip_available()
        st = clip_status() if avail else {}
        if not avail:
            logger.info(
                "[exec] +0.00s mode=embed phase=skip reason='clip_unavailable' "
                "query_chars=%s",
                len(query),
            )
            return None
        already = bool(st.get("loaded"))
        vec = encode_text(query)
        ms = int((time.time() - t0) * 1000)
        logger.info(
            "[exec] +%.2fs mode=embed phase=encode_text ms=%s cold_load=%s "
            "device=%r query_chars=%s dim=%s",
            time.time() - t0,
            ms,
            not already,
            st.get("device"),
            len(query),
            getattr(vec, "shape", None),
        )
        return vec
    except Exception:
        ms = int((time.time() - t0) * 1000)
        logger.info(
            "[exec] +%.2fs mode=embed phase=encode_fail ms=%s query_chars=%s",
            time.time() - t0,
            ms,
            len(query),
        )
        logger.debug("encode_text_vec failed", exc_info=True)
        return None


def pack_vec(vec: Any) -> bytes:
    if vec is None:
        return b""
    try:
        from app.services.design.admin.blob_codec import pack_emb_blob

        return pack_emb_blob(vec.tobytes(order="C"))
    except Exception:
        return b""


def unpack_vec(blob: Any) -> Any | None:
    try:
        from app.services.design.admin.blob_codec import unpack_emb_blob
    except Exception:
        return None
    raw = unpack_emb_blob(blob)
    if not raw:
        return None
    try:
        import numpy as np

        return np.frombuffer(raw, dtype=np.float32)
    except Exception:
        return None


def cosine(a: Any, b: Any) -> float:
    try:
        import numpy as np

        aa = np.asarray(a, dtype=np.float32).ravel()
        bb = np.asarray(b, dtype=np.float32).ravel()
        if aa.size == 0 or bb.size == 0 or aa.size != bb.size:
            return 0.0
        na = float(np.dot(aa, aa))
        nb = float(np.dot(bb, bb))
        if na <= 0 or nb <= 0:
            return 0.0
        return float(max(0.0, min(1.0, np.dot(aa, bb) / ((na**0.5) * (nb**0.5)))))
    except Exception:
        return 0.0


def schedule_background(name: str, fn: Callable[[], None]) -> None:
    """Fire-and-forget worker (CLIP load can be slow)."""

    def _run() -> None:
        try:
            fn()
        except Exception:
            logger.exception("background job %s failed", name)

    t = threading.Thread(target=_run, name=name, daemon=True)
    t.start()


def retrieve_mode(rules: dict[str, str] | None, key: str, default: str = "embedding") -> str:
    raw = default
    if isinstance(rules, dict) and rules.get(key) is not None:
        raw = str(rules.get(key) or default)
    mode = (raw or default).strip().lower()
    if mode in ("embedding", "vector", "clip"):
        return "embedding"
    return "recency"


def _vec_to_list(vec: Any) -> list[float]:
    if vec is None:
        return []
    try:
        return [float(x) for x in vec.tolist()]
    except Exception:
        try:
            return [float(x) for x in list(vec)]
        except Exception:
            return []


class ClipTextEmbeddings(Embeddings):
    """LangChain ``Embeddings`` over local OpenCLIP text tower."""

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [_vec_to_list(encode_text_vec(t)) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return _vec_to_list(encode_text_vec(text))

    def embed_query_raw(self, text: str) -> Any | None:
        """Numpy vector for cosine against MySQL-stored blobs."""
        return encode_text_vec(text)


def get_text_embeddings() -> ClipTextEmbeddings:
    """Shared Embeddings instance (LangChain interface)."""
    return ClipTextEmbeddings()


def split_text_chunks(
    text: str,
    *,
    chunk_size: int = 500,
    chunk_overlap: int = 50,
) -> list[str]:
    """Official ``RecursiveCharacterTextSplitter`` for knowledge / memory ingest."""
    raw = (text or "").strip()
    if not raw:
        return []
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=max(100, chunk_size),
        chunk_overlap=max(0, min(chunk_overlap, chunk_size // 2)),
    )
    return [c for c in splitter.split_text(raw) if c.strip()]


def hits_to_documents(
    hits: list[dict[str, Any]],
    *,
    text_key: str = "text",
) -> list[Document]:
    """Convert retrieve rows → LangChain ``Document`` list."""
    docs: list[Document] = []
    for h in hits:
        if not isinstance(h, dict):
            continue
        text = str(h.get(text_key) or "").strip()
        if not text:
            continue
        meta = {k: v for k, v in h.items() if k != text_key and k != "emb"}
        docs.append(Document(page_content=text, metadata=meta))
    return docs


_RAG_DOC_PROMPT = PromptTemplate.from_template(
    "{page_content}"
)


def format_rag_block(
    hits: list[dict[str, Any]] | list[Document],
    *,
    title: str = "KNOWLEDGE",
    text_key: str = "text",
    max_chars: int = 2000,
) -> str:
    """Format hits/Documents for prompt injection via ``format_document``."""
    if not hits:
        return ""
    docs: list[Document] = []
    for h in hits:
        if isinstance(h, Document):
            docs.append(h)
        elif isinstance(h, dict):
            docs.extend(hits_to_documents([h], text_key=text_key))
    if not docs:
        return ""
    lines = [f"[{title}]"]
    used = 0
    for i, doc in enumerate(docs, 1):
        body = format_document(doc, _RAG_DOC_PROMPT).strip()
        if not body:
            continue
        score = (doc.metadata or {}).get("score")
        head = (
            f"{i}. (score={score:.3f}) "
            if isinstance(score, (int, float))
            else f"{i}. "
        )
        chunk = head + body
        if used + len(chunk) > max_chars:
            remain = max_chars - used
            if remain > 40:
                lines.append(chunk[:remain] + "…")
            break
        lines.append(chunk)
        used += len(chunk)
    return "\n".join(lines) if len(lines) > 1 else ""
