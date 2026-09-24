# Desktop source structure

Feature folders mirror the activity bar. Keep new code in the matching feature —
do **not** dump panels into a flat `renderer/`.

## Process boundaries (contract)

```text
Electron main  ──spawn──►  engine (HTTP)  ──►  @mitii/host → @mitii/sdk → @mitii/v8
       │                        │
       │ IPC                    │ also: @mitii/automation, @mitii/mcp
       ▼                        ▼
   renderer UI            local host adapters only
```

Rules ([`docs/REPO_LAYOUT.md`](../../docs/REPO_LAYOUT.md)):

| Layer | May import | Must not import |
|---|---|---|
| `renderer/` | `shared/`, HTTP `api.ts` | `engine/`, `main/`, other apps |
| `engine/` | `shared/`, `@mitii/host`, `@mitii/sdk`, `@mitii/mcp`, `@mitii/automation` | `apps/cli`, `apps/daemon`, `apps/vscode`, `renderer/` |
| `shared/` | nothing Mitii-runtime | apps, host, sdk (DTOs only) |
| `main/` / `preload/` | `shared/` | feature UI |

## Feature map

```text
apps/desktop/src/
├── shared/
│   ├── automations/     # flow schema, modules, templates, applyModule
│   ├── git/             # working-tree DTOs
│   └── …                # protocol, settings, bridge (cross-cutting)
├── engine/
│   ├── automations/     # host control plane, runner, steps, connections, git hook
│   ├── explorer/        # workspace fs + watch
│   ├── git/             # status, mutations, argv safety
│   ├── skills/          # frontmatter format + recipe
│   ├── server.ts        # HTTP route table (wires features)
│   └── createDesktopHost.ts
└── renderer/
    ├── shell/           # WorkspacePanel, activity bar, resize
    ├── explorer/        # (tree lives in shell today; extract here next)
    ├── git/
    ├── mcp/
    ├── skills/
    ├── recipes/
    ├── automations/
    ├── App.tsx          # chat shell + mounts WorkspacePanel
    └── api.ts           # HTTP client for all features
```

| Activity | Renderer | Engine | Shared |
|---|---|---|---|
| **File Explorer** | `shell/WorkspacePanel` (tree) → prefer `explorer/` | `engine/explorer/` | — |
| **Git** | `renderer/git/` | `engine/git/` | `shared/git/` |
| **MCP** | `renderer/mcp/` | `@mitii/mcp` via host + `/v1/mcp*` in `server.ts` | — |
| **Skills** | `renderer/skills/` | `engine/skills/` | — |
| **Recipes** | `renderer/recipes/` | host recipes via `server.ts` | — |
| **Automations** | `renderer/automations/` | `engine/automations/` | `shared/automations/` |

## Where to put new code

1. **UI for a side** → `renderer/<feature>/`
2. **HTTP / disk / runner for that side** → `engine/<feature>/`
3. **Types used by both** → `shared/<feature>/`
4. **Wire a new route** → import from `engine/<feature>/` inside `server.ts` (do not grow logic inside `server.ts`)
5. **Wire a new API helper** → `renderer/api.ts` (split later if a file exceeds ~feature size)

## Docs per feature

- Automations: [`AUTOMATIONS.md`](../AUTOMATIONS.md)
- Skills format (repo-wide): [`docs/SKILLS_FORMAT.md`](../../docs/SKILLS_FORMAT.md)
- Automation package: [`packages/automation`](../../packages/automation)
- MCP package: [`packages/mcp`](../../packages/mcp)
