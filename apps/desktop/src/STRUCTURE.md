# Desktop source structure

Feature folders mirror the activity bar. Keep new code in the matching feature —
do **not** dump panels into a flat `renderer/`.

## Process boundaries (contract)

```text
Electron main  ──spawn──►  engine (HTTP)  ──►  @mitii/host → @mitii/sdk → @mitii/v8
       │                        │
       │ IPC                    │ also: @mitii/mcp
       ▼                        ▼
   renderer UI            local host adapters only
```

Rules ([`docs/REPO_LAYOUT.md`](../../docs/REPO_LAYOUT.md),
[`packages/v8/ARCHITECTURE.md`](../../packages/v8/ARCHITECTURE.md)):

| Layer | May import | Must not import |
|---|---|---|
| `renderer/` | `shared/`, HTTP `api.ts` | `engine/`, `main/`, other apps |
| `engine/` | `shared/`, `@mitii/host`, `@mitii/sdk`, `@mitii/mcp` | `apps/cli`, `apps/daemon`, `apps/vscode`, `renderer/` |
| `shared/` | nothing Mitii-runtime | apps, host, sdk (DTOs only) |
| `main/` / `preload/` | `shared/` | feature UI |

Semantic owners keep their contracts (do not create a root `shared/contracts` dump).

## Feature map

```text
apps/desktop/src/
├── STRUCTURE.md
├── shared/
│   ├── git/             # working-tree DTOs (desktop git contract)
│   └── …                # protocol, settings, bridge (cross-cutting)
├── engine/
│   ├── explorer/        # workspace fs + watch
│   ├── git/             # status, mutations, argv safety
│   ├── skills/          # frontmatter format + recipe
│   ├── server.ts        # HTTP route table (wires features)
│   └── createDesktopHost.ts
└── renderer/
    ├── shell/           # WorkspacePanel, activity bar button, resize
    ├── explorer/        # DiffView, CodeEditor (tree lives in shell today)
    ├── git/             # Source Control pane + top branch select
    ├── mcp/             # MCP manager UI
    ├── skills/          # Skills manager UI
    ├── recipes/         # Recipes manager UI
    ├── chat/            # composer, timeline, markdown, history nav
    ├── App.tsx          # shell + mounts WorkspacePanel + chat layout
    └── api.ts           # HTTP client for all features
```

| Activity | Renderer | Engine | Shared / package |
|---|---|---|---|
| **Explorer** | `shell/WorkspacePanel` (tree) + `explorer/` | `engine/explorer/` | — |
| **Git** | `renderer/git/` | `engine/git/` | `shared/git/` |
| **MCP** | `renderer/mcp/` | `@mitii/mcp` + `/v1/mcp*` in `server.ts` | `@mitii/mcp` contracts |
| **Skills** | `renderer/skills/` | `engine/skills/` | host / V8 skills |
| **Recipes** | `renderer/recipes/` | host recipes via `server.ts` | `@mitii/host` |
| **Chat** | `renderer/chat/` (+ `App.tsx` layout) | `/v1/prompt`, history | `shared/protocol.ts` |

## Where to put new code

1. **UI for a side** → `renderer/<feature>/`
2. **HTTP / disk for that side** → `engine/<feature>/`
3. **Types used by both** → `shared/<feature>/` (owner stays with the feature)
4. **Wire a new route** → import from `engine/<feature>/` inside `server.ts` (do not grow logic inside `server.ts`)
5. **Wire a new API helper** → `renderer/api.ts` (split per feature later if oversized)

## Docs

- Skills format (repo-wide): [`docs/SKILLS_FORMAT.md`](../../docs/SKILLS_FORMAT.md)
- MCP package: [`packages/mcp`](../../packages/mcp)
- Desktop protocol: `shared/protocol.ts` (`mitii-desktop/v1`)
