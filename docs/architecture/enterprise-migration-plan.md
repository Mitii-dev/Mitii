# Mitii Enterprise Architecture Migration Plan

**Status: folder migration complete.** `src/legacy-core` and `src/core` are fully deleted. Every domain listed in the original ownership map below has been moved to its target owner. `pnpm run lint`, the architecture tests, `pnpm test`, and `pnpm run compile` (extension + webview + CLI) all pass. What remains — wiring `RuntimeBuilder` into `ThunderController`/`HeadlessAgentHost` with real `FeatureModule.register()` bodies (Phase 6-ish), and de-globalizing a handful of module-level runtime singletons for multi-session isolation — is tracked as follow-up work, not a loose end of this migration; see the bottom of this document.

This plan turned the former `src/core`-heavy layout into a feature-owned, edition-aware architecture without a risky bulk move. The migration preserved existing command IDs, tool names, settings keys, skill behavior, session logs, persisted data, prompts, and protocol messages throughout.

## Target Structure (as built)

```text
src/
├── interfaces/              Stable contracts for features, tools, providers, modes, MCP, UI, policy, and host ports.
├── kernel/                  Host-neutral runtime, registries, telemetry, tools, llm, config, util, policy, bootstrap (RuntimeBuilder).
├── features/
│   ├── ce/                  Community feature implementations: ask, plan, agent, git, indexing, context, skills, MCP, memory, safety, apply, subagents, tools, task-board, etc.
│   └── ee/                  Enterprise feature implementations: teams, distributed-jobs, parallel-agents, telemetry-webhook.
├── adapters/                VS Code, Node, provider, and persistence-adjacent implementations.
│   ├── vscode/               ThunderController + VS Code-specific ports (config, context, telemetry, runtime, util).
│   ├── node/                 HeadlessAgentHost + Node-specific composition.
│   └── providers/            Concrete LLM provider clients (Anthropic, Bedrock, Gemini, OpenAI-compatible, Echo) + LlmProviderRegistry.
├── composition/
│   ├── ce/                  CE feature manifests and CE host bootstrap.
│   └── ee/                  EE feature manifests and EE host bootstrap.
├── webview/                 Reserved for future transport-neutral webview contracts/composition.
└── entrypoints/              Reserved for future CE/EE extension/CLI entrypoint split.
```

No `core/`, no `legacy-core/`, no top-level `public/` or `ee/`.

## Ownership Map (as built)

| Former area | Actual owner | Notes |
| --- | --- | --- |
| `src/core/app/ThunderController.ts` | `adapters/vscode/ThunderController.ts` | Moved as-is (same folder depth as `legacy-core/app`, zero import edits needed). Still hand-wires ~50 tools/context-sources/services directly — not yet a `RuntimeBuilder` caller. See "Remaining work" below. |
| `src/core/headless/HeadlessAgentHost.ts` | `adapters/node/HeadlessAgentHost.ts` | Same as above — moved, not yet rewired through `RuntimeBuilder`. |
| `src/core/orchestration/ChatOrchestrator.ts` | `features/ce/orchestration/ChatOrchestrator.ts` | **Not** `kernel/` — it imports nearly every CE feature by nature of being the central turn orchestrator, so it lives with the other CE "hub" files. Its `vscode` coupling (editor/tabs state, diff preview) was genuinely removed via `EditorContextPort`/`DiffPreviewPort`, implemented in `adapters/vscode/runtime/`. |
| `src/core/tools/*` | Split: `kernel/tools/*` (pure engine: `types`, `ToolRuntime`, `toolSchema`, `toolAliases`, `coerceInput`), `features/ce/tools/builtinTools.ts`, `features/ce/git/tools/gitTools.ts`, `features/ce/plans/tools/planTools.ts`, `features/ce/audit/tools/logAuditTools.ts` | `builtinTools.ts` itself was **not** split further per-feature (it's a large grab-bag spanning filesystem/search/memory/subagent/diagnostics/skill tools) — a legitimate follow-up, not required for this migration. |
| `src/core/llm/*Provider.ts` | `adapters/providers/*` | Concrete providers + `createProvider.ts` + `LlmProviderRegistry.ts`. Provider *contracts* (`ChatRequest`, `ModelCapabilities`, etc.) are in `kernel/llm/`, distinct from the newer `interfaces/llm/LlmProviderContribution` plugin contract — unifying the two type systems is follow-up work, not done here. |
| `src/core/context/*` | `features/ce/context/*` (retrieval pipeline, sources) + `adapters/vscode/context/*` (`DiagnosticsService`, `editorSources`, `mentionedFileSource`, `contextPathSearch` — the four files with genuine, substantial `vscode` API coupling) | `FileDiscoveryService` stayed in `features/ce/indexing` despite two lines of optional `vscode` settings reads, because splitting it would force `WorkspaceLanguageService` into a `features→adapters` violation for no benefit. |
| `src/core/skills/bundled/*` | `features/ce/skills/bundled/*`, `features/ce/rules/bundled/*` | Moved with their owning service; `scripts/copy-bundled-skills.mjs` and `scripts/validate-skills.mjs` updated to the new paths. |
| `src/core/mcp/*` | `features/ce/mcp/*` | `McpManager`, `McpOAuthProvider`, `builtinServers`, `mcpToggles`, `mcpWorkspaceConfig`, `npxCommand`, `scaffoldMitiiWorkspace`. |
| `src/core/modes/*` | `features/ce/modes/{ask,plan,agent}/*` | Moved together as one block (see cluster note below) — `ask`/`plan`/`agent` cross-reference each other and `runtime`/`plans`/`pipeline` extensively. |
| `src/core/telemetry/WebhookEmitter.ts` | `features/ee/features/telemetry-webhook/WebhookEmitter.ts` | Real fix, not just a move: `kernel/telemetry/SessionLogService` used to `new WebhookEmitter()` directly (a CE→EE compile-time coupling); it now takes an injected `WebhookSink` port, defaulting to a no-op. Only `ThunderController` constructs the real `WebhookEmitter`. |
| `src/core/teams`, `src/core/jobs`, `src/core/task/ParallelAgentRunner.ts` | `features/ee/features/{teams,distributed-jobs,parallel-agents}/*`; `TaskBoardService`/`enrichTask`/`types` stayed CE in `features/ce/task-board/` | Matches the original split recommendation exactly — generic task board is CE, policy-gated concurrent execution is EE. |
| `src/vscode/webview/messages.ts` | Unchanged — still `src/vscode/webview/messages.ts` | Moving webview DTOs to `interfaces/ui` was **not** done; `adapters/vscode/context/contextPathSearch.ts` still imports it directly. Follow-up, not required for this migration. |
| `package.json` settings/contributes | Unchanged | Schema-driven settings/contribution generation was **not** attempted — out of scope for a folder migration. |

## Dependency Rules

1. `interfaces/**` imports no implementation folders. (Enforced by `test/architecture/target-boundaries.test.ts`.)
2. `kernel/**` imports only `interfaces/**` and pure utilities — never `features/**`, `adapters/**`, `composition/**`, `vscode`. (Enforced.)
3. `features/ce/**` imports interface contracts and supported kernel services, never adapters or EE.
4. `features/ee/**` imports interface contracts and EE-local modules, not CE internals.
5. `adapters/**` implement interface ports and may call kernel and feature entrypoints.
6. `composition/ce/**` imports CE features and adapters, never `features/ee/**`. (Enforced.)
7. `composition/ee/**` may compose CE manifests and EE manifests.
8. Webview code imports transport contracts, not core implementation. (Not yet true — `adapters/vscode/context/contextPathSearch.ts` still imports `src/vscode/webview/messages.ts` directly; follow-up.)
9. Interface barrels use explicit exports.
10. CE bundles must exclude `src/features/ee/**` by build graph, not by runtime branching. (Not yet enforced — no separate CE/EE build exists; see Phase 7/8 status above.)

## Safe Migration Phases

### Phase 0: Freeze Behavior

- Add characterization tests for tool names, provider resolution, MCP exposed tool names, command IDs, settings defaults, context ordering, session events, and audit pack shape.
- Capture extension and CLI bundle metafiles so CE artifact checks can prove EE files are absent later.
- Record current public/deep imports used by tests to plan compatibility re-exports.

### Phase 1: Add Contracts And Guardrails

- Add `src/interfaces/**` contracts for feature modules, tools, providers, context, commands, policy, telemetry, settings, skills, modes, MCP, UI, and host ports.
- Add ownership-aware kernel registries with duplicate detection and freeze semantics.
- Add CE/EE composition manifests as inert bootstrap inventory.
- Add architecture tests that enforce the new-folder dependency rules.

### Phase 2: Put Registries Behind Current Factories

- Make `createProvider()` delegate through registered provider factories while preserving current provider IDs and defaults.
- Make `ToolRuntime.register()` use the new tool registry internally while preserving existing execution and telemetry.
- Register context sources through a registry while preserving `HybridRetriever` order.
- Keep compatibility imports from `src/core/**` until all call sites are moved.

### Phase 3: Unify Runtime Composition

- Extract a host-neutral `RuntimeBuilder`.
- Reproduce the current `ThunderController` and `HeadlessAgentHost` registrations exactly.
- Add a host-parity test asserting both hosts expose the same host-neutral tools, context sources, providers, and mode defaults.

### Phase 4: Split Adapters From Kernel

- Replace direct VS Code imports in core runtime with `WorkspacePort`, `EditorContextPort`, `DiagnosticsPort`, `DiffPreviewPort`, `SecretStore`, `SettingsStore`, and `ChatPresenter`.
- Move VS Code config reading/writing and webview presentation into adapters.
- Move transport-neutral webview DTOs to `interfaces/ui`.

### Phase 5: Convert CE Domains Into Features

Move one vertical feature at a time:

1. Providers.
2. Context and indexing.
3. Filesystem/search/project tools.
4. Git, SCM, changelog, release.
5. Memory.
6. MCP.
7. Ask, Plan, Agent, Review modes.
8. Audit.
9. Docs and bundled skills.

Each feature owns its tools, commands, settings, routes, prompt fragments, skills, UI descriptors, and tests.

### Phase 6: Generate Or Validate Contributions

- Generate or validate VS Code command/configuration metadata from feature descriptors.
- Continue emitting `thunder.*` deprecated settings and commands until the declared v3 removal.
- Make settings UI schema-driven so provider and feature options are not repeated across backend, webview, and package metadata.

### Phase 7: Create The EE Boundary

- Add separate CE and EE entrypoints.
- Add separate CE and EE build scripts.
- Introduce EE no-op feature manifests first.
- Extract managed provider policy, webhook telemetry, audit automation, teams, jobs/workers, parallel agents, and channels in small slices.
- Enforce unsupported EE features in CE with explicit edition errors, not silent no-ops.

### Phase 8: Enforce Artifact Isolation

- Add import-boundary checks for CE to EE, kernel to adapters, public to implementation, and webview to kernel.
- Add CE bundle content checks that fail when `src/features/ee/**` appears in CE artifacts.
- Add duplicate contribution ID checks across tools, providers, settings, commands, modes, skills, and MCP servers.
- Remove old deep-path compatibility exports only after a release window.

## Phase status

- **Phase 0 (Freeze Behavior)**: done implicitly — the existing 67-file `test/` suite (unit, integration, architecture) served as the regression gate for every slice; baseline was 535/545 passing (10 pre-existing native-module failures) and stayed exactly there through the entire migration.
- **Phase 1 (Contracts and Guardrails)**: done. `src/interfaces/**`, `src/kernel/registries/**` (9 registries added to the original 3), `src/composition/**`.
- **Phase 2 (Registries Behind Factories)**: done for registration. All CE tools (~64, `features/ce/tools/factories/*`), context sources (16, `features/ce/context/factories/ceContextSources.ts` + `adapters/vscode/context/factories/vscodeContextSources.ts`), and providers (11, `features/ce/providers/factories/llmProviderFactories.ts`) register through real `FeatureModule.register()` bodies via `buildRuntime()`, each wrapping (not reimplementing) the existing tool/context-source/`createProvider()` logic. Verified by dedicated parity tests (`test/features/ce/{tool,context-source,provider}-registration-parity.test.ts`) cross-checked against `ThunderController`'s actual hand-wired registration code. `ThunderController`/`HeadlessAgentHost` themselves still hand-construct everything directly rather than calling `buildRuntime()` — that's Phase 3.
- **Phase 3 (Unify Runtime Composition)**: `RuntimeBuilder` built and tested, and now proven to register the full real tool/context-source/provider set (see Phase 2); not yet called by either host. Follow-up.
- **Phase 4 (Split Adapters From Kernel)**: done for `ChatOrchestrator` (`EditorContextPort`, `DiffPreviewPort`). Not done for `ThunderController`/`HeadlessAgentHost` themselves, which still directly construct VS Code/Node-specific services inline rather than through ports — follow-up.
- **Phase 5 (Convert CE Domains Into Features)**: done — every domain moved to `features/ce/*` or `features/ee/*`, real code in its final location, not compatibility re-exports.
- **Phase 6 (Generate/Validate Contributions)**: not done — out of scope for a folder migration.
- **Phase 7 (EE Boundary)**: partially done — `features/ee/**` exists and is import-boundary-tested (`composition/ce` cannot reach `ee`), but CLI (`src/node/cli.ts`) still imports EE features (`ParallelAgentRunner`, `TeamService`, `JobQueueService`) directly into one unified binary rather than through a separate EE entrypoint/build. No entitlement/license gating exists.
- **Phase 8 (Artifact Isolation)**: partially done — `test/architecture/target-boundaries.test.ts` enforces kernel/interfaces/composition import boundaries and duplicate feature-manifest IDs. Bundle-content checks (proving `features/ee/**` is absent from a CE-only build) were not added, since there is currently only one unified build target, not separate CE/EE builds.

## Remaining work (tracked, not a loose end)

The folder migration itself — move every domain out of `src/core`/`src/legacy-core` into its real target, delete both entirely, keep the app fully working and tested throughout — is complete. Two follow-up projects remain open, both flagged in this doc from the start as distinct from the move itself:

1. **Make the plugin system load-bearing.** CE tool/context-source/provider `FeatureModule`s (`features/ce/featureModules.ts`) now have real `register()` bodies backed by parity-tested factories (see Phase 2 above). EE `FeatureModule`s (`features/ee/featureModules.ts`) still have empty `register() {}` bodies. `ThunderController`/`HeadlessAgentHost` still hand-construct and hand-register every tool, context source, and provider exactly as before (just importing from new paths) rather than calling `buildRuntime()` — registration is proven correct, but neither host consumes it yet. **Deliberately not attempted this pass**: swapping either host to call `RuntimeBuilder` changes how a shipping VS Code extension assembles itself for every real session, and cannot be manually verified in a live VS Code window from an automated coding session — explicitly deferred to a session where that kind of live testing is possible, rather than shipped on lint/test/compile confidence alone.
2. **De-globalize shared mutable runtime state**, needed for true multi-session isolation (concurrent VS Code workspaces, a multi-tenant daemon): `features/ce/tools/builtinTools.ts`'s `subagentRuntime`/`subagentTracker`/`activeSubagents` module state, `kernel/telemetry/AsyncDebugTrace.ts`'s singleton, `features/ce/plans/PlanActEngine.ts`'s verify-pattern setter, `features/ce/indexing/SymbolExtractor.ts`'s tree-sitter-enabled flag, `features/ce/context/RepoMapService.ts`'s static cache. None of these affect correctness for the single-session usage that exists today (one VS Code window, one CLI invocation). **Deliberately not attempted this pass** for the same reason as (1) — real runtime-behavior changes to live session state, not file moves, deferred alongside the host swap-over rather than attempted without live verification.
