# `@mitii/desktop`

Mitii Desktop — local coding agent with chat, settings, and repository index.
Powered by a local Mitii **engine** (same `@mitii/host` / `@mitii/sdk` stack as CLI).

Desktop does **not** reimplement Decision Policy, tools, or model routing. It
injects the same `@mitii/host` / `@mitii/sdk` ports used by CLI and ACP.

```text
Electron main ──spawn──► mitii-desktop-engine (HTTP loopback)
       │                         │
       │ IPC bridge              │ createDesktopClient()
       ▼                         ▼
   Renderer UI              @mitii/host → @mitii/sdk → @mitii/v8
```

## Architecture contract

Follows [`docs/REPO_LAYOUT.md`](../../docs/REPO_LAYOUT.md) and
[`packages/v8/ARCHITECTURE.md`](../../packages/v8/ARCHITECTURE.md):

| Rule | How desktop complies |
|---|---|
| `apps → host → sdk → v8` | Depends on `@mitii/host`, `@mitii/sdk`, `@mitii/mcp` only |
| No app→app imports | Does **not** import `apps/cli`, `apps/acp`, or `apps/daemon` |
| Hosts inject ports | `createDesktopHost.ts` builds `MitiiClient` like other hosts |
| V8 stays host-neutral | No desktop imports inside `packages/v8` |

### Authority split

1. **Electron** — window lifecycle, workspace picker, settings/secrets IPC, engine spawn  
2. **Engine** — `MitiiClient`, streaming runs, bearer token gate  
3. **Renderer** — chat + settings presentation; talks HTTP to loopback engine  

### Protocol `mitii-desktop/v1`

| Route | Behavior |
|---|---|
| `GET /health` | `{ ok, protocol, version, mode, workspaceRoot }` |
| `POST /v1/prompt` | Body `{ prompt, mode?, id? }` → NDJSON `ready` / `event` / `result` / `error` |
| `GET /v1/git/status` | Working tree snapshot (`staged` / `changes` / `untracked`) |
| `GET /v1/git/branches` | Local branch list + current |
| `POST /v1/git/stage` · `/unstage` · `/discard` · `/commit` · `/checkout` | Safe argv-only mutations (Agent Working Tree UI) |

Optional `Authorization: Bearer <token>` when the engine was started with `--token`.

Settings live in `<userData>/mitii-desktop.sqlite` (connected repos + profiles
are global; other Mitii settings are per workspace). Each connected repo gets a
stable `workspaceId` and keeps its own `.mitii/` artifacts (index, embeddings,
memory, chat history, repo intelligence). API keys use Electron `safeStorage`
under the same userData directory. CLI-compatible
`<workspace>/.mitii/config.json` and `mcp.json` are still written for other tools.

## Quick start

```bash
# from repo root
pnpm install
pnpm --filter @mitii/sdk --filter @mitii/host --filter @mitii/mcp build
pnpm --filter @mitii/desktop build
pnpm --filter @mitii/desktop test

# engine only (no Electron)
pnpm --filter @mitii/desktop engine:echo

# full desktop
pnpm --filter @mitii/desktop dev
```

If you see `Electron failed to install correctly`:

```bash
rm -rf node_modules/electron
pnpm install
node node_modules/electron/cli.js --version
```

`electron` is listed under `onlyBuiltDependencies` in `pnpm-workspace.yaml`.

If `ELECTRON_RUN_AS_NODE` is set, Electron will not create a BrowserWindow.
The `start` / `dev` scripts unset it automatically.

## Layout

```text
apps/desktop/
|-- src/
|   |-- shared/          # protocol, settings, bridge, URL policy
|   |-- engine/         # HTTP host + createDesktopClient
|   |-- main/            # Electron main (spawn, state, secrets, IPC)
|   |-- preload/         # contextBridge
|   `-- renderer/        # React chat + settings
|-- tests/
|-- bin/mitii-desktop-engine.js
`-- README.md
```

## Scripts

| Script | Purpose |
|---|---|
| `build` | `tsc` (main) + **esbuild engine (ESM)** + **esbuild preload (CJS)** + Vite renderer |
| `test` | Contract + engine integration tests |
| `engine:echo` | Run bundled HTTP engine with EchoLlmPort |
| `start` / `dev` | Launch Electron against built artifacts |

> **Why esbuild for the engine?** `@mitii/sdk` / `@mitii/v8` are compiled with
> `moduleResolution: "bundler"` (extensionless imports). Bare Node ESM cannot
> load them — same as `@mitii/cli`, which bundles with esbuild.
>
> **Why CJS preload?** Electron sandboxed preloads need CJS when the package is
> `"type": "module"` (`dist/preload/index.cjs`).

## Tests

```bash
pnpm --filter @mitii/desktop test
```
