"""Object storage backends — local disk or S3-style (OSS/COS)."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

from app.core.config import settings


class ObjectStorage(Protocol):
    def put_file(self, key: str, path: Path, content_type: str | None = None) -> str: ...

    def put_bytes(
        self,
        key: str,
        data: bytes,
        content_type: str | None = None,
        cache_control: str | None = None,
    ) -> str: ...

    def get_bytes(self, key: str) -> bytes | None: ...

    def delete_object(self, key: str) -> None: ...

    def url_for(self, key: str) -> str: ...

    def enabled_remote(self) -> bool: ...


class LocalStorage:
    """Keep files on disk under result_dir / upload_dir; keys are relative paths."""

    def put_file(self, key: str, path: Path, content_type: str | None = None) -> str:
        # Already on disk in phase-1/2 layout — record key only.
        return key.replace("\\", "/")

    def put_bytes(
        self,
        key: str,
        data: bytes,
        content_type: str | None = None,
        cache_control: str | None = None,
    ) -> str:
        del content_type, cache_control
        root = Path(settings.result_dir).resolve() / "objects"
        dest = root / key.replace("\\", "/")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        return key.replace("\\", "/")

    def get_bytes(self, key: str) -> bytes | None:
        root = Path(settings.result_dir).resolve() / "objects"
        path = root / key.replace("\\", "/")
        if not path.is_file():
            return None
        return path.read_bytes()

    def delete_object(self, key: str) -> None:
        root = Path(settings.result_dir).resolve() / "objects"
        path = root / key.replace("\\", "/")
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass

    def url_for(self, key: str) -> str:
        return key.replace("\\", "/")

    def enabled_remote(self) -> bool:
        return False


class S3Storage:
    """boto3 S3 API — works with AWS S3, MinIO, Aliyun OSS, Tencent COS gateway."""

    def __init__(self) -> None:
        import boto3
        from botocore.client import Config

        kwargs: dict = {
            "service_name": "s3",
            "aws_access_key_id": settings.s3_access_key,
            "aws_secret_access_key": settings.s3_secret_key,
            "region_name": settings.s3_region,
        }
        if settings.s3_endpoint_url:
            kwargs["endpoint_url"] = settings.s3_endpoint_url
            kwargs["config"] = Config(s3={"addressing_style": settings.s3_addressing_style})

        self._client = boto3.client(**kwargs)
        self._bucket = settings.s3_bucket

    def put_bytes(
        self,
        key: str,
        data: bytes,
        content_type: str | None = None,
        cache_control: str | None = None,
    ) -> str:
        extra: dict = {}
        if content_type:
            extra["ContentType"] = content_type
        if cache_control:
            extra["CacheControl"] = cache_control
        # Public-read so returned COS URLs work in <img> without signed cookies.
        if getattr(settings, "s3_acl_public_read", True):
            extra["ACL"] = "public-read"
        self._client.put_object(Bucket=self._bucket, Key=key, Body=data, **extra)
        return key

    def put_file(self, key: str, path: Path, content_type: str | None = None) -> str:
        extra: dict = {}
        if content_type:
            extra["ContentType"] = content_type
        if getattr(settings, "s3_acl_public_read", True):
            extra["ACL"] = "public-read"
        if extra:
            self._client.upload_file(str(path), self._bucket, key, ExtraArgs=extra)
        else:
            self._client.upload_file(str(path), self._bucket, key)
        return key

    def get_bytes(self, key: str) -> bytes | None:
        try:
            obj = self._client.get_object(Bucket=self._bucket, Key=key)
            return obj["Body"].read()
        except Exception:
            return None

    def delete_object(self, key: str) -> None:
        try:
            self._client.delete_object(Bucket=self._bucket, Key=key)
        except Exception:
            pass

    def url_for(self, key: str) -> str:
        if settings.s3_public_base_url:
            return f"{settings.s3_public_base_url.rstrip('/')}/{key}"
        if settings.s3_endpoint_url:
            return f"{settings.s3_endpoint_url.rstrip('/')}/{self._bucket}/{key}"
        return f"s3://{self._bucket}/{key}"

    def enabled_remote(self) -> bool:
        return True


_storage: ObjectStorage | None = None


def get_storage() -> ObjectStorage:
    global _storage
    if _storage is not None:
        return _storage
    if settings.s3_enabled:
        try:
            _storage = S3Storage()
        except Exception:
            _storage = LocalStorage()
    else:
        _storage = LocalStorage()
    return _storage


def put_bytes(
    key: str,
    data: bytes,
    content_type: str | None = None,
    cache_control: str | None = None,
) -> str:
    return get_storage().put_bytes(
        key, data, content_type=content_type, cache_control=cache_control
    )


def get_bytes(key: str) -> bytes | None:
    return get_storage().get_bytes(key)


def delete_object(key: str) -> None:
    get_storage().delete_object(key)


def upload_page_images(job_id: str | None, page_paths: list[Path]) -> tuple[list[str], list[str], list[str]]:
    """
    Persist page images via storage backend.
    Returns (local_rel_paths, object_keys, urls).
    """
    storage = get_storage()
    root = Path(settings.result_dir).resolve()
    local_rels: list[str] = []
    keys: list[str] = []
    urls: list[str] = []
    prefix = f"results/{job_id or '_sync'}/pages"

    for path in page_paths:
        try:
            rel = str(path.resolve().relative_to(root)).replace("\\", "/")
        except ValueError:
            rel = str(path).replace("\\", "/")
        local_rels.append(rel)

        key = f"{prefix}/{path.name}"
        ctype = "image/png" if path.suffix.lower() == ".png" else None
        try:
            stored = storage.put_file(key, path, content_type=ctype)
            keys.append(stored)
            urls.append(storage.url_for(stored))
        except Exception:
            keys.append(rel)
            urls.append(rel)

    return local_rels, keys, urls
