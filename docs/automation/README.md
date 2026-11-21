# Mitii Automation

Control plane for unattended Mitii runs: CLI/CI workers, local schedules, event
ingress (including GitHub), delivery adapters, and incident evidence packs.

Package architecture: [`packages/automation/ARCHITECTURE.md`](../../packages/automation/ARCHITECTURE.md).
Agent examples: [`agents/`](./agents/). Workflow examples: [`../examples/workflows/`](../examples/workflows/).

## Capability map

| Surface | Capability |
|---|---|
| SDK | `origin`, `autonomyPreset`, `correlation` on `MitiiStartInput` |
| V8 Decision Policy | `automation` / `api` suppress interactive clarify |
| CLI | `--origin`, `--autonomy`, `--agent`, `--prompt-file`; exit `4` on unattended clarify gap |
| Skills | `cicd-agent`, `incident-triage`, `code-review-and-quality` |
| Agents | Example markdown under `docs/automation/agents/` |
| GHA | `.github/actions/mitii-run` + example workflows under `docs/examples/workflows/` |
| Review CLI | `mitii review --preview|--format sarif` + `scripts/github-actions/post-mitii-review-comments.js` |

## Quick start (local)

```bash
mkdir -p .mitii/agents
cp docs/automation/agents/post-commit-cover.md .mitii/agents/

export ANTHROPIC_API_KEY=...
mitii ask --agent post-commit-cover --json \
  --origin automation --autonomy apply_and_pr
```

## Autonomy presets

| Preset | Mode | Approvals |
|---|---|---|
| `readonly` | ask | never |
| `propose` | plan | never |
| `apply` | agent | never (headless) |
| `apply_and_pr` | agent | never (PR via `gh` / skills) |

Explicit `--mode` / `--approve` / `--deny` override preset defaults where set.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Completed (or non-clarify JSON suspend checkpoint) |
| 1 | Failed / declined |
| 2 | Usage / config |
| 4 | Unattended run still needs clarification |
| 130 | Cancelled |

## GitHub Actions

1. Store provider API key as a repo secret.
2. Copy an example workflow from `docs/examples/workflows/`.
3. Ensure `.mitii/agents/*.md` exists in the consumer repo.
4. Grant `contents: write`, `pull-requests: write`, and/or `issues: write`.

```yaml
- uses: ./.github/actions/mitii-run
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  with:
    agent: post-commit-cover
    origin: automation
    autonomy: apply_and_pr
```

## Schedules and daemon

```bash
mitii schedule create "morning" --cron "0 9 * * *" --prompt "Health check" --workspace .
mitii schedule list
mitii schedule trigger <specId>
mitii serve --echo
```

- `@mitii/automation` — SQLite specs/runs, materializer, claim/lease runner
- File specs: `.mitii/cron/*.cron.md` (examples under [`cron/`](./cron/))

## Events and delivery

```bash
mitii events ingest --type github.workflow_run.completed --source github --json-file ./payload.json
mitii serve --webhook-port 8787
```

Delivery adapters: `webhook`, `slack`, `discord`, `telegram`, `github_comment`, `github_check`
(senders in `@mitii/host`).
