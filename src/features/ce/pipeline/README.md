# Agent turn pipeline

One ordered path for every Ask / Plan / Agent turn. Prefer changing stages here instead of scattering logic across `modes/`, `plans/`, and `ChatOrchestrator`.

```text
User request
    ↓
1. classify/     TaskClassification
    ↓
2. route/        RouteResolution (intent, subtypes, risk, operation class)
    ↓
3. depth/        PlanningDepthAxis (direct | quick | deep)
    ↓
4. skills/       SkillResolution (0–1 active skill + deferred catalog)
    ↓
5. capabilities/ CapabilityResolution (exact tools, MCP policy, approvals)
    ↓
6. loop/         No-progress / completion helpers used by AgentLoop
```

## How folders map

| Folder | Responsibility | Do not put here |
|--------|----------------|-----------------|
| `pipeline/` | Turn policy: classify → route → depth → skills → tools | LLM calls, file I/O |
| `modes/{ask,plan,agent}/` | Mode UX prepare (prompts, max steps) — call pipeline | Duplicate routing rules |
| `plans/` | Plan JSON schema, executor, persistence | Intent / skill selection |
| `runtime/` | AgentLoop, TaskAnalyzer (legacy heuristics — prefer `pipeline/classify`) | New route policy |
| `skills/bundled/<name>/` | Playbooks (`SKILL.md` + optional `scripts/` + `references/`) | Hardcoded TS playbooks |
| `mcp/` | Connect / register MCP servers | Per-turn tool allowlists |

## Skill layout (reference)

```text
skills/bundled/log-audit/
├── SKILL.md
├── scripts/          # optional helpers
└── references/       # optional schemas / guides

skills/bundled/documentation/
├── SKILL.md
└── references/
    └── readme-guide.md
```

## Editing checklist

1. New intent / audit type → `pipeline/route/` (+ subtype enums in `types.ts`)
2. When to plan → `pipeline/depth/`
3. Which playbook → `pipeline/skills/` + bundled `SKILL.md`
4. Which tools / MCP → `pipeline/capabilities/`
5. Prompt wording for a route → thin `routePolicy` text from route; playbooks stay in skills
