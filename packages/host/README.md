# `@mitii/host`

Shared **host kit** for Mitii apps (`apps/cli`, `apps/vscode`).

It is the place for durable filesystem adapters, workspace indexing orchestration,
and host UX helpers that must not live in `@mitii/v8` or `@mitii/sdk`.

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

---

## Intent

V8 is host-neutral. Apps still need:

1. **SQLite** (Electron-native in VS Code, `better-sqlite3` in CLI)
2. **On-disk workspace state** under `.mitii/` (indexes, checkpoints, memory, skills)
3. **Wiring** of V8 pipelines that touch the filesystem / optional vendors (LanceDB, Brave)
4. **Shared config UX** (OpenAI-compatible provider presets)

`@mitii/host` centralizes those so CLI and VS Code stay thin and do not drift.

Apps still own environment-specific pieces: secrets, settings UI, MCP, diagnostics,
git adapters, and (in VS Code) Memento-backed memory if preferred over the file store.

---

## Source layout (by intent)

```text
src/
  index.ts                 # public barrel — import from `@mitii/host`
  sqlite/                  # injection contract for openDatabase
  indexing/                # embeddings, full index, fingerprint snapshot
  repository-context/      # createHostRepositoryContext
  ports/                   # V8/SDK port adapters (search, memory, skills, checkpoints)
  prompt/                  # project rules loader → start({ projectRules })
  config/                  # provider presets (not a V8 port)
  internal/                # private helpers (not part of the public contract)
```

Prefer importing from `@mitii/host`. Do not import `internal/`.

---

## Contract: what this package implements

| Host API | Satisfies | Notes |
|---|---|---|
| `OpenHostSqliteDatabase` | Host injection | Required by indexing + repository context |
| `OpenAiCompatibleEmbeddingProvider` | V8 `EmbeddingProvider` | Optional semantic path |
| `createLanceDbConnection` | V8 `LanceDbConnectionPort` | Optional `@lancedb/lancedb` |
| `runFullWorkspaceIndex` | Orchestrates V8 index runtime | Writes `.mitii/repository-index.sqlite`, LanceDB, graph/map |
| `buildWorkspaceSnapshot` | Builds `PublishRepositoryStateInput` | Fingerprint-only; indexes marked unavailable |
| `createHostRepositoryContext` | V8 `RepositoryContextPipeline` | Hybrid retrieve + file-map fallback |
| `createWorkspaceCheckpointStore` | SDK `FileRunCheckpointStore` | `.mitii/checkpoints/` |
| `createWorkspaceMemoryStore` | V8 `MemoryStorePort` | `.mitii/memory/facts.json` (CLI; VS Code may use Memento) |
| `createOptionalSearchPort` | V8 `SearchPort` | Brave when `MITII_SEARCH_API_KEY` / `BRAVE_API_KEY` set |
| `createFileSystemSkillsCatalog` | V8 `SkillsCatalogPort` | `.mitii/skills` + SDK defaults |
| `loadProjectRules` | SDK `MitiiStartInput.projectRules` | `AGENTS.md`, `.mitii/rules`, `MITTII.local.md` |
| `PROVIDER_PRESETS` / `getProviderPreset` | Host config only | Prefills base URL / model / auth style |

---

## How hosts wire it

Typical composition (both apps follow this shape):

```ts
import {
  createFileSystemSkillsCatalog,
  createHostRepositoryContext,
  createOptionalSearchPort,
  createWorkspaceCheckpointStore,
  createWorkspaceMemoryStore, // CLI; VS Code may inject Memento instead
  getProviderPreset,
  loadProjectRules,
  runFullWorkspaceIndex,
  buildWorkspaceSnapshot,
} from '@mitii/host';

// 1. Inject SQLite opener (app-specific)
const openDatabase = /* better-sqlite3 | Electron native */;

// 2. Build client ports
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

// 3. Per turn: load project rules into start()
const projectRules = await loadProjectRules({ workspaceRoot });
await client.start({ /* … */, projectRules });
```

**Indexing flow:** prefer `runFullWorkspaceIndex` → publish repository state. If that fails or has not run, fall back to `buildWorkspaceSnapshot` (honest fingerprint: `codeIndex` / `textIndex` / `vectorIndex` unavailable).

---

## Naming note: `WorkspaceSnapshot`

`buildWorkspaceSnapshot` returns a **host fingerprint result** (`candidate` + `fileCount` + …).

That is **not** the V8 `WorkspaceSnapshot` type used inside indexing/retrieval. The public name is kept for API stability; the implementation lives in `indexing/fingerprintSnapshot.ts`.

---

## What stays outside this package

| Concern | Owner |
|---|---|
| Provider secrets / API keys in settings | App |
| Semantic index settings resolution | App (`resolve*SemanticIndexSettings`) |
| VS Code Memento memory | `apps/vscode` (file store remains available for CLI / non-Memento hosts) |
| MCP, diagnostics, git | App |
| Agent algorithms, prompts, tool policy | `@mitii/v8` via `@mitii/sdk` |

---

## On-disk layout (workspace)

```text
<workspace>/.mitii/
  repository-index.sqlite
  lancedb/                 # optional vector store
  index-runtime.json
  checkpoints/
  memory/facts.json        # file-backed MemoryStorePort
  skills/<id>/SKILL.md
  rules/**/*.md            # project rules (also AGENTS.md / MITTII.local.md at root)
```

---

## Development

```bash
pnpm --filter @mitii/host typecheck
pnpm --filter @mitii/host test
pnpm --filter @mitii/host build
```
