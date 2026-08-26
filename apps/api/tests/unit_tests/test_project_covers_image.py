from unittest.mock import patch

from app.services.projects import _cov_tile_for_node


def _image_node(src: str = "uploads/u1/photo.png") -> dict:
    return {
        "id": "img1",
        "key": "image",
        "width": 800,
        "height": 600,
        "attrs": {"src": src, "uploadKey": "uploads/u1/photo.png"},
    }


def test_cov_tile_for_node_image_hosts_on_storage():
    with patch("app.services.projects._cov_raster_image", return_value=b"fake-webp"):
        with patch("app.services.projects._cov_put_tile_bytes", return_value="projects/u1/p1/thumb-abc.webp"):
            key = _cov_tile_for_node("u1", "p1", _image_node(), index=0)
    assert key == "projects/u1/p1/thumb-abc.webp"


def test_cov_tile_for_node_image_falls_back_to_none_when_raster_fails():
    with patch("app.services.projects._cov_raster_image", return_value=None):
        key = _cov_tile_for_node("u1", "p1", _image_node(), index=0)
    assert key is None
