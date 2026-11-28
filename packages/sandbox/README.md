# `@mitii/sandbox`

OS process isolation for Mitii hosts. **Package** (like `@mitii/search-kit`),
not a V8 module — hosts inject `ProcessPort` + optional `SandboxLoggerPort`.

Authority stays in `ToolGrant` (v8); this package only wraps `ProcessPort` so a
permitted command still cannot freely write the host disk or open network when
policy denies it.

## Layout

```text
src/
  contracts/     policy + errors (zod)
  ports/         SandboxLoggerPort
  policy/        buildSandboxPolicy, projectGrantToOsPolicy
  process/       detect, create*ProcessPort, dispose, probe, describe
  adapters/      seatbelt | bubblewrap | docker | windows
  helpers/       env scrub, paths, fail-wrap
  lifecycle/     session container + pool
  live/          settings-latch ProcessPort
```

## Input / output

| | |
|---|---|
| **Input** | `SandboxPolicy` + backend + lifecycle + isolation profile |
| **Output** | `ProcessPort` that rewrites `argv` (scrubbed env) before `execFile` |
| **Failure** | Fail-closed: stderr `mitii sandbox fail-closed: …` |

Reason codes: `sandbox_unavailable`, `sandbox_disabled`, `backend_missing`,
`wrap_failed`, `session_unavailable`, `session_not_running`, `session_destroy_failed`.

## Stages

1. **Detect** backend (`auto` → seatbelt / bubblewrap; or docker|podman).
2. **Build policy** via `buildSandboxPolicy` (deny-read floor + optional scopes).
   Hosts that read `.mitii/safety.json` use `@mitii/host` `buildHostSandboxPolicy`.
3. **Lifecycle**: ephemeral wrap, or session container + exec.
4. **Live latch** (optional): once enabled mid-session, ignore live disable.
5. **Dispose / readiness** for session teardown and settings UI.
6. **Logger** (optional): inject `SandboxLoggerPort` — never logs secrets/env values.

## Ports / adapters

| Backend | Role |
|---|---|
| `seatbelt` | macOS `sandbox-exec` |
| `bubblewrap` | Linux `bwrap` |
| `docker` / `podman` | ephemeral `run --rm` or session create/exec |
| Windows (`auto`) | docker else podman |
| `unavailable` | fail-closed |

## Exports

`createSandboxProcessPort`, `createSandboxedProcessPort`,
`createSessionSandboxedProcessPort`, `createLiveSandboxedProcessPort`,
`disposeSandboxProcessPort`, `probeSandboxReadiness`, `describeSandboxPort`,
`buildSandboxPolicy`, `projectGrantToOsPolicy`, `detectSandboxBackend`,
`noopSandboxLogger` / `SandboxLoggerPort`, contracts and presets.

## Non-responsibilities

- Compiling or widening `ToolGrant`.
- Loading host `.mitii/safety.json` (host glue).
- File/MCP/`NetworkPort` tools that never call `ProcessPort`.
- Managed outbound proxy for selective process egress.

## Env contract

| Variable | Meaning |
|---|---|
| `MITII_SANDBOX` | `1` / `true` enables |
| `MITII_SANDBOX_NETWORK` | `allow` or deny (default) |
| `MITII_SANDBOX_BACKEND` | `auto` \| `seatbelt` \| `bubblewrap` \| `docker` \| `podman` |
| `MITII_SANDBOX_LIFECYCLE` | `ephemeral` \| `session` |
| `MITII_SANDBOX_PROFILE` | `strict` \| `balanced` \| `permissive` |
| `MITII_SANDBOX_IMAGE` | Container image |
| `MITII_SANDBOX_MEMORY` / `_CPUS` / `_PIDS_LIMIT` | Resource caps |
