# Mitii Automation

Control plane for unattended Mitii runs: origin/autonomy (Phase 0), local
schedules + claim runner (Phase 1), and event ingress / GitHub (Phase 2).

**Design & test new scenarios:** [DESIGN_AND_TESTING.md](./DESIGN_AND_TESTING.md)

## Phase 0 — worker + CI wrappers

Use GitHub Actions or system cron calling the CLI when you do not need a local
daemon.

## What landed

| Surface | Capability |
|---|---|
| SDK | `origin`, `autonomyPreset`, `correlation` on `MitiiStartInput` |
| V8 Decision Policy | `automation` / `api` suppress interactive clarify |
| CLI | `--origin`, `--autonomy`, `--agent`, `--prompt-file`; exit `4` on unattended clarify gap |
| Skills | `cicd-agent`, `incident-triage` |
| Agents | Example markdown under `docs/automation/agents/` |
| GHA | `.github/actions/mitii-run` + post-commit / CI-fail workflow examples |

## Quick start (local)

```bash
# Copy an agent into the workspace
mkdir -p .mitii/agents
cp docs/automation/agents/post-commit-cover.md .mitii/agents/

export ANTHROPIC_API_KEY=…
mitii ask --agent post-commit-cover --json \
  --origin automation --autonomy apply_and_pr
```

```bash
# Incident from a log file
mitii ask --agent incident-from-logs \
  --prompt-file /tmp/error.log \
  --origin automation --autonomy apply --json
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

1. Store `ANTHROPIC_API_KEY` (or other provider key) as a repo secret.
2. Enable example workflows or copy them into your app repo.
3. Ensure `.mitii/agents/*.md` exists in the consumer repo.
4. Grant `contents: write`, `pull-requests: write`, and/or `issues: write`.

Composite action:

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

## Example 1 — post-commit cover

See `.github/workflows/mitii-post-commit-cover.yml` and
`docs/automation/agents/post-commit-cover.md`.

**Ship guide:** [SHIP.md](./SHIP.md) · smoke: `docs/automation/smoke/example1-post-commit.sh`

## Example 2 — CI failure → ticket

See `.github/workflows/mitii-ci-failure-triage.yml` and
`docs/automation/agents/incident-from-logs.md`.

**Ship guide:** [SHIP.md](./SHIP.md) · smoke: `docs/automation/smoke/example2-ci-failure.sh`

## Phase 1 — schedules + daemon (landed)

```bash
mitii schedule create "morning" --cron "0 9 * * *" --prompt "Health check" --workspace .
mitii schedule list
mitii schedule trigger <specId>
mitii serve --echo          # local smoke; omit --echo for real provider
# or: mitii-daemon
```

- `@mitii/automation` — SQLite specs/runs, materializer, claim/lease runner
- File specs: `.mitii/cron/*.cron.md`
- Architecture: [packages/automation/ARCHITECTURE.md](../../packages/automation/ARCHITECTURE.md)

## Phase 2 — events + GitHub (landed)

```bash
mitii events ingest --type github.workflow_run.completed --source github --json-file ./payload.json
mitii events list
mitii serve --webhook-port 8787   # POST /hooks/github , POST /events , GET /health
```

- Event specs: `.mitii/cron/events/*.event.md`
- Tools: `create_github_issue`, `create_pull_request` (via `gh`)

## Phase 3 — delivery bus (landed)

Spec metadata:

```json
{ "delivery": [{ "adapter": "slack", "target": "C0123" }] }
```

Adapters: `webhook`, `slack`, `discord`, `telegram`, `github_comment`, `github_check`.  
Senders live in `@mitii/host` (`createCompositeDeliverySender`); tokens from env.

## Phase 4 — incident evidence (landed)

On CI failure events, ClaimRunner pulls `gh run view --log` when possible and
writes an evidence pack under `~/.mitii/automation/artifacts/<runId>/` with a
stable `[mitii:<fingerprint>]` issue title hint.

## Phase 5 — VS Code + export (landed)

- Automations panel in the VS Code sidebar (list / trigger / pause / resume)
- `mitii schedule export` / `mitii schedule import`

## Phase 6 — hardening (landed)

Lease reclaim, delivery retries, multi-DB isolation, and export/import covered
by `@mitii/automation` unit tests.
