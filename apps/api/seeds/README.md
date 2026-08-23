# API seeds

First boot loads prompt packs, Skills, AgentProfile YAML, canvas tools, and catalogs from this tree. Prompt-pack body/meta follow git (Admin UI edits are overwritten on the next ensure).

Owner docs: [self-hosting.md](../../../docs/self-hosting.md) · AgentProfile: [agent-profile.md](../../../docs/agent-profile.md)

## Layout


| Path                                                                     | Contents                                          |
| ------------------------------------------------------------------------ | ------------------------------------------------- |
| `agents/bindings.yaml`                                                   | product/surface → Profile id                      |
| `agents/profiles/*.yaml`                                                 | AgentProfile YAML (`design.canvas`)               |
| `design_prompt_packs/`                                                   | `_index.json` + `stages/*.md` + `snippets.md` (pack sections) |
| `design_skills/<key>/`                                                   | Shipped skill packs. V3 core: `design_brief` `visual_direction` `design_system` `composition` `typography` `color` `imagery` `layout` `anti_ai_slop` `design_review` `polish` `responsive`. Surfaces: `poster_craft` `landing_page` `dashboard_ui` `image_gen` |
| Private extensions                                                       | `<repo>/plugins/skills/<key>/` — [docs/skill-extensions.md](../../docs/skill-extensions.md) |
| `canvas_actions_seed.json`                                               | Canvas tool registry                              |
| `design_agent_stress_suite.json`                                         | Agent SSE / browser stress cases (not loaded at runtime) |
| `fonts_seed.json` · `design_tokens_seed.json` · `design_dicts_seed.json` | Fonts / tokens / dicts                            |
| `plaza_agent_docs/`                                                      | Optional official plaza boards (`npm run plaza:agent-showcase`); empty by default |
| `llm_models_seed.json`                                                   | Model catalog seed                                |
| `stage_rule_defaults.json` · `progress_stages.json`                      | Platform KV defaults / progress labels            |

### Design Agent stress suite

`design_agent_stress_suite.json` is an **eval seed**, not a prompt pack:

| Pool | Purpose | Failures usually mean |
|------|---------|------------------------|
| `cases` | Category craft (poster / banner / …) + `skill_expect` | Skills |
| `system_cases` | Vague / contradict / stop / tiny edit | Prompt packs / kernel routing |

Runner (API must be up; token via `STRESS_TOKEN` or repo-root `.tmp-token.txt`):

```bash
npm run stress:agent                 # all category cases
npm run stress:agent -- poster       # subset
npm run stress:agent -- --system     # system_cases pool
```

Writes `.tmp-design-agent-stress-result.json` (gitignored).


Helpers in code: `resolve_seed_dir` / `resolve_seed_file` / `api_seeds_dir`（原 `data/` 已迁到 `seeds/`）。