# Mitii repository layout (Phases 10–17)

Status: Phase 17 **complete** (2026-07-26); **Phase 14 next** (tests + solid benchmark)  
Canonical V8 architecture: `packages/v8/ARCHITECTURE.md`  
Capability decisions: `docs/CAPABILITY_INVENTORY.md`  
F5 operator guide: `docs/INITIAL_LAUNCH.md`  
Tests / solid benchmark: `docs/TESTS.md`

This document freezes **product package boundaries**. It does not redesign V8 module internals. Live V8 code is at `packages/v8/src/` (`@mitii/v8`). Hosts and tests prefer `@mitii/sdk` over V8 public facades.

Execution order:

1. **Phase 16** — clean active tree; one `legacy/` vault + one-click purge; strip new-code compat — **done** (vault purged 2026-07-26)
2. **Phase 17** — F5 / initial launch wiring for `apps/vscode` — **done** (`pnpm run phase17:verify`)
3. **Phase 14** — `tests/` + solid benchmark + package consumer suites (last) — **next**

## 1. Target dependency graph

```text
apps/vscode ──┐
apps/cli    ──┼──► packages/sdk ──► packages/v8
              │              │
tests/* ──────┤              ├── modules/* (business facades)
  (incl. tests/benchmark)    └── engine/*

Forbidden:
  packages/v8 → apps/* | packages/sdk | vscode | webview
  packages/sdk → apps/* | vscode
  apps/* → another app's internals
  any product package → tests/* | legacy/*
  F5 / CI → legacy/*
```

## 2. Target repository tree

```text
mitii/
├── package.json                 # private workspace root ONLY
├── pnpm-workspace.yaml
├── .vscode/                     # F5 → apps/vscode (Phase 17)
├── packages/
│   ├── v8/                      # @mitii/v8
│   └── sdk/                     # @mitii/sdk
├── apps/
│   ├── vscode/
│   └── cli/
├── tests/                       # Phase 14
│   ├── reports/
│   ├── benchmark/               # solid suite (from repo-root benchmark/)
│   ├── packages/{v8,sdk}/
│   ├── architecture/
│   ├── contract/
│   ├── integration/
│   └── e2e/
├── docs/
└── (legacy/ purged — do not recreate)
```

After Phase 16 + human purge the active root must not keep a second `src/` kernel, active `test/` dump, twin `tools/benchmark`, or a `legacy/` vault.

## 3. Package names and publish units

| Package / app | npm / publish name | Notes |
|---|---|---|
| V8 runtime | `@mitii/v8` | `packages/v8` |
| SDK | `@mitii/sdk` | hosts/tests use this |
| CLI | `@mitii/cli` | solid benchmark agent target |
| VS Code extension | `@mitii/vscode` | VSIX; F5 development path |
| Solid benchmark | `@mitii/solid-benchmark` | `tests/benchmark` after Phase 14 |
| Workspace root | private | never published as product |

## 4. Binding decisions

1. Host → SDK → V8 is mandatory for VS Code and CLI.
2. Daemon / channels / board were purged with `legacy/`; adapt only if reintroduced as new `apps/*` over SDK with score ≥7.
3. **Legacy vault:** purged (2026-07-26) via `pnpm run legacy:purge`. Do not recreate `src/kernel` or a second legacy tree.
4. **F5** loads `apps/vscode` only (`docs/INITIAL_LAUNCH.md`).
5. **Tests:** only `tests/` + package-local `*.spec.ts`; old suites were vaulted then purged, not ported.
6. Shim / dual-brand (`thunder.*`) removed in Phase 16.

## 5. Temporary shim policy

| Shim | Must remove by |
|---|---|
| `apps/vscode` `thunder.*` dual APIs | Phase 16 |
| Deprecated V8/SDK aliases | Phase 16 |
| Root scripts pointing at `src/extension.ts` | Phase 16 |
| `.vscode` thunder prelaunch / root extensionPath | Phase 17 — **done** |
| Repo-root `benchmark/` (before move) | Phase 14 → `tests/benchmark/` |
| `legacy/` vault itself | **Purged** 2026-07-26 (`MITII_PURGE_LEGACY=1 pnpm run legacy:purge`) |

## 6. Phase checkpoints

| Phase | Outcome |
|---|---|
| 10–13 | Packaging — **done** |
| 15 | Host UX on SDK/V8 — **done** |
| 16 | Clean repo + `legacy/` vault + strip compat — **done** (vault **purged**) |
| 17 | F5 / initial launch wiring — **done** (`phase17:verify`) |
| 14 | `tests/` + solid benchmark — **next (last)** |

## 9. Related documents

- `packages/v8/ARCHITECTURE.md`
- `packages/v8/ROADMAP.md`
- `docs/CAPABILITY_INVENTORY.md`
- `docs/INITIAL_LAUNCH.md`
- `docs/TESTS.md`
- `docs/RELEASE.md`
- `scripts/legacy-purge.mjs` (idempotent guard; exits non-zero if `legacy/` already absent)
