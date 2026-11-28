# Start assembly (`prepareStartInput`)

Single source of truth for core `MitiiStartInput` assembly shared by Desktop,
VS Code, CLI, and ACP.

## Responsibility

Merge host-neutral run policy before `MitiiClient.start`:

- Approval presets via SDK `getApprovalPresetCopy` (Pilot = `never` / `never`)
- Thoroughness → exploration depth + window effort
- Disk project rules (`AGENTS.md`, `.mitii/rules`, `MITTII.local.md`)
- Mode profiles (`.mitii/modes.json`)
- User safety (`.mitii/safety.json`) + optional host fragments (hooks)
- Database-mode overlay (skills / MCP pins / access tier)
- Skill and MCP pin merges
- **Orient `runtimeSituation`** (default when `workspaceRoot` set): git status,
  dirty paths, cwd, discovered workspace packages + relationships + config
  pointers, optional focused file / selection / diagnostics (VS Code IDE or
  soft Node module-load diagnostics for `.js`/`.mjs`/`.cjs`)

## Input / output

| | |
|---|---|
| **Input** | Prompt, workspace, UI mode, approval preset, thoroughness, budgets, host-owned environment / conversation / pins / editor situation |
| **Output** | `{ start: MitiiStartInput, effectiveMode, meta }` — `start` is Zod-validated; includes `runtimeSituation` + `dirtyPaths` when attached |
| **Failure** | `HostStartOptionsError` (`invalid_prepare_start_input`, `unknown_mode_profile`) |

## Ports / non-responsibilities

Hosts still own: secrets, settings UI → scalars, IDE environment prompt blocks,
trust, streaming UI, process model, SQLite opener, memory backend, LSP digests.
Situation gather is soft-fail (missing git/catalog never blocks start).

## Merge order

1. Disk project rules → mode profile rules → database overlay rules  
2. Disk safety → `extraUserSafetyRules` → mode safety → database safety  
3. Approval preset → database approval override → `approvalOverride`  
4. Gathered `runtimeSituation` → optional host `runtimeSituation` override

## Exports

`prepareStartInput`, `buildRuntimeSituation`, `readWorkspaceCatalogSlice`,
`resolveApprovalPreset`, `THOROUGHNESS_MAP`, contracts.
