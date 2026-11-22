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

## Input / output

| | |
|---|---|
| **Input** | Prompt, workspace, UI mode, approval preset, thoroughness, budgets, host-owned environment / conversation / pins |
| **Output** | `{ start: MitiiStartInput, effectiveMode, meta }` — `start` is Zod-validated |
| **Failure** | `HostStartOptionsError` (`invalid_prepare_start_input`, `unknown_mode_profile`) |

## Ports / non-responsibilities

Hosts still own: secrets, settings UI → scalars, IDE environment blocks, trust,
streaming UI, process model, SQLite opener, memory backend.

## Merge order

1. Disk project rules → mode profile rules → database overlay rules  
2. Disk safety → `extraUserSafetyRules` → mode safety → database safety  
3. Approval preset → database approval override → `approvalOverride`

## Exports

`prepareStartInput`, `resolveApprovalPreset`, `THOROUGHNESS_MAP`, contracts.
