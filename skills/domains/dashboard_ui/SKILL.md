# Dashboard / admin UI (Skill V3)

Deliverable: **后台 / dashboard / console / 数据看板**.
Kernel still Decide → Paint → Observe → Review. This skill owns **task-first IA**.
Inherit craft from `extends` — do not invent a second aesthetic curriculum.

## Process (mandatory order)

```text
INPUT
 → PRIMARY TASK   (what the operator does in ~2s)
 → BRIEF          (P0 design_brief fields)
 → ART DIRECTION  (calm console DNA — not a poster)
 → INFO PLAN      (primary → secondary → context → action)
 → DESIGN SYSTEM  (tokens / type ladder / density)
 → EXECUTION      (paint ops — main surface first)
 → OBSERVE        (host geometry facts only)
 → REVIEW         (scores; Runtime totals)
 → CORRECTION     (fix toward brief + subtraction)
 → FINAL
```

## 0. Primary task first

Write **one** operator job into `design_brief.purpose` before any chrome:

| Job | Main surface |
|-----|----------------|
| Monitor | One status / health canvas, then exceptions |
| Analyze | One primary chart or table, then breakdown |
| Work queue | Filters + table (or list); row action is the CTA |
| Master-detail | List + inspector; inspector is primary once a row is selected |
| Configure | Form / settings; save is the action |

If the prompt is vague (“做一个 dashboard”), still pick a task (default: **work queue** or **monitor** from the nouns they used). Do not fill the vacuum with KPI wallpaper.

## 1. Information order (do not skip)

```text
Primary Information
 ↓
Secondary Information
 ↓
Context
 ↓
Action
```

- **Primary** occupies the largest region and answers the task (table, chart, canvas, inspector).
- **Secondary** supports comparison or filters — smaller, not a second hero.
- **Context** is nav, title, breadcrumbs, quiet meta.
- **Action** is one primary control per region (Apply / Save / Acknowledge).

Sidebar + top bar are **context**, not the design.

## 2. Forbidden default

Never start from:

```text
KPI Card
KPI Card
KPI Card
KPI Card
```

Four equal KPI cards are not a dashboard. They are an `anti_slop` hit unless the brief names four metrics the user actually supplied **and** they serve the primary task.

A KPI is allowed only as **secondary** (or a single hero metric) when it changes what the operator does next.

## 3. Composition / density

- Desktop board ~1440×900. Phone consoles → prefer `mobile_app_ui`; tablet via `responsive`.
- One token system: muted labels, bold values, quiet chrome.
- Alignment and scan paths matter more than decoration.
- States: loading skeleton / empty + one action / error + next step.

## 4. Execution stack

1. `create_frame` (desktop console size)
2. Context chrome (sidebar / top bar) — quiet
3. Primary information region (largest)
4. Secondary + action
5. **Second pass = subtract equal cards / align — not add another KPI row**

Charts: simple bar/line as vector structure. Complex media widgets → `image_gen`. Dense controls → `shadcn_ui`. Many marks → `icon_set`.

## 5. Honesty

Unless the user provides them, do not invent KPI numbers, chart series, logos, or revenue samples. Prefer `—` or empty structure.

## Hard rules

1. Primary task before chrome. Brief P0 before paint.
2. One main surface. Equal four-KPI walls are a fail.
3. Anti-slop: no glassmorphism KPI cards, no festive poster hero.
4. Subtraction pass when Review score 70–89.

## Done when

- An operator can name the task and the next click in ~2s
- Primary region dominates; KPIs (if any) are subordinate
- Review total ≥ 90 (Runtime) with no blocker / slop hits

## Related

`shadcn_ui` · `icon_set` · `mobile_app_ui` (phone) · `image_gen` (media widgets only) · foundations via `extends`
