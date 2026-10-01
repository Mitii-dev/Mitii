# `@mitii/host`

Shared **host kit** for Mitii apps (`@mitii/cli`, VS Code extension).

Durable filesystem adapters, workspace indexing, and host UX helpers that must not live in `@mitii/v8` or `@mitii/sdk`.

```text
apps/cli | apps/vscode
        |
        v
  @mitii/host     <- this package
        |
        +--> @mitii/search-kit   (web retrieval helpers)
        |
        v
  @mitii/sdk
        |
        v
  @mitii/v8
```

Forbidden: `host -> apps`, `sdk -> host`, `v8 -> host`, `search-kit -> host|sdk|v8`.

## Install

```bash
npm install @mitii/host
```

Requires **Node.js 20+**. Depends on `@mitii/sdk`, `@mitii/v8`, `@mitii/search-kit`, and `zod`. Optional: `@lancedb/lancedb` for the vector store, `onnxruntime-node` / `onnxruntime-web` for bundled MiniLM embeddings. License: **AGPL-3.0-or-later**.

Published on `v*` release tags. For local development, consume via the workspace (`pnpm --filter @mitii/host`).

## Intent

V8 is host-neutral. Apps still need:

1. **SQLite** (Electron-native in VS Code, `better-sqlite3` in CLI)
2. **On-disk workspace state** under `.mitii/` (indexes, checkpoints, memory, skills)
3. **Wiring** of V8 pipelines that touch the filesystem / optional vendors (LanceDB, Brave)
4. **Shared config UX** (provider presets, LlmPort factory, connection probe)

`@mitii/host` centralizes those so CLI and VS Code stay thin and do not drift.

Apps still own environment-specific pieces: secrets, settings UI, MCP, diagnostics, git adapters, and (in VS Code) Memento-backed memory if preferred over the file store.

## Source layout

```text
src/
  index.ts                 # public barrel - import from `@mitii/host`
  sqlite/                  # injection contract for openDatabase
  indexing/                # embeddings, full index, fingerprint snapshot, pipeline health
    bundled-embedding/     # on-device MiniLM source (native ONNX + WASM)
    treeSitter/            # web-tree-sitter runtime; V8 injects query text
  repository-context/      # createHostRepositoryContext
  corpus/                  # optional `.mitii/corpus/` index + retrieval source
  runtime/                 # child-run narrowing helpers
  ports/                   # search, network (content-aware), memory, skills, checkpoints
  prompt/                  # project rules loader -> start({ projectRules })
  config/                  # provider presets (not a V8 port)
  internal/                # private helpers (not public)
```

Prefer importing from `@mitii/host`. Do not import `internal/`.

## Contract

| Host API | Satisfies | Notes |
|---|---|---|
| `OpenHostSqliteDatabase` | Host injection | Required by indexing + repository context |
| `OpenAiCompatibleEmbeddingProvider` | V8 `EmbeddingProvider` | HTTP Ollama / OpenAI-compatible embeddings |
| `createBundledMiniLmEmbeddingProvider` | V8 `EmbeddingProvider` | On-device MiniLM (native ONNX, WASM fallback) |
| `createLanceDbConnection` | V8 `LanceDbConnectionPort` | Optional `@lancedb/lancedb` vector store |
| `runFullWorkspaceIndex` | Orchestrates V8 index runtime | Writes `.mitii/repository-index.sqlite`, LanceDB, graph/map |
| `readIndexPipelineHealth` / `formatIndexPipelineHealthLines` | Index observability | Code / FTS5 / Embeddings / Graph / native status from `.mitii/` |
| `runCorpusIndex` / `CorpusRetrievalSource` | Optional corpus RAG | Indexes `.mitii/corpus/` markdown/text → `index.json`; hybrid `additionalSources` when `corpusEnabled` |
| `buildWorkspaceSnapshot` | Builds `PublishRepositoryStateInput` | Fingerprint-only; indexes marked unavailable. `roots[0].rootId` is the workspace directory basename. |
| `createHostRepositoryContext` | V8 `RepositoryContextPipeline` | Hybrid retrieve + file-map fallback. File-map fallback honors `folderPrefix`. Optional `corpusEnabled` (default false). |
| `createWorkspaceCheckpointStore` | SDK checkpoint store | `.mitii/checkpoints/` |
| `createWorkspaceVerificationStore` | Verification record store | `.mitii/verification/` |
| `createWorkspaceReviewStore` | Review record store | `.mitii/review/` |
| `createWorkspaceMemoryStore` | V8 `MemoryStorePort` | `.mitii/memory/facts.json` (queue, file locks, `transact`, recovery guards, honest deletes) |
| `listPendingMemories` / `approvePendingMemory` | Memory approve queue | `.mitii/memory/pending.json` — `autoPromote` default false |
| `narrowChildStartInput` | Child-run helper | Mode ≤ parent; deny-only `userSafetyRules`; `enabled` default off |
| `createWorkspaceKnowledgeGraph` | V8 `KnowledgeGraphPort` | `.mitii/memory/graph.jsonl` (entities/relations beside facts) |
| `createOptionalSearchPort` | V8 `SearchPort` | Multi-provider via `@mitii/search-kit` (SearXNG / Brave / Tavily). SecretStorage `mitii.search.apiKey` or env keys. |
| `createHostNetworkPort` | V8 `NetworkPort` | Content-aware wrapper: SO / GitHub issues / Wiki / arXiv / HTML readability before raw HTTP. |
| `createFileSystemSkillsCatalog` | V8 `SkillsCatalogPort` | SDK bundled `skills/` + `.mitii/skills` |
| `buildWritingRecipeAsk` | Host recipes | Force-attach commit / PR / changelog skills + git context |
| `buildFixReviewFindingsAsk` | Host recipes | Compile review findings → Agent prompt + `fix-review-findings` skill (no ToolGrant) |
| `compileRecipeToStartInput` / `RecipeSpec` | Parameterized recipes | Prompt/mode/skills/autonomy only — never widens ToolGrant |
| `loadRecipeSpec` | Parameterized recipes | Load `.mitii/recipes/<id>.json` (schemaVersion: 1) |
| `loadProjectRules` | SDK `projectRules` | `AGENTS.md`, `.mitii/rules`, `MITTII.local.md` |
| `PROVIDER_PRESETS` / `getProviderPreset` | Host config only | Prefills base URL / model / adapter |
| `createHostLlmPorts` | Host composition | Echo, OpenAI-compatible, Anthropic, Gemini. Presets may set `defaultCapabilities` (e.g. disable forced tool choice + structured output for thinking endpoints). |
| `testProviderConnection` | Host UX | Probe without starting a run |

## How hosts wire it

```ts
import {
  createFileSystemSkillsCatalog,
  createHostNetworkPort,
  createHostRepositoryContext,
  createOptionalSearchPort,
  createWorkspaceCheckpointStore,
  createWorkspaceMemoryStore,
  getProviderPreset,
  loadProjectRules,
  runFullWorkspaceIndex,
} from '@mitii/host';
import { createMitiiClient, NodeNetworkAdapter, ToolRuntimePipeline } from '@mitii/sdk';

const openDatabase = /* better-sqlite3 | Electron native */;

const tools = new ToolRuntimePipeline({
  /* ... */,
  search: createOptionalSearchPort(process.env),
  network: createHostNetworkPort({
    inner: new NodeNetworkAdapter(),
    env: process.env,
  }),
});

const repositoryContext = createHostRepositoryContext({
  repositoryState,
  workspaceRoot,
  openDatabase,
  semanticIndex,
});

const client = createMitiiClient({
  /* llms... */
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
await client.start({ /* ... */, projectRules });
```

**Indexing:** prefer `runFullWorkspaceIndex` -> publish repository state. If that has not run, fall back to `buildWorkspaceSnapshot` (honest fingerprint: indexes unavailable).

**Index pipeline health:** call `readIndexPipelineHealth({ workspaceRoot })` (or CLI `mitii index --status`) to see which pipeline is ready vs failed: Code Index, Text FTS5, Embeddings, Graph/Map, Tree-sitter, and native sqlite / LanceDB / ONNX. Overall is `ready`, `lexical_only`, `running`, `failed`, or `missing`.

**Semantic retrieval** is off unless the host passes `semanticIndex.enabled` (and a ready embedding profile). When disabled, repository context logs `semantic_index_disabled` and falls back to path-based discovery.

**Memory** persists under `.mitii/memory/facts.json` when `createWorkspaceMemoryStore` is injected. The adapter accepts validated facts and returns validated facts through `query`/`list`; `delete` returns `{ id, deleted, message }`. Mutations read and validate the stored envelope and every row before replacing the file using a same-directory temporary file and rename. A per-instance mutation queue serializes calls through one adapter object; exclusive directory locks coordinate separate instances and processes on the same facts file. `transact` applies a scoped decision and writes its full change set under that same lock.

A missing file is a cold start. A corrupt or unsupported envelope is an error, never an empty writable store. Supported storage versions are 1 and 2; absent legacy scope/privacy fields retain their existing defaults, and valid date offsets normalize to UTC. Invalid metadata is no longer silently replaced with defaults. Valid rows in a partially damaged envelope remain readable, but commits, deletes, and access updates reject until recovery, including when duplicate IDs or unknown fact fields would otherwise be discarded. Failed write validation never filters a fact out of the replacement envelope.

`MemoryStorageError`, `memoryStorageErrorCodeSchema`, and the inferred `MemoryStorageErrorCode` are public exports. Error messages contain no stored payloads:

| Code | Meaning |
|---|---|
| `memory_storage_corrupt` | Invalid JSON or envelope shape; reads and mutations reject |
| `memory_storage_version_unsupported` | Unsupported storage version; reads and mutations reject |
| `memory_storage_recovery_required` | Invalid rows or duplicate IDs; valid rows remain readable but mutations reject |
| `memory_storage_invalid_fact` | An incoming or updated fact fails validation; mutation rejects |

Filesystem errors other than a missing file propagate unchanged. The memory pipeline can still return recoverable facts when access updates fail, with an access-touch warning. These guards apply to the file fact adapter; pending drafts and observations share atomic write + lock helpers and content sanitization, while graph persistence and VS Code Memento have separate owners with matching content-policy expectations.

For recovery, stop writers, preserve a copy of the original file, and restore a verified supported envelope from a backup or explicitly repair its invalid rows. Do not substitute an empty file. Unsupported versions need a compatible Mitii version or an explicit migration. The next operation rechecks disk, so a repaired file can be used without recreating the adapter. Automatic repair, backups, and schema migration are not performed by this adapter. A crashed writer's lock directory is retained until recovered; other writers fail after a short wait rather than taking over a stale lock.

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
  checkpoints/             # suspended AgentRunCheckpoint JSON + restore/
    restore/<runId>/       # RestorePoint schemaVersion 1 (undo after mutations)
  memory/facts.json
  skills/<id>/SKILL.md     # workspace overrides (same name wins)
  rules/**/*.md
```

Unknown RestorePoint schema versions are ignored. Clear with
`rm -rf .mitii/checkpoints` (no dual deserializer).

## Skills and writing recipes

- **Catalog:** `createFileSystemSkillsCatalog({ workspaceRoot, contentMode: 'metadata' })` loads SDK-bundled skills then workspace `.mitii/skills/`.
- **Format:** [`docs/SKILLS_FORMAT.md`](../../docs/SKILLS_FORMAT.md), pack notes in [`packages/sdk/skills/README.md`](../sdk/skills/README.md).
- **Writing recipes:** `buildWritingRecipeAsk({ recipe: 'commit-message' | 'pr-summary' | 'changelog', workspaceRoot })` gathers git context and returns `requiredSkillIds` for VS Code SCM helpers and CLI.
- **Parameterized recipes:** `RecipeSpec` (`schemaVersion: 1`) under `.mitii/recipes/<id>.json`. `compileRecipeToStartInput` fills `prompt` / `mode` / `requiredSkillIds` / `autonomyPreset` only — Decision Policy still owns grants. CLI: `mitii recipe run <id> --param k=v`.

## Database mode

Read-only NL→SQL overlay for Desktop, VS Code, CLI, and ACP. See [`src/database-mode/README.md`](./src/database-mode/README.md) and [`ARCHITECTURE.md`](./src/database-mode/ARCHITECTURE.md).

```ts
import {
  isDatabaseUiMode,
  resolveDatabaseModeStart,
  mapUiModeToAgentMode,
} from '@mitii/host';

if (isDatabaseUiMode(uiMode)) {
  const overlay = resolveDatabaseModeStart({ workspaceRoot });
  client.start({
    mode: mapUiModeToAgentMode(uiMode), // 'ask'
    ...overlay.startFields,
  });
}
```

- Builtin profile slug: `database` (ask + read/mcp/command; no edit)
- Forced skill: `nl-sql-analyst`
- Pins installed DB MCP via `requiredMcpServerIds` (Ask MCP grant); plain Ask is unchanged

## Index pin and reuse

`buildWorkspaceSnapshot` / `resolveFingerprintRootId` set `roots[0].rootId` to the workspace directory basename (not a hardcoded `"workspace"`). That keeps fingerprint identity stable across republish.

VS Code `hostAsk` reuses an existing `.mitii/repository-index.sqlite` when `getLatest` is empty: it publishes that fingerprint pin and skips a full reindex. File-map fallback in `createHostRepositoryContext` filters snapshot/map paths with `folderPrefix`.

### Corpus indexing (optional)

Place markdown/text under `.mitii/corpus/`, then call `runCorpusIndex({ workspaceRoot })` to write `.mitii/corpus/index.json` (file list + chunk excerpts). Pass `corpusEnabled: true` to `createHostRepositoryContext` to register `CorpusRetrievalSource` via hybrid `additionalSources` when that index exists. Default remains off.

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
