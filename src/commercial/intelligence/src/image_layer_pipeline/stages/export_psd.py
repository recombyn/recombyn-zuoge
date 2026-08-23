"""非破坏性 PSD：原始 RGB 像素 + 未合并图层蒙版（Layer Mask）。"""

from __future__ import annotations

from collections import OrderedDict
from pathlib import Path

import numpy as np
from PIL import Image


def save_png_layers(
    out_dir: Path,
    stem: str,
    *,
    foreground_rgba: np.ndarray,
    midground_rgba: np.ndarray,
    far_background_rgb: np.ndarray,
    behind_subject_rgb: np.ndarray,
    binary_mask: np.ndarray,
    mid_mask: np.ndarray,
    far_mask: np.ndarray,
    depth_u8: np.ndarray,
    subject_repair_mask: np.ndarray | None = None,
) -> dict[str, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}

    def _save(name: str, arr: np.ndarray, mode: str) -> Path:
        p = out_dir / f"{stem}_{name}.png"
        Image.fromarray(arr, mode=mode).save(p)
        paths[name] = p
        return p

    _save("foreground", foreground_rgba, "RGBA")
    _save("midground", midground_rgba, "RGBA")
    _save("far_background", far_background_rgb, "RGB")
    _save("behind_subject", behind_subject_rgb, "RGB")
    _save("subject_mask", binary_mask, "L")
    _save("mid_mask", mid_mask, "L")
    _save("far_mask", far_mask, "L")
    _save("depth", depth_u8, "L")
    if subject_repair_mask is not None:
        _save("subject_repair_mask", subject_repair_mask, "L")
    return paths


def export_psd(
    path: Path,
    *,
    original_rgb: np.ndarray,
    far_background_rgb: np.ndarray,
    behind_subject_rgb: np.ndarray,
    foreground_rgba: np.ndarray,
    mid_mask: np.ndarray,
    subject_mask: np.ndarray | None = None,
    nondestructive: bool = True,
) -> Path:
    """
    写出三图层 PSD。

    nondestructive=True（工业默认）:
      - 图层保留完整 RGB 像素（不 flatten / 不挖空）
      - 可见性由独立 Layer Mask 控制，设计师可用黑白画笔精修
    """
    if nondestructive:
        return _export_psd_with_layer_masks(
            path,
            original_rgb=original_rgb,
            far_background_rgb=far_background_rgb,
            behind_subject_rgb=behind_subject_rgb,
            foreground_rgba=foreground_rgba,
            mid_mask=mid_mask,
            subject_mask=subject_mask,
        )
    return _export_psd_flattened_alpha(
        path,
        far_background_rgb=far_background_rgb,
        midground_rgba=_rgba_from(behind_subject_rgb, mid_mask),
        foreground_rgba=foreground_rgba,
    )


def _rgba_from(rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
    a = mask if mask.ndim == 2 else mask[:, :, 0]
    return np.dstack([rgb, a]).astype(np.uint8)


def _export_psd_flattened_alpha(
    path: Path,
    *,
    far_background_rgb: np.ndarray,
    midground_rgba: np.ndarray,
    foreground_rgba: np.ndarray,
) -> Path:
    from pytoshop import enums
    from pytoshop.user.nested_layers import Image as PsdImage
    from pytoshop.user.nested_layers import nested_layers_to_psd

    h, w = far_background_rgb.shape[:2]
    far_rgba = np.dstack(
        [far_background_rgb, np.full((h, w), 255, dtype=np.uint8)]
    )

    def make_layer(name: str, rgba: np.ndarray) -> PsdImage:
        channels = {
            0: np.ascontiguousarray(rgba[:, :, 0]),
            1: np.ascontiguousarray(rgba[:, :, 1]),
            2: np.ascontiguousarray(rgba[:, :, 2]),
            -1: np.ascontiguousarray(rgba[:, :, 3]),
        }
        return PsdImage(
            name=name,
            top=0,
            left=0,
            bottom=h,
            right=w,
            channels=channels,
            opacity=255,
            visible=True,
            color_mode=enums.ColorMode.rgb,
        )

    layers = [
        make_layer("01_Far_Background", far_rgba),
        make_layer("02_Midground", midground_rgba),
        make_layer("03_Foreground", foreground_rgba),
    ]
    psd = nested_layers_to_psd(layers, color_mode=enums.ColorMode.rgb)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as f:
        psd.write(f)
    return path


def _export_psd_with_layer_masks(
    path: Path,
    *,
    original_rgb: np.ndarray,
    far_background_rgb: np.ndarray,
    behind_subject_rgb: np.ndarray,
    foreground_rgba: np.ndarray,
    mid_mask: np.ndarray,
    subject_mask: np.ndarray | None = None,
) -> Path:
    """原始像素 + user_layer_mask，供 PS 画笔非破坏精修。"""
    from pytoshop import enums
    from pytoshop import tagged_block
    from pytoshop.core import PsdFile
    from pytoshop.image_resources import ImageResources, LayersGroupInfo
    from pytoshop.layers import (
        ChannelImageData,
        LayerAndMaskInfo,
        LayerInfo,
        LayerMask,
        LayerRecord,
    )

    h, w = original_rgb.shape[:2]
    # raw 避免 Windows 上 pytoshop packbits 扩展未编译导致 RLE 失败
    compression = enums.Compression.raw

    if subject_mask is None:
        fg_mask = foreground_rgba[:, :, 3]
    else:
        fg_mask = subject_mask if subject_mask.ndim == 2 else subject_mask[:, :, 0]
        # 优先用软 Alpha（发丝更细）
        soft = foreground_rgba[:, :, 3]
        fg_mask = np.maximum(fg_mask, soft)

    mid_m = mid_mask if mid_mask.ndim == 2 else mid_mask[:, :, 0]
    # 前景 RGB：保留原图像素（边缘溢色可由设计师在蒙版上修，不永久抹掉）
    fg_rgb = original_rgb
    # 中景 RGB：使用「挖掉主体后」的场景，位移时背后已补全
    mid_rgb = behind_subject_rgb
    far_rgb = far_background_rgb
    white = np.full((h, w), 255, dtype=np.uint8)

    def _ch(arr: np.ndarray) -> ChannelImageData:
        return ChannelImageData(
            image=np.ascontiguousarray(arr.astype(np.uint8)),
            compression=compression,
        )

    def make_record(
        name: str,
        rgb: np.ndarray,
        layer_mask: np.ndarray | None,
        layer_id: int,
    ) -> LayerRecord:
        channels: OrderedDict[int, ChannelImageData] = OrderedDict()
        channels[0] = _ch(rgb[:, :, 0])
        channels[1] = _ch(rgb[:, :, 1])
        channels[2] = _ch(rgb[:, :, 2])
        # 透明度通道全白：可见性交给 Layer Mask，避免 flatten
        channels[enums.ChannelId.transparency] = _ch(white)

        record = LayerRecord(
            top=0,
            left=0,
            bottom=h,
            right=w,
            name=name,
            blend_mode=enums.BlendMode.normal,
            opacity=255,
            visible=True,
            channels=channels,
            blocks=[
                tagged_block.UnicodeLayerName(name=name),
                tagged_block.LayerId(id=layer_id),
            ],
            color_mode=enums.ColorMode.rgb,
        )

        if layer_mask is not None:
            m = np.ascontiguousarray(layer_mask.astype(np.uint8))
            channels[enums.ChannelId.user_layer_mask] = _ch(m)
            record.mask = LayerMask(
                top=0,
                left=0,
                bottom=h,
                right=w,
                default_color=False,
                layer_mask_disabled=False,
            )
        return record

    # Photoshop 图层列表：写入顺序稍后反转（底层先写）
    records = [
        make_record("01_Far_Background", far_rgb, None, 1),
        make_record("02_Midground", mid_rgb, mid_m, 2),
        make_record("03_Foreground", fg_rgb, fg_mask, 3),
    ]
    # pytoshop / PSD 约定：数组中越靠前越靠上，因此反转
    records = list(reversed(records))
    group_ids = [0] * len(records)

    psd = PsdFile(
        version=enums.Version.version_1,
        num_channels=3,
        height=h,
        width=w,
        depth=enums.ColorDepth.depth8,
        color_mode=enums.ColorMode.rgb,
        layer_and_mask_info=LayerAndMaskInfo(
            layer_info=LayerInfo(layer_records=records)
        ),
        image_resources=ImageResources(
            blocks=[LayersGroupInfo(group_ids=group_ids)]
        ),
        compression=compression,
    )

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as f:
        psd.write(f)
    return path
