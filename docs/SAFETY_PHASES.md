# Mitii Safety Phases (A–D)

Status: shipped in-tree  
Audience: contributors and hosts (VS Code / CLI)

This document is the product README for the safety workstream that compares Mitii's Decision Policy with Kilo-style permissions/sandbox **without** cloning a second permission engine.

## Goals

| Phase | Goal | Accuracy impact |
|---|---|---|
| **A** | Seal goldens, preset UX copy, effective grant readout | **None** - trust / clarity |
| **B** | `mitii run --auto`, tighten-only `.mitii/safety.json`, Debug skill, marketplace-lite | **None** - operability |
| **C** | Optional OS sandbox (macOS Seatbelt / Linux bwrap), default off, fail-closed | **None** - blast radius |
| **D** | Adversary heuristics, workspace hooks, trusted folders, Docker/Podman sandbox | **None** - restrict-only fences |

Coding solve-rate is owned by evidence + verification + benchmarks - not this stack.

## Architecture (must follow)

```text
apps (vscode/cli)
  -> @mitii/host   (load .mitii/safety.json, sandbox ProcessPort wrap, marketplace-lite)
  -> @mitii/sdk    (start input: userSafetyRules)
  -> @mitii/v8     (Decision Policy: mode seals -> injection clamp -> user-rule intersect)
```

V8 owns authority. Hosts never widen grants. User rules **intersect only**.

## Phase A - Floor

### Mode seals

- **Ask** - no mutation tools / no write effect (even under pilot approvals or injection).
- **Plan** - no `run_command`, no mutation tools.
- Tests: `packages/v8/.../tests/unit/ModeSealInvariants.spec.ts`

### Preset UX (VS Code)

Setting: `mitii.safety.approvalMode` = `safe` | `guided` | `pilot` (legacy `builder` -> guided).

Copy lives in `ApprovalPresetCopy` (`@mitii/v8`) and `apps/vscode/src/approvalPolicy.ts`.

### Effective grant readout

`decision_made` events include capped `allowedTools` + `commandPrefixes`.  
CLI (`runReport`) and VS Code activity lines print them.  
Helpers: `formatEffectiveGrant` / `formatEffectiveGrantJson`.

## Phase B - Productize

### `mitii run --auto`

```bash
mitii run --auto "run tests and fix any failures"
```

Requires `--auto`. Maps to autonomy `apply`, origin `automation`, auto-approve.  
See `apps/cli/src/commands/runAuto.ts`.

### Tighten-only user rules

File: `.mitii/safety.json` (default **disabled**).

```json
{
  "enabled": false,
  "denyTools": ["delete_directory"],
  "denyCommandPrefixes": ["rm", "sudo", "git push"],
  "allowCommandPrefixes": ["pnpm", "npm", "git status"],
  "approvalCeiling": "when_required"
}
```

Semantics:

- `enabled: false` -> ignored.
- May only **remove** tools/prefixes/hosts/paths or raise approval strictness.
- **Must never** add tools Decision Policy did not grant.
- VS Code also requires `mitii.safety.userRulesEnabled: true`.
- CLI loads the file whenever `enabled: true` inside the JSON.

Intersection: `intersectUserSafetyRules` in Decision Policy (after injection clamp).

### Debug skill

Bundled skill `debug-systematic` under `packages/sdk/skills/debug-systematic/`.  
Attach with `--skill debug-systematic` or `@skill:debug-systematic`.  
This is a thin Debug playbook - **not** a fourth interaction mode.

### Marketplace-lite

Catalog only (no plugin framework): `listMarketplaceLite()` in `@mitii/host`.  
MCP still installs via Settings / `.mitii/mcp.json`; skills via bundled catalog / `.mitii/skills/`.

## Phase C - OS sandbox

| Setting / env | Default | Meaning |
|---|---|---|
| `mitii.safety.sandbox.enabled` / `MITII_SANDBOX=1` | off | Wrap `ProcessPort` |
| `mitii.safety.sandbox.network` / `MITII_SANDBOX_NETWORK` | deny | Child network |

Backends:

- macOS -> `sandbox-exec` Seatbelt profile (workspace writable, optional network deny)
- Linux -> `bwrap` if on PATH
- Optional -> Docker / Podman via `detectSandboxBackend({ prefer: "docker" | "podman" })` (Phase D)
- Windows / missing binary -> **fail-closed** (command does not run unrestricted)

Implementation: `packages/host/src/sandbox/createSandboxedProcessPort.ts`  
Wired in CLI + VS Code `ports.ts`.

Sandbox is a second fence **after** grants. It does not make "allow everything" safe inside the workspace.

## Phase D - Restrict-only fences (flags default **off**)

Phase D adds more **narrowing** layers. Nothing here widens Decision Policy grants.
Every switch defaults off until a host explicitly enables it.

### Heuristic adversary

- Host: `createHeuristicAdversary({ enabled: false })` in `@mitii/host`
- Restrict-only: may BLOCK / ASK on high-risk tools and dangerous command prefixes
- Never adds tools or raises autonomy
- Inject into SDK/V8 only when the host sets `enabled: true`

### Workspace hooks

- Specs under `.mitii/hooks/` (schema via `hookSpecSchema`)
- `loadWorkspaceHooks` / `evaluatePreToolHooks` — deny tools / command prefixes, optional audit
- Sample: `SAMPLE_PRE_TOOL_DENY_GIT_PUSH`
- Master switch `enabled` defaults **false**; absent directory → no-op

### Trusted folders (VS Code)

- When `!vscode.workspace.isTrusted`: skip project MCP sync (disabled empty settings / no connect)
- Ask-only `defaultMode` ceiling remains
- Indexing, mutating tools, MCP, and writing recipes stay gated until trust
- Notice copy lives in `apps/vscode/src/workspace/trust.ts`

### Docker / Podman sandbox

- Backend ids: `docker` | `podman` (plus existing seatbelt / bubblewrap / unavailable)
- `resolveDockerBackend("docker" | "podman")` — fail-closed if binary missing on PATH
- Wrap shape: `docker|podman run --rm -i [--network none] -v workspace:workspace -w cwd <image> <cmd…>`
- Image: `MITII_SANDBOX_IMAGE` (default `alpine:3.20`; tag `mitii-sandbox:local` for a custom image)
- `detectSandboxBackend({ prefer: "docker" | "podman" | … })` — prefer container runtimes when requested; otherwise keep OS detection
- Still requires the master sandbox flag (`mitii.safety.sandbox.enabled` / `MITII_SANDBOX=1`)

## What we deliberately did **not** ship

- Full Kilo allow/ask/deny glob permission DSL
- User rules that can widen grants
- Subagent swarms / JetBrains / FIM autocomplete / hosted Cloud Agents

## Tests to run

```bash
# V8 seals + intersect + grant formatting + presets
pnpm exec vitest run packages/v8/src/modules/decision-policy/tests/unit

# Host safety + sandbox
pnpm exec vitest run packages/host/src/safety packages/host/src/sandbox

# CLI run --auto
pnpm exec vitest run apps/cli/src/commands/runAuto.spec.ts
```

## File map

| Path | Role |
|---|---|
| `packages/v8/.../UserSafetyRules.ts` | Schema |
| `packages/v8/.../IntersectUserSafetyRules.ts` | Tighten-only intersect |
| `packages/v8/.../FormatEffectiveGrant.ts` | Readout helpers |
| `packages/v8/.../ApprovalPresetCopy.ts` | Safe/Guided/Pilot copy |
| `packages/host/src/safety/` | Load rules + marketplace-lite + heuristic adversary |
| `packages/host/src/hooks/` | Workspace session hooks (restrict-only) |
| `packages/host/src/sandbox/` | OS / container ProcessPort wrap |
| `apps/cli/src/commands/runAuto.ts` | CI entry mapping |
| `packages/sdk/skills/debug-systematic/` | Debug skill |
| `apps/acp/` | ACP-lite stdio bridge (not full ACP; V8-free of ACP) |
| `docs/SAFETY_PHASES.md` | This README |

## Contributor rules

1. Prefer golden / unit tests named `never_widens_*` for any safety change.
2. Keep new modules under **800 lines**.
3. Do not put OS-specific Seatbelt/bwrap code in V8 - hosts own `ProcessPort`.
4. Feature flags default **off** (`safety.json.enabled`, sandbox enabled, hooks enabled, adversary enabled).
