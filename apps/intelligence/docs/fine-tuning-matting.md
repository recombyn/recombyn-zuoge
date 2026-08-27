# 高精度通用抠图 — 微调与验收

**产品定位：一种智能抠图**，系统自动识别主体；人像发丝、玻璃薄纱等只是**难例验收标签**，不是用户可选的「场景模式」。

生产默认链路：

```text
用户图片 [+ 可选保留/排除涂抹]
    → BiRefNet HR-matting ONNX（有则 ben_custom，无则 birefnet-general）
    → SAM ROI + 亚像素 refine + decontaminate
    → RGBA PNG
```

下文「人像轨 / 透明轨」仅用于 **benchmark 对比** 和 **定向微调**，不在产品 UI 暴露。

## 架构总览

```text
run_matting(scene=auto)  →  general 高精度路径
        ↓
matting_router.resolve_matting_route()
        ↓
rembg (HR-matting ben_custom | birefnet-general)
        ↓
refine_alpha_subpixel + decontaminate
        ↓
RGBA PNG
```

| 用途 | 默认权重 | 微调后 | decontaminate |
|------|----------|--------|---------------|
| **生产 general** | HR-matting ONNX 或 `birefnet-general` | `ILP_MATTING_ONNX` | 0.65 |
| benchmark portrait | `birefnet-portrait` | `ILP_MATTING_PORTRAIT_ONNX` | 0.72 |
| benchmark transparent | `birefnet-general` | 自采玻璃数据微调 | 0.55 |

### API 用法

```bash
# 人像发丝
curl -X POST http://127.0.0.1:8091/api/v1/pipeline/segment \
  -H "Authorization: Bearer $KEY" \
  -F "file=@portrait.jpg" \
  -F "scene=portrait" \
  -F "decontaminate=0.72"

# 玻璃 / 透明商品
curl -X POST ... -F "scene=transparent" -F "decontaminate=0.55"
```

BFF `removeBg` 在 `meta` 里传：

```json
{ "mattingScene": "portrait", "decontaminate": 0.72 }
```

---

## 轨道 A：人像发丝（Portrait / Hair）

### 1. 零训练先试

```bash
# rembg 已内置 portrait 权重，scene=portrait 会自动选用
ILP_MATTING_MODEL_PORTRAIT=birefnet-portrait
```

### 2. 推荐训练数据

| 数据集 | 规模 | 链接 | 用途 |
|--------|------|------|------|
| **P3M-10k** | 10k | https://github.com/JizhiziLi/P3M | 人像 matting 主训练 |
| **AIM-500** | 500 评测 | https://github.com/JizhiziLi/AIM | 验收黄金集 |
| **HRSOD / UHRSD** | — | BiRefNet README 打包 | 高分辨率显著目标 |
| **自采困难样本** | 200–500 | 内部 | 发梢、逆光、碎发 |

**数据配比建议（微调）**

- 60% P3M-10k（或子集 3k–5k）
- 20% 自采「抠坏」样张 + 人工 alpha
- 10% DIS5K（细结构）
- 10% AIM-500 训练划分（若有）

### 3. 微调步骤（BiRefNet 官方）

1. 克隆 https://github.com/ZhengPeng7/BiRefNet  
2. 数据目录：`datasets/Portrait/P3M-TR/im` + `gt`（同名 png alpha）  
3. README → **Fine-tuning on Custom Data**  
4. 视频教程：https://youtu.be/FwGT_0V9E-k  
5. `resume` 从 `BiRefNet-general-epoch_244.pth` 或 `BiRefNet-portrait-epoch_150.pth`  
6. **Matting 任务**调 `lambdas_pix_last`（回归 loss 权重）  
7. 再训 30–50 epoch（注意 epoch 从 checkpoint 数字续算）

### 4. 导出并接入 Intelligence

```bash
# 导出 ONNX（BiRefNet repo 提供 export 脚本，或按 rembg ben_custom 规范）
# 1024×1024, mean=0.5, std=1.0

export U2NET_HOME=/data/models
cp portrait-finetuned.onnx $U2NET_HOME/portrait-finetuned.onnx

export ILP_MATTING_PORTRAIT_ONNX=$U2NET_HOME/portrait-finetuned.onnx
export ILP_MATTING_MODEL_PORTRAIT=ben_custom
```

请求 `scene=portrait` 即走自定义权重。

---

## 轨道 B：透明材质（Glass / Transparent）

### 1. 难点说明

透明物体不是简单前景/背景二分类。通用 BiRefNet-general **必须微调或换专模**。

### 2. 推荐训练数据

| 数据集 | 链接 | 说明 |
|--------|------|------|
| **Transparent-460** | https://github.com/AceCHQ/TransMatting | 透明物体专用 |
| **TransMatting 代码** | 同上 | 可作第二模型路线 |
| **Composition-1k** | matting 社区 | 合成 alpha 训练 |
| **Distinctions-646** | VitMatte 生态 | 精细边缘 |
| **自采商品玻璃图** | 内部 | 瓶罐、亚克力、橱窗 |

**数据配比建议**

- 40% Transparent-460 + 合成透明数据
- 30% 自采电商玻璃/亚克力（标 alpha）
- 20% P3M / matting 混合（防人像退化）
- 10% 困难负样本（反光、空瓶）

### 3. 微调策略

**方案 1（推荐）：BiRefNet HR-matting 权重上继续训**

- 起点：`BiRefNet_HR-matting-epoch_135.onnx`（rembg releases）
- 在 Transparent-460 + 自采数据上微调 50+ epoch
- `lambdas_pix_last` 偏向 matting 回归
- 作者 Issue #164：与 general 差异大时 **从头训或大量域内数据**

**方案 2：TransMatting 专模**

- 训练 TransMatting：https://github.com/AceCHQ/TransMatting  
- 导出 ONNX → `ben_custom` → `ILP_MATTING_TRANSPARENT_ONNX`

### 4. 接入

```bash
export U2NET_HOME=/data/models
cp glass-matting.onnx $U2NET_HOME/glass-matting.onnx
export ILP_MATTING_TRANSPARENT_ONNX=$U2NET_HOME/glass-matting.onnx
export ILP_MATTING_MODEL_TRANSPARENT=ben_custom
export ILP_MATTING_DECONTAMINATE_TRANSPARENT=0.55
```

API：`scene=transparent`

---

## 环境变量一览

| 变量 | 说明 |
|------|------|
| `U2NET_HOME` | rembg 模型目录（自定义 ONNX 须放此目录下） |
| `ILP_MATTING_MODEL_PORTRAIT` | 默认 `birefnet-portrait` |
| `ILP_MATTING_MODEL_TRANSPARENT` | 微调前 `birefnet-general`，微调后 `ben_custom` |
| `ILP_MATTING_PORTRAIT_ONNX` | 人像微调 ONNX 路径 |
| `ILP_MATTING_TRANSPARENT_ONNX` | 透明微调 ONNX 路径 |
| `ILP_MATTING_DECONTAMINATE_PORTRAIT` | 默认 `0.72` |
| `ILP_MATTING_DECONTAMINATE_TRANSPARENT` | 默认 `0.55` |

---

## 验收标准（商用）

建 **黄金集** 各 30–50 张：

| 类别 | 检查项 |
|------|--------|
| 人像发丝 | 发梢连续、无大块缺失、无绿/白边 |
| 透明玻璃 | 瓶身透明感保留、高光不穿孔、背景不渗入 |
| 通用商品 | 边缘干净、亚像素过渡自然 |

指标：SAD / MSE（matting 标准）+ 设计侧肉眼评审。

---

## 开源参考

| 项目 | 用途 |
|------|------|
| [BiRefNet](https://github.com/ZhengPeng7/BiRefNet) | 微调主仓库 + 官方教程 |
| [rembg](https://github.com/danielgatis/rembg) | 推理、`ben_custom` 加载 ONNX |
| [P3M](https://github.com/JizhiziLi/P3M) | 人像数据 |
| [AIM](https://github.com/JizhiziLi/AIM) | 自然图 matting |
| [TransMatting](https://github.com/AceCHQ/TransMatting) | 透明物体 |

---

## 与现有后处理的关系

微调解决 **alpha 预测**；以下仍由 Intelligence 完成，无需重训：

- `run_matting()` — **统一入口**（removeBg / 分层 / Mark 共用）
- `refine_alpha_subpixel` — 导向滤波、sigmoid 边缘、去色边  
- `propose_sam_regions` — ROI 粗定位  
- `trim_rgba_bbox` — 亚像素裁切  

**推荐流程**：换 scene 权重 → 保留 subpixel 后处理 → 用黄金集 A/B。

## 本仓库脚本

```bash
# 1. 把你的困难样张放进 private-eval/matting/golden/（已含 4 张测试图）
# 2. 对比 general / portrait / transparent 效果
python scripts/benchmark_matting.py --scenes recommended,general,portrait,transparent

# 3. 生成 BiRefNet 训练目录（可先 --pseudo 自举，再手修 gt/）
python scripts/prepare_birefnet_dataset.py \
  --images private-eval/matting/golden \
  --manifest private-eval/matting/golden_manifest.yaml \
  --out datasets/dis/Portrait/TR-PORTRAIT \
  --scene portrait --pseudo

# 4. GPU 机器上克隆 BiRefNet 并训练（见 scripts/finetune_birefnet.sh）
bash scripts/finetune_birefnet.sh portrait 50
bash scripts/finetune_birefnet.sh transparent 50
```

导出 ONNX 后：

```bash
export U2NET_HOME=/data/models
export ILP_MATTING_PORTRAIT_ONNX=$U2NET_HOME/portrait-finetuned.onnx
export ILP_MATTING_MODEL_PORTRAIT=ben_custom
```

API / BFF 传 `scene=portrait` 或 `meta.mattingScene=transparent` 即可，**无需改业务代码**。
