# Billing（任务制积分）

本仓库提供两样东西：**Billing Protocol**（怎么记账）和 **任务制积分地板**（默认预扣多少）。  
它们不是完整的 Cloud 套餐产品；加价、促销、list SKU 由宿主自己决定。

**部署与开关：** 运行时开关为 **`WALLET_BILLING_ENABLED`**（默认 `true`）。详见 [deployment-modes.md](./deployment-modes.md)。

协议包 pin：`recombyn-protocol >= 0.1.3`。

## 安装协议包

```bash
pip install -e ./packages/protocol
# 或
pip install "recombyn-protocol>=0.1.3"
```

辅助构建：`packages/billing-sdk`（`build_billing_event`、`estimate_provider_cost` 等）。

## Billing Protocol 是什么

公开合同：用量、成本、账本、生命周期的数据结构。  
自托管钱包、生态适配器、Cloud 用同一套形状对账；**不规定卖多少钱**。

```python
from recombyn_protocol.billing import (
    BILLING_LIFECYCLE_STAGES,
    CostBreakdownSchema,
    TaskCostSchema,
    UsageEventSchema,
)

# estimate → authorize → execute → capture | release | refund
print(BILLING_LIFECYCLE_STAGES)
```

布局在 `packages/protocol/recombyn_protocol/billing/`：

| 模块 | 管什么 |
|------|--------|
| `pricing` / `usage` / `cost` | 厂商价、用量事件、成本分解（micros） |
| `events` | BillingEvent、Credit 账本 |
| `lifecycle` | 估价 → 预扣 → 结算 |
| `task_pricing` / `credit_policy` / `meter` | 任务价表、积分策略、可计量键 |
| `quota` / `entitlement` / `budget` | 额度、权益形状、预算护栏 |

Design Brief 在 `recombyn_protocol.brief`，**不要**放进 `billing/`。

## 任务制积分地板是什么

默认任务价目表：按「一次设计任务」估分，不是 `tokens ÷ N`。  
没开私有报价时，Runtime 用它做 **authorize 上限**；Cloud quote 也可对齐同一套地板。

```python
from recombyn_protocol.billing import default_oss_task_pricing_catalog

catalog = default_oss_task_pricing_catalog()
agent = catalog["agent"]
print(agent.base_credit)           # 20
print(agent.estimate_credits_high())  # 30 = base + research/paint/review
```

| Pipeline | `base_credit` | 高估（预扣顶） |
|----------|---------------|----------------|
| `agent` | 20 | 30（+ research 3 / paint 5 / review 2） |
| `single_model` | 20 | 20 |
| `partial` | 10 | 10 |
| `image` | 2 | 2 |
| `chat` | 1 | 1 |

宿主可用规则覆盖（如 `billing.task_pricing_json`）；上表是默认地板，不是 list 售价。

## 三层价格（不要塌缩）

```text
Provider Price          # PricingVersion / rates
      ↓
Internal Cost           # CostBreakdown.internal_cost_micros
      ↓
Host commercial policy  # margin / promo / SKU (operator deployment)
      ↓
User Credits / Ledger   # 用户看到的积分
```

公开 `Model` 上不要挂 `user_price` / `credits_per_token`。  
Token meter 仍可记用量；用户 SKU 是任务积分。

## 生命周期

```text
estimate → authorize → execute → settle
                                 ├── capture
                                 ├── release
                                 └── refund
```

1. **estimate** — 按 TaskPricing / meter 估分  
2. **authorize** — 预扣（不够则拒）  
3. **execute** — 跑任务  
4. **settle** — **capture** 实扣（优先宿主 quote 的 `credits_to_charge`，否则走地板 / BYOK 策略）；多余预扣 **release**；事后 **refund**  

账本真值用整数 **micros**；Credits 用 `int`。结算行要带 `pricing_version_id`，历史不改写。

## WALLET_BILLING_ENABLED（运行时开关）

| 项 | 说明 |
|----|------|
| **环境变量** | `WALLET_BILLING_ENABLED`（`apps/api/.env` 或 Compose / k8s） |
| **默认值** | `true` — 一般无需额外配置 |
| **关闭** | 仅当明确不需要平台积分时设 `false` |
| **公开 API** | `GET /api/v1/auth/config` → `billingEnabled` |
| **前端规则** | `useBillingEnabled()` 只读 `auth/config`；`/wallet` 报错 **不会** 隐藏积分 UI |

```bash
# apps/api/.env — 默认即可，一般不用写
# WALLET_BILLING_ENABLED=true

# 明确关闭平台积分（UI 藏余额 / Plans / Usage）
# WALLET_BILLING_ENABLED=false
```

| 值 | API 行为 | UI |
|----|----------|-----|
| `true`（默认） | 预扣 / 结算、日免费额度、卡密兑换 | 显示余额、套餐、用量 |
| `false` | 跳过 hold/charge | 隐藏积分相关入口 |

## 自托管怎么开

默认已开启：

```bash
# apps/api/.env
# WALLET_BILLING_ENABLED=true   # 默认：预扣积分、显示余额 / Plans / Usage
# WALLET_BILLING_ENABLED=false  # 仅当明确不需要平台积分时关闭
```

| 值 | 行为 |
|----|------|
| `true`（默认） | SaaS 风格钱包（plans、卡密、日免费额度等） |
| `false` | 无 hold/charge；UI 隐藏积分相关入口 |

开关在你自己的实例上。

打开后可选：

- 调整日免费额度（`FREE_DAILY_LIMIT`）
- 发卡密（admin + `CARD_KEY_SALT` / `CARD_KEY_OPS_PASSWORD`）

细节见 [self-hosting.md](./self-hosting.md#credits--membership-self-host) · [deployment-modes.md](./deployment-modes.md)。

## 二者分别有啥用

| | Billing Protocol | 任务制积分地板 |
|--|------------------|----------------|
| 本质 | 记账合同 | 默认价目表 |
| 回答 | 记什么、何时扣/退 | 这类任务大概预扣几分 |
| 没有它 | 各写各的，对不上账 | 有协议也不知道默认预扣多少 |

## 决策记录

- [ADR 0025 — Billing Protocol](./adr/0025-billing-protocol.md)
- [ADR 0026 — Task-centric billing](./adr/0026-task-centric-billing.md)
- 协议说明：[packages/protocol/README.md](../packages/protocol/README.md)
