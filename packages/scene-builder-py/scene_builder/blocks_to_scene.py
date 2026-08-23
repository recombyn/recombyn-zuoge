from scene_builder.models import create_image_node, create_rect_node, create_text_node, empty_document


def blocks_to_scene(blocks: list[dict], width: int = 794, height: int = 1123) -> dict:
    doc = empty_document(width, height)
    children: list[str] = []

    for block in blocks:
        btype = block.get("type")
        x = float(block.get("x", 0) or 0)
        y = float(block.get("y", 0) or 0)
        w = max(float(block.get("width", 80) or 80), 8)
        h = max(float(block.get("height", 14) or 14), 8)

        if btype == "text" and block.get("text"):
            node_id, node = create_text_node(
                text=str(block["text"]),
                x=x,
                y=y,
                width=w,
                height=h,
                font_size=float(block.get("font_size", 14) or 14),
            )
        elif btype == "image" and block.get("src"):
            node_id, node = create_image_node(x=x, y=y, width=w, height=h, src=str(block["src"]))
        elif btype in {"rect", "table"}:
            node_id, node = create_rect_node(
                x=x,
                y=y,
                width=w,
                height=h,
                fill=str(block.get("fill") or "#F5F5F5"),
            )
        else:
            continue

        doc["deltaSetLike"][node_id] = node
        children.append(node_id)

    doc["deltaSetLike"]["ROOT"]["children"] = children
    return doc
