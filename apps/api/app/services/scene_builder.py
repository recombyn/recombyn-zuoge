"""Convert parsed blocks to Canvas Scene JSON."""

from scene_builder.blocks_to_scene import blocks_to_scene


def build_scene_response(blocks: list[dict], width: int = 794, height: int = 1123) -> dict:
    return blocks_to_scene(blocks, width=width, height=height)
