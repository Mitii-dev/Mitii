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

Rules ([`packages/v8/ARCHITECTURE.md`](../../packages/v8/ARCHITECTURE.md)):

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
│   ├── server.ts        # wiring only: watcher, index, route dispatch, lifecycle
│   ├── serverOptions.ts # EngineServerOptions / EngineServerHandle
│   ├── routes/          # one module per feature + index.ts route table
│   ├── http/            # httpUtils (json/auth/ndjson), bodyParsers, Route types
│   ├── chat/            # prompt/resume handlers, start-input builder, run streaming
│   ├── explorer/        # workspace fs + watch + incremental index wiring
│   ├── git/             # status, mutations, argv safety
│   ├── skills/          # frontmatter format + recipe
│   └── createDesktopHost.ts
└── renderer/
    ├── App.tsx          # composition root: useAppModel() + <AppShell/>
    ├── api.ts           # thin barrel over api/ (one module per feature)
    ├── api/             # HTTP client modules (chat, git, mcp, workspace, …)
    ├── app/             # useAppModel (wires feature hooks) + AppShell
    ├── shell/           # topbar, activity bar, main section, workspace panel (thin host), hooks/
    ├── chat/            # panel, feed, composer, timeline, markdown, hooks/
    ├── settings/        # SettingsPanel, tabs/, features/, profiles/
    ├── indexing/        # index status chip + hooks/
    ├── explorer/        # file tree, editor tabs, context menu, DiffView, CodeEditor, hooks/
    ├── git/             # Source Control pane + top branch select
    ├── mcp/ skills/ recipes/
    ├── styles.css       # entry: @mitii/ui-theme adapter + ordered partials
    └── styles/          # NN-feature.css partials (import order = cascade order)
```

| Activity | Renderer | Engine | Shared / package |
|---|---|---|---|
| **Explorer** | `renderer/explorer/` (host: `shell/WorkspacePanel`) | `engine/explorer/` | — |
| **Git** | `renderer/git/` | `engine/git/` | `shared/git/` |
| **MCP** | `renderer/mcp/` | `@mitii/mcp` + `engine/routes/mcp.ts` | `@mitii/mcp` contracts |
| **Skills** | `renderer/skills/` | `engine/skills/` | host / V8 skills |
| **Recipes** | `renderer/recipes/` | host recipes via `engine/routes/recipes.ts` | `@mitii/host` |
| **Chat** | `renderer/chat/` (+ `App.tsx` layout) | `/v1/prompt`, history | `shared/protocol.ts` |

## Where to put new code

1. **UI for a side** → `renderer/<feature>/` (container components take `m: <Model>`; state lives in `<feature>/hooks/`)
2. **HTTP / disk for that side** → `engine/<feature>/`
3. **Types used by both** → `shared/<feature>/` (owner stays with the feature)
4. **Wire a new route** → add a handler + `Route` entry in `engine/routes/<feature>.ts`; register the module in `engine/routes/index.ts`. Never add routes or logic to `server.ts`.
5. **Wire a new API helper** → `renderer/api/<feature>.ts`, re-exported from `renderer/api.ts`
6. **New UI state** → a hook in the owning feature's `hooks/`; wire it in `renderer/app/useAppModel.ts` in dependency order
7. **New CSS** → the matching `renderer/styles/NN-*.css` partial (keep ≤600 lines; new partial = new `@import` at the right cascade position in `styles.css`)

## Related

- Skills: [`packages/sdk/skills/`](../../packages/sdk/skills/)
- MCP package: [`packages/mcp`](../../packages/mcp)
- Desktop protocol: `shared/protocol.ts` (`mitii-desktop/v1`)
