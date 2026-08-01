# `@mitii/host`

Shared **host kit** for Mitii apps (`@mitii/cli`, VS Code extension).

Durable filesystem adapters, workspace indexing, and host UX helpers that must not live in `@mitii/v8` or `@mitii/sdk`.

```text
apps/cli | apps/vscode
        ↓
  @mitii/host     ← this package
        ↓
  @mitii/sdk
        ↓
  @mitii/v8
```

Forbidden: `host → apps`, `sdk → host`, `v8 → host`.

## Install

```bash
npm install @mitii/host
```

Requires **Node.js 20+**. Depends on `@mitii/sdk` and `@mitii/v8`. Optional: `@lancedb/lancedb` for vectors. License: **AGPL-3.0-or-later**.

Published on `v*` release tags. For local development, consume via the workspace (`pnpm --filter @mitii/host`).

## Intent

V8 is host-neutral. Apps still need:

1. **SQLite** (Electron-native in VS Code, `better-sqlite3` in CLI)
2. **On-disk workspace state** under `.mitii/` (indexes, checkpoints, memory, skills)
3. **Wiring** of V8 pipelines that touch the filesystem / optional vendors (LanceDB, Brave)
4. **Shared config UX** (OpenAI-compatible provider presets)

`@mitii/host` centralizes those so CLI and VS Code stay thin and do not drift.

Apps still own environment-specific pieces: secrets, settings UI, MCP, diagnostics, git adapters, and (in VS Code) Memento-backed memory if preferred over the file store.

## Source layout

```text
src/
  index.ts                 # public barrel — import from `@mitii/host`
  sqlite/                  # injection contract for openDatabase
  indexing/                # embeddings, full index, fingerprint snapshot
  repository-context/      # createHostRepositoryContext
  ports/                   # search, memory, skills, checkpoints
  prompt/                  # project rules loader → start({ projectRules })
  config/                  # provider presets (not a V8 port)
  internal/                # private helpers (not public)
```

Prefer importing from `@mitii/host`. Do not import `internal/`.

## Contract

| Host API | Satisfies | Notes |
|---|---|---|
| `OpenHostSqliteDatabase` | Host injection | Required by indexing + repository context |
| `OpenAiCompatibleEmbeddingProvider` | V8 `EmbeddingProvider` | Optional semantic path |
| `createLanceDbConnection` | V8 `LanceDbConnectionPort` | Optional `@lancedb/lancedb` |
| `runFullWorkspaceIndex` | Orchestrates V8 index runtime | Writes `.mitii/repository-index.sqlite`, LanceDB, graph/map |
| `buildWorkspaceSnapshot` | Builds `PublishRepositoryStateInput` | Fingerprint-only; indexes marked unavailable |
| `createHostRepositoryContext` | V8 `RepositoryContextPipeline` | Hybrid retrieve + file-map fallback |
| `createWorkspaceCheckpointStore` | SDK checkpoint store | `.mitii/checkpoints/` |
| `createWorkspaceMemoryStore` | V8 `MemoryStorePort` | `.mitii/memory/facts.json` |
| `createOptionalSearchPort` | V8 `SearchPort` | Brave when `MITII_SEARCH_API_KEY` / `BRAVE_API_KEY` set |
| `createFileSystemSkillsCatalog` | V8 `SkillsCatalogPort` | `.mitii/skills` + SDK defaults |
| `loadProjectRules` | SDK `projectRules` | `AGENTS.md`, `.mitii/rules`, `MITTII.local.md` |
| `PROVIDER_PRESETS` / `getProviderPreset` | Host config only | Prefills base URL / model / auth style |

## How hosts wire it

```ts
import {
  createFileSystemSkillsCatalog,
  createHostRepositoryContext,
  createOptionalSearchPort,
  createWorkspaceCheckpointStore,
  createWorkspaceMemoryStore,
  getProviderPreset,
  loadProjectRules,
  runFullWorkspaceIndex,
} from '@mitii/host';
import { createMitiiClient, ToolRuntimePipeline } from '@mitii/sdk';

const openDatabase = /* better-sqlite3 | Electron native */;

const tools = new ToolRuntimePipeline({
  /* … */,
  search: createOptionalSearchPort(process.env),
});

const repositoryContext = createHostRepositoryContext({
  repositoryState,
  workspaceRoot,
  openDatabase,
  semanticIndex,
});

const client = createMitiiClient({
  /* llms… */
  repositoryState,
  repositoryContext,
  tools,
  checkpointStore: createWorkspaceCheckpointStore(workspaceRoot),
  skillsCatalog: createFileSystemSkillsCatalog({
    workspaceRoot,
    contentMode: 'metadata',
  }),
  memoryStore: createWorkspaceMemoryStore(workspaceRoot, workspaceId),
});

const projectRules = await loadProjectRules({ workspaceRoot });
await client.start({ /* … */, projectRules });
```

**Indexing:** prefer `runFullWorkspaceIndex` → publish repository state. If that has not run, fall back to `buildWorkspaceSnapshot` (honest fingerprint: indexes unavailable).

## Naming note: `WorkspaceSnapshot`

`buildWorkspaceSnapshot` returns a **host fingerprint result**. That is **not** the V8 `WorkspaceSnapshot` type used inside indexing/retrieval.

## What stays outside this package

| Concern | Owner |
|---|---|
| Provider secrets / API keys | App |
| Semantic index settings resolution | App |
| VS Code Memento memory | `apps/vscode` |
| MCP, diagnostics, git | App |
| Agent algorithms, prompts, tool policy | `@mitii/v8` via `@mitii/sdk` |

## On-disk layout (workspace)

```text
<workspace>/.mitii/
  repository-index.sqlite
  lancedb/                 # optional vector store
  index-runtime.json
  checkpoints/
  memory/facts.json
  skills/<id>/SKILL.md
  rules/**/*.md
```

## Development (monorepo)

```bash
pnpm --filter @mitii/host typecheck
pnpm --filter @mitii/host test
pnpm --filter @mitii/host build
```

## Links

- Repo: [Mitii-dev/Mitii](https://github.com/Mitii-dev/Mitii)
- Runtime: [`@mitii/v8`](https://github.com/Mitii-dev/Mitii/tree/main/packages/v8)
- SDK: [`@mitii/sdk`](https://github.com/Mitii-dev/Mitii/tree/main/packages/sdk)
