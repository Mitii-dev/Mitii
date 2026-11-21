# Mitii safety

How Mitii keeps authority in Decision Policy and adds host-side fences that
may only **narrow** grants. Coding solve-rate is owned by evidence, verification,
and benchmarks — not this stack.

Audience: contributors and hosts (VS Code / CLI / Desktop).

## Architecture

```text
apps (vscode / cli / desktop)
  → @mitii/host   (.mitii/safety.json, sandbox ProcessPort, marketplace-lite)
  → @mitii/sdk    (start input: userSafetyRules)
  → @mitii/v8     (mode seals → injection clamp → user-rule intersect)
```

V8 owns authority. Hosts never widen grants. User rules **intersect only**.

## Mode seals

- **Ask** — no mutation tools / no write effect (even under pilot approvals or injection).
- **Plan** — no `run_command`, no mutation tools.
- Tests: `packages/v8/.../tests/unit/ModeSealInvariants.spec.ts`

## Approval presets (VS Code)

Setting: `mitii.safety.approvalMode` = `safe` | `guided` | `pilot`
(legacy `builder` → guided).

Copy: `ApprovalPresetCopy` (`@mitii/v8`) and `apps/vscode/src/approvalPolicy.ts`.

## Effective grant readout

`decision_made` events include capped `allowedTools` + `commandPrefixes`.
CLI (`runReport`) and VS Code activity lines print them via
`formatEffectiveGrant` / `formatEffectiveGrantJson`.

## Unattended runs

```bash
mitii run --auto "run tests and fix any failures"
```

Requires `--auto`. Maps to autonomy `apply`, origin `automation`, auto-approve.
See `apps/cli/src/commands/runAuto.ts`.

## Tighten-only user rules

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

- `enabled: false` → ignored.
- May only **remove** tools/prefixes/hosts/paths or raise approval strictness.
- **Must never** add tools Decision Policy did not grant.
- VS Code also requires `mitii.safety.userRulesEnabled: true`.
- CLI loads the file whenever `enabled: true` inside the JSON.

Intersection: `intersectUserSafetyRules` in Decision Policy (after injection clamp).

## Debug skill

Bundled skill `debug-systematic` under `packages/sdk/skills/debug-systematic/`.
Attach with `--skill debug-systematic` or `@skill:debug-systematic`.
This is a playbook — not a fourth interaction mode.

## Marketplace-lite

Catalog only (no plugin framework): `listMarketplaceLite()` in `@mitii/host`.
MCP installs via Settings / `.mitii/mcp.json`; skills via bundled catalog /
`.mitii/skills/`.

## OS / container sandbox

| Setting / env | Default | Meaning |
|---|---|---|
| `mitii.safety.sandbox.enabled` / `MITII_SANDBOX=1` | off | Wrap `ProcessPort` |
| `mitii.safety.sandbox.network` / `MITII_SANDBOX_NETWORK` | deny | Child network |

Backends:

- macOS → `sandbox-exec` Seatbelt (workspace writable, optional network deny)
- Linux → `bwrap` if on PATH
- Optional → Docker / Podman via `detectSandboxBackend({ prefer: "docker" \| "podman" })`
- Windows / missing binary → **fail-closed** (command does not run unrestricted)

Implementation: `packages/host/src/sandbox/createSandboxedProcessPort.ts`
(wired in CLI + VS Code `ports.ts`).

Sandbox is a second fence **after** grants. It does not make “allow everything”
safe inside the workspace.

### Docker / Podman

- `resolveDockerBackend("docker" | "podman")` — fail-closed if binary missing
- Wrap: `docker|podman run --rm -i [--network none] -v workspace:workspace -w cwd <image> <cmd…>`
- Image: `MITII_SANDBOX_IMAGE` (default `alpine:3.20`)
- Still requires the master sandbox flag

## Restrict-only fences (default off)

Nothing here widens Decision Policy grants.

### Heuristic adversary

- Host: `createHeuristicAdversary({ enabled: false })` in `@mitii/host`
- May BLOCK / ASK on high-risk tools and dangerous command prefixes
- Never adds tools or raises autonomy

### Workspace hooks

- Specs under `.mitii/hooks/` (`hookSpecSchema`)
- `loadWorkspaceHooks` / `evaluatePreToolHooks` — deny tools / prefixes, optional audit
- Sample: `SAMPLE_PRE_TOOL_DENY_GIT_PUSH`
- Master switch `enabled` defaults **false**; absent directory → no-op

### Trusted folders (VS Code)

- When `!vscode.workspace.isTrusted`: skip project MCP sync
- Ask-only `defaultMode` ceiling; indexing / mutating tools / MCP gated until trust
- Notice copy: `apps/vscode/src/workspace/trust.ts`

## Deliberately not shipped

- A second allow/ask/deny glob permission engine beside Decision Policy
- User rules that can widen grants
- Subagent swarms as a safety mechanism

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/decision-policy/tests/unit
pnpm exec vitest run packages/host/src/safety packages/host/src/sandbox
pnpm exec vitest run apps/cli/src/commands/runAuto.spec.ts
```

## File map

| Path | Role |
|---|---|
| `packages/v8/.../UserSafetyRules.ts` | Schema |
| `packages/v8/.../IntersectUserSafetyRules.ts` | Tighten-only intersect |
| `packages/v8/.../FormatEffectiveGrant.ts` | Readout helpers |
| `packages/v8/.../ApprovalPresetCopy.ts` | Safe/Guided/Pilot copy |
| `packages/host/src/safety/` | Load rules + marketplace-lite + adversary |
| `packages/host/src/hooks/` | Workspace session hooks |
| `packages/host/src/sandbox/` | OS / container ProcessPort wrap |
| `apps/cli/src/commands/runAuto.ts` | CI entry mapping |
| `packages/sdk/skills/debug-systematic/` | Debug skill |

## Contributor rules

1. Prefer tests named `never_widens_*` for any safety change.
2. Keep new modules under **600 lines** (repo standard).
3. Do not put OS-specific Seatbelt/bwrap code in V8 — hosts own `ProcessPort`.
4. Feature flags default **off** (`safety.json.enabled`, sandbox, hooks, adversary).
