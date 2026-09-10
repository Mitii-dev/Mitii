# Mitii repository layout

Current product package boundaries. Canonical V8 architecture: [`packages/v8/ARCHITECTURE.md`](../packages/v8/ARCHITECTURE.md).

## Dependency graph

```text
apps/vscode --+
apps/cli    --+--> packages/host --> packages/sdk --> packages/v8
apps/daemon --+         |
                        `--> packages/automation
tests/* ---------------/
```

**Forbidden**

- `packages/v8` -> apps, sdk, host, automation
- `packages/sdk` -> apps, host, automation
- `packages/host` -> apps
- product packages -> `tests/*`

Hosts and tests prefer `@mitii/sdk` over importing V8 internals.

## Tree

```text
mitii/
|-- package.json              # private workspace orchestrator
|-- pnpm-workspace.yaml
|-- .vscode/                  # F5 -> apps/vscode
|-- packages/
|   |-- v8/                   # @mitii/v8
|   |-- sdk/                  # @mitii/sdk (+ bundled skills/)
|   |-- host/                 # @mitii/host
|   `-- automation/           # @mitii/automation
|-- apps/
|   |-- vscode/               # VS Code extension (VSIX)
|   |-- cli/                  # @mitii/cli (`mitii`)
|   `-- daemon/               # @mitii/daemon
|-- tests/
|   `-- benchmark/            # @mitii/solid-benchmark
|-- docs/
|-- scripts/
`-- tools/                    # policy-admin, log-viewer (dev UX)
```

## Publish units

| Package / app | Name | Notes |
|---|---|---|
| V8 | `@mitii/v8` | Runtime |
| SDK | `@mitii/sdk` | Public API; ships `skills/` |
| Host | `@mitii/host` | Indexing, ports, recipes, skills catalog |
| Automation | `@mitii/automation` | Schedules / claim runner |
| CLI | `@mitii/cli` | `mitii` bin |
| Daemon | `@mitii/daemon` | Long-lived serve |
| VS Code | `mitii-ai-agent` | VSIX / Marketplace |
| Benchmark | `@mitii/solid-benchmark` | `tests/benchmark` |
| Root | private | Never published |

## Skills

Bundled playbooks live in `packages/sdk/skills/<id>/SKILL.md`. Format: [`docs/SKILLS_FORMAT.md`](SKILLS_FORMAT.md).

Writing recipes (force-attach + git context) are defined in `@mitii/host` and used by VS Code SCM helpers and CLI (`commit-message`, `pr-summary`, `changelog`). See [`apps/cli/README.md`](../apps/cli/README.md) and [`apps/vscode/README.md`](../apps/vscode/README.md).

## Related

- [`docs/INITIAL_LAUNCH.md`](INITIAL_LAUNCH.md) - F5 / first launch
- [`docs/TESTS.md`](TESTS.md) - tests + benchmark
- [`docs/RELEASE.md`](RELEASE.md) - publish gates
- [`docs/SAFETY_PHASES.md`](SAFETY_PHASES.md) - safety / sandbox
- [`docs/automation/README.md`](automation/README.md) - unattended agents
