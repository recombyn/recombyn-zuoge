from typing import Any, Literal

from pydantic import BaseModel, Field


class ImportMeta(BaseModel):
    source_type: Literal["image"]
    page_count: int = 1
    page_images: list[str] = Field(default_factory=list)
    object_keys: list[str] = Field(default_factory=list)
    object_urls: list[str] = Field(default_factory=list)
    palette: list[str] = Field(default_factory=list)
    engines: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class ImportResponse(BaseModel):
    job_id: str | None = None
    status: Literal["done", "processing", "failed", "queued"] = "done"
    document: dict[str, Any] | None = None
    meta: ImportMeta | None = None
    progress: int | None = None
    error: str | None = None


class JobCreateResponse(BaseModel):
    job_id: str
    status: Literal["queued"] = "queued"


class JobStatusResponse(BaseModel):
    job_id: str
    status: Literal["queued", "processing", "done", "failed"]
    progress: int = 0
    document: dict[str, Any] | None = None
    meta: ImportMeta | None = None
    error: str | None = None
