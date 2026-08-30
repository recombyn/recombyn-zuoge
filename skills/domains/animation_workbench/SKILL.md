# Animation Workbench

Craft for **Agent animation intent** — deliver UI motion on the **动画工作台**, not a poster artboard.

## Design thinking

| Ask | Aim |
|-----|-----|
| **Job** | Loading / success / empty idle / like / tip pulse |
| **Loop** | Loading·idle → loop; success·like → often one-shot |
| **Focus** | 1–2 movers; calm ease |
| **Place** | Prefer the **focused** animation workbench (timeline open / FOCUS). Else spawn a workbench via `create_lottie`. |

## Rules

1. Primary tool: **`create_lottie`** with a tight `genPrompt` (what moves, loop vs one-shot, tempo, colors, purpose).
2. Never fake motion with `create_image` or a static `create_frame` poster.
3. Soft-avoid strobe, rainbow flicker, and animating every chrome piece.
4. If FOCUS / timeline already points at a workbench, import into that plate — do not open a second empty board.

## Prompt cues for genPrompt

Say: **what moves**, **loop vs one-shot**, **tempo**, **style**, **colors**, **purpose**.

## Done when

Purpose reads in ~1s; loop/one-shot matches the job; piece lives on an 动画工作台.
