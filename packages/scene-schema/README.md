# Scene JSON Schema

前后端共用的画布场景图协议。完整说明：[docs/scene-json-spec.md](../../docs/scene-json-spec.md)。

- JSON Schema: [schema/scene-document.schema.json](./schema/scene-document.schema.json)
- 示例: [examples/](./examples/)

节点类型：`text` | `rect` | `image`

每个节点包含 `x`, `y`, `width`, `height` 及类型相关的 `attrs`。
