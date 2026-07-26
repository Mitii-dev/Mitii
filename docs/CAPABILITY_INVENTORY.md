# Capability inventory (Phase 10)

Status: complete (2026-07-26)  
Scoring: `packages/v8/ROADMAP.md` §9  
Owners (exactly one): `v8` | `sdk` | `apps/vscode` | `apps/cli` | `apps/daemon` | `tests` | `fixtures` | `tools` | `defer` | `delete`

**Decision keys**

| Decision | Meaning |
|---|---|
| `adapt` | Preserve valuable behavior; re-home under target owner / V8 contracts |
| `defer` | Out of critical path until Phase 15 (or later explicit need) |
| `delete` | Do not port; remove when callers are gone |
| `packaging` | Already correct ownership; move packages only (no redesign) |
| `required` | Host/product surface that must exist in target layout |

Score formula (legacy/reference only):  
`0.30·value + 0.25·reliability + 0.20·genericness + 0.15·archFit + 0.10·(10 − migrationRisk)`  
each dimension 0–10. **≥7.0 → adapt by default; &lt;7.0 → do not port by default.** Critical safety flaws reject regardless of score.

V8 rows (section A) live under `packages/v8/src/` (`@mitii/v8`) after Phase 11; scored N/A and marked `packaging`.

---

## Baseline commands (recorded 2026-07-26)

| Command | Exit | Result | Notes |
|---|---|---|---|
| Workspace install | n/a | `node_modules` present; `pnpm` 10.13.1; Node v22.15.0; lockfile 242613 bytes | Fresh `pnpm install --frozen-lockfile` hung under restricted network; treat as already installed |
| `pnpm run typecheck` | 2 | **failed** — 54 `error TS*` | Pre-existing V8/test typing drift (prompt-construction fixtures, skills budgetTokens, unused imports, etc.). Not fixed in Phase 10 |
| `pnpm run test:v8` | 1 | **failed** — 19 files / 103 tests passed; 23 files failed | Failures are mostly `No test suite found` on nested `*.spec.ts` (collection/include mismatch). Do not treat as Phase 10 regression |
| `pnpm exec vitest run test/architecture/` | 0 | **passed** — 2 files / 25 tests | Includes `v8-module-boundaries` + `target-boundaries`. Root script `check:architecture` only runs the latter |
| `pnpm run compile:extension` | 0 | **passed** — `dist/extension.js` ~1.4mb | esbuild |
| `pnpm run compile:cli` | 0 | **passed** — `dist/cli.js` ~1.4mb | skills copy + esbuild |
| `pnpm run sdk:build` | 0 | **passed** — `@mitii/sdk` dist | Phase 10: bundled legacy `HeadlessAgentHost`. **Phase 12 (2026-07-26):** rewritten over `@mitii/v8`; `build`/`typecheck`/`test` (5) pass; daemon deferred |

Dirty worktree at inventory start: untracked `.cursor/`, `packages/v8/ARCHITECTURE.md`, `packages/v8/src/ROADMAP.md`; modified eval manifests under `tools/benchmark/tasks/eval/`. Phase 10 adds `docs/REPO_LAYOUT.md` and this file.

**Baseline implication for Phase 11:** package extract must preserve current V8 test/typecheck debt; do not expand scope to “fix typecheck” inside the mechanical move unless import repair requires it.

**Phase 12 note:** SDK no longer imports legacy controllers. See `packages/sdk/LEGACY_EXPORTS.md` for adapt/defer/delete of pre-Phase-12 exports.

---

## A. Runtime / V8 (now in `packages/v8/src` — owner stays `v8`)

| Capability | Current location | Target owner | Score | Decision | Notes for later phases |
|---|---|---|---|---|---|
| Request Intake | `packages/v8/src/modules/request-intake` | `v8` | N/A | packaging | Move with package extract only |
| Request Understanding | `packages/v8/src/modules/request-understanding` | `v8` | N/A | packaging | |
| Decision Policy | `packages/v8/src/modules/decision-policy` | `v8` | N/A | packaging | |
| Repository State | `packages/v8/src/modules/repository-state` | `v8` | N/A | packaging | indexes, graph, map, embedding ports |
| Repository Context | `packages/v8/src/modules/repository-context` | `v8` | N/A | packaging | retrieval, selection, assembly |
| Prompt Construction | `packages/v8/src/modules/prompt-construction` | `v8` | N/A | packaging | |
| Model Gateway | `packages/v8/src/modules/model-gateway` | `v8` | N/A | packaging | Echo + OpenAI-compatible ports today |
| Skills | `packages/v8/src/modules/skills` | `v8` | N/A | packaging | Phase 9 evaluation gates recorded |
| Memory | `packages/v8/src/modules/memory` | `v8` | N/A | packaging | Phase 9 evaluation gates recorded |
| Verification | `packages/v8/src/modules/verification` | `v8` | N/A | packaging | |
| Tool Runtime | `packages/v8/src/engine/tool-runtime` | `v8` | N/A | packaging | Core tools: read/search/list/diagnostics/git status/fetch/apply_patch; `run_command` stubbed |
| Agent Engine | `packages/v8/src/engine/agent-engine` | `v8` | N/A | packaging | Composition helpers may be re-exported via SDK |
| V8 public barrel | `packages/v8/src/index.ts` | `v8` | N/A | packaging | Becomes `@mitii/v8` entry in Phase 11 |
| V8 architecture tests | `test/architecture/v8-module-boundaries.test.ts` | `tests` | N/A | packaging | Keep module-local `*.spec.ts` under `v8`; move repo architecture suite in Phase 14 |

---

## B. Application hosts and surfaces

| Capability | Current location | Target owner | Score (V/R/G/A/M→total) | Decision | Notes |
|---|---|---|---|---|---|
| VS Code activation / `extension.ts` | `src/extension.ts` | `apps/vscode` | required | required | Move manifest + activate to app package Phase 13 |
| VS Code commands / contributes / activationEvents | root `package.json` | `apps/vscode` | required | required | Must leave root; root becomes private orchestrator |
| VS Code editor bridge | `src/vscode/` | `apps/vscode` | 9.0 / 8.0 / 4.0 / 8.0 / 7.0 → **7.55** | adapt | Host-only; wire through SDK in Phase 15 |
| Webview host bridge | `src/webview/`, `src/vscode/webview/` | `apps/vscode` | 9.0 / 7.5 / 3.0 / 8.0 / 6.5 → **7.10** | adapt | Required chat surface |
| Webview UI (React) | `src/webview-ui/` | `apps/vscode` | 9.0 / 7.0 / 3.0 / 8.0 / 6.0 → **6.95** | adapt | Borderline; keep as nested `webview-ui` under app (UX required) |
| SCM / inline diff / commit helpers | `src/vscode/scm/`, `inlineDiffManager.ts`, diff helpers | `apps/vscode` | 8.0 / 7.0 / 3.5 / 7.5 / 7.0 → **6.68** | adapt | Score &lt;7 but product-critical VS Code UX; adapt narrowly in Phase 15, do not expand |
| Settings / config UI mappers | contributes + mappers / tests | `apps/vscode` | 8.5 / 7.5 / 4.0 / 8.0 / 7.0 → **7.28** | adapt | Required for host settings |
| Secrets / credential retrieval | host-specific (VS Code SecretStorage / env) | `apps/vscode` / `apps/cli` | required | required | Never inside `v8` |
| CLI entry / argv / interactive session | `src/node/cli.ts`, `bin/mitii.js` | `apps/cli` | 9.0 / 7.0 / 7.0 / 6.0 / 4.0 → **7.05** | adapt | Body today imports legacy features + daemon/board; rewrite over SDK; drop deferred commands |
| Native CLI launcher / platform binaries | `packages/cli` | `apps/cli` | 7.5 / 7.0 / 8.0 / 7.0 / 6.0 → **7.25** | adapt | Keep packaging scripts; rewrite JS body over SDK |
| SDK `query()` / typed client / events | `packages/sdk` | `sdk` | 9.5 / 6.0 / 8.0 / 5.0 / 5.0 → **7.10** | adapt | **Phase 12 done:** `createMitiiClient` / `start` / `resume` / `RunEvent` over Agent Engine. Legacy `query`/`ask`/`plan`/daemon listed in `LEGACY_EXPORTS.md` |
| Daemon HTTP/SSE sessions | `packages/daemon` | `defer` | 5.0 / 5.5 / 7.0 / 4.0 / 4.0 → **5.28** | defer | Default defer until Phase 15 needs it |
| Channels adapters | `packages/channels` | `defer` | 4.0 / 4.0 / 6.0 / 3.0 / 5.0 → **4.30** | defer | Out of critical path (`delete` allowed if unused at Phase 15) |
| Board coordination | `packages/board` | `defer` | 3.5 / 4.0 / 6.0 / 3.0 / 5.0 → **4.15** | defer | Out of critical path |

---

## C. Legacy runtime still under `src/` (reference only — do not extend)

| Capability | Current location | Target owner | Score (V/R/G/A/M→total) | Decision | Rule |
|---|---|---|---|---|---|
| Legacy controller / headless host | `src/adapters/node/HeadlessAgentHost.ts`, `src/adapters/vscode/ThunderController.ts`, `src/kernel/bootstrap/` | `delete` (behavior → `sdk`/`apps/*`) | 8.0 / 6.5 / 4.0 / 2.0 / 3.0 → **5.43** | delete | Never import into V8; hosts must call SDK after Phase 12/15. Reimplement orchestration via Agent Engine, not port the controller graph |
| Legacy tool implementations | `src/kernel/tools/`, `src/features/ce/tools/builtinTools.ts` | `v8` (selective) | see subrows | adapt / delete | Port behavior only if ≥7 **and** missing in V8 Tool Runtime |
| → read/list/search/diagnostics/git/apply_patch/fetch | (subset of builtin tools) | `v8` | ~8.5 | adapt | Already present or covered in Tool Runtime; treat as reference only |
| → `write_file` (non-patch) | builtin tools | `delete` | 5.0 / 5.0 / 6.0 / 4.0 / 5.0 → **5.05** | delete | Prefer `apply_patch` + checkpoints |
| → `run_command` (mutating shell) | builtin tools | `v8` | 8.0 / 5.0 / 7.0 / 7.0 / 4.0 → **6.45** | defer | V8 has stub; design under grants/approval before enabling |
| → `spawn_subagent` / `spawn_research_agent` | builtin tools | `defer` | 4.0 / 4.0 / 5.0 / 2.0 / 3.0 → **3.85** | defer | Roadmap defers subagents |
| → `use_skill` / memory tools / repo_map / retrieve_context | builtin tools | `delete` | 6.0 / 5.0 / 5.0 / 3.0 / 5.0 → **5.05** | delete | Superseded by Skills/Memory/Context facades |
| → `ask_question` / script catalog / execute_workspace_script | builtin tools | `apps/cli` or `delete` | 5.5 / 5.0 / 5.0 / 4.0 / 5.0 → **5.08** | delete | Revisit only if Phase 15 UX requires clarify prompts via SDK events |
| Legacy LLM / provider wiring | `src/kernel/llm/`, `src/adapters/providers/` | `v8` + app compose | 8.0 / 7.0 / 7.0 / 6.0 / 5.0 → **6.95** | adapt | Port OpenAI-compatible + echo already in Model Gateway; Anthropic/Gemini/Bedrock as optional adapters behind ports if ≥7 when needed — **Anthropic/Gemini/Bedrock scored 6.8 → defer** until a host requires them |
| Legacy policy / telemetry / config | `src/kernel/policy|telemetry|config/` | `apps/*` / `delete` | 6.0 / 6.0 / 5.0 / 3.0 / 4.0 → **5.15** | delete | App compose may keep thin logging/config; do not recreate as V8 modules |
| Legacy interfaces / DTOs | `src/interfaces/` | `sdk` / `delete` | 5.0 / 6.0 / 6.0 / 3.0 / 5.0 → **5.15** | delete | Prefer SDK + V8 contracts; do not recreate as V8 modules |
| Feature flags CE/EE | `src/features/`, `src/composition/` | `defer` | 5.0 / 5.0 / 3.0 / 2.0 / 3.0 → **3.95** | defer | Edition split is host packaging concern; not V8 modules. Parallel agents / teams / jobs stay deferred |
| CE pipeline (route/depth/skills) | `src/features/ce/pipeline/` | `delete` | 4.0 / 5.0 / 4.0 / 2.0 / 4.0 → **3.90** | delete | Superseded by Request Understanding + Decision Policy |
| CE apply / patch services | `src/features/ce/apply/` | `v8` | 7.5 / 6.5 / 6.0 / 5.0 / 5.0 → **6.43** | delete | Tool Runtime + Verification own mutations; use as reference only if gaps found |
| Node vscode shim | `src/node/vscode-shim.ts` | `apps/cli` / `sdk` | 6.0 / 7.0 / 8.0 / 6.0 / 8.0 → **6.85** | adapt | Keep only while SDK/CLI Node builds need it; remove Phase 15 if unused |
| Shared brand / model presets | `src/shared/` | `apps/vscode` / `sdk` | 6.0 / 7.0 / 7.0 / 5.0 / 8.0 → **6.55** | adapt | Split by owner; no new root `shared` |
| Shared types dumping ground | `src/types/` | `delete` | 3.0 / 5.0 / 5.0 / 2.0 / 8.0 → **4.15** | delete | Relocate ambient decls next to owning package |

---

## D. Root packaging, scripts, tests, tools

| Capability | Current location | Target owner | Score / rule | Decision | Notes |
|---|---|---|---|---|---|
| Workspace orchestration scripts | root `package.json` (~78 scripts) | root (thin) + per-package | N/A | packaging | Root only delegates `pnpm -r` / filters after Phase 11–14 |
| Build: extension / webview / CLI | `scripts/`, vite, esbuild, root scripts | owning app | N/A | packaging | Move with apps in Phase 13 |
| Eval / benchmark / retrieval scripts | root `eval:*`, `benchmark*`, `tools/benchmark` | `tools` + `tests` | 7.0 / 6.0 / 7.0 / 6.0 / 5.0 → **6.45** | adapt | Keep thin runners; replace task corpus in Phase 14 |
| Flat legacy unit/integration tests | `test/**` (excl. architecture) | `tests` / `delete` | 5.0 / 5.0 / 5.0 / 3.0 / 4.0 → **4.55** | delete | Do not bulk-move; replace with SDK/V8-first suites (Phase 14) |
| Architecture boundary tests | `test/architecture/*` | `tests` | 8.0 / 8.0 / 8.0 / 9.0 / 7.0 → **8.10** | adapt | Expand for package graph §1.1 in Phase 14 |
| Language / task fixtures | `test/fixtures`, `tools/benchmark/fixtures|tasks` | `fixtures` | 8.0 / 7.0 / 8.0 / 7.0 / 6.0 → **7.35** | adapt | Consolidate under `fixtures/` |
| Release / vsce / ovsx / npm publish | root `publish:*`, `package`, `release:*` | `apps/vscode` / `packages/*` | required | adapt | Document per publish unit in Phase 13+ |
| CI workflows | `.github/` | root / CI | N/A | packaging | Update as packages appear (Phases 11–15) |
| Docs ARCHITECTURE (repo root) vs V8 | `ARCHITECTURE.md`, `packages/v8/ARCHITECTURE.md` | docs + `v8` | N/A | packaging | V8 ARCHITECTURE remains canonical; this inventory + `REPO_LAYOUT` own packaging |
| Incomplete package shells (`daemon`/`channels`/`board`) | `packages/*` | `defer` | see §B | defer | Quarantine or leave unmarked; remove from critical CI |

---

## E. Binding summary (no TBD owners)

| Bucket | Count (approx.) | Default fate |
|---|---|---|
| V8 runtime | 14 | `packaging` → `packages/v8` |
| Required hosts/SDK | VS Code, CLI, SDK, secrets | Phase 12–13 |
| Adapt (≥7 or required UX) | editor bridge, webview, settings, SCM (narrow), CLI, native launcher, SDK API, arch tests, fixtures, brand/shim | Phases 12–15 |
| Defer | daemon, channels, board, CE/EE edition features, subagents, mutating `run_command` until designed, extra LLM providers | Until Phase 15 need |
| Delete | legacy controllers-as-implementation, superseded tools/pipeline/interfaces/types dumping, bulk legacy tests | After SDK hosts ship |

## F. Shim removal index

See `docs/REPO_LAYOUT.md` §5. Every shim lists introduction phase and mandatory removal phase.

## G. Explicit non-goals until later phases

- Phase 11 moved V8 to `packages/v8/src/` (`@mitii/v8`).
- Phase 12 rewrote `@mitii/sdk` over V8 — **done 2026-07-26**.
- Phase 13 created `apps/cli` + `apps/vscode` and quarantined deferred packages — **done 2026-07-26**.
- Do not bulk-migrate `test/` (Phase 14, after Phase 16 vault + Phase 17 F5).
- Do not leave scored `delete` rows outside the single `legacy/` vault after Phase 16 (physical `legacy:purge` is human-gated).
- Do not defer Phase 15/16/17 waiting on Phase 14 test-surface replacement.
