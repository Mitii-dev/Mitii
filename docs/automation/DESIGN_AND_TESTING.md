# Designing automation — skills, agents, specs, and smoke tests

Use this when you add a **new unattended scenario** (post-commit cover, CI triage,
nightly health, release notes, etc.). It explains what belongs in a **skill**,
what belongs in an **agent / cron / event spec**, when to add **shell scripts**,
and how to **test the CLI automation path** without guessing.

Related:

- Skill format: [../SKILLS_FORMAT.md](../SKILLS_FORMAT.md)
- Automation overview: [README.md](./README.md)
- Ship checklist: [SHIP.md](./SHIP.md)

---

## Mental model — four layers

Mitii automation is split on purpose. Each layer has one job:

| Layer | File(s) | Answers | Loaded by |
|---|---|---|---|
| **Skill** | `SKILL.md` | *How* should the model behave for this class of work? | Skills pipeline (L1 match → L2 body) |
| **Agent** | `.mitii/agents/<id>.md` | *What* is this run asked to do right now? | CLI `--agent` / GHA `agent:` input |
| **Spec** | `.mitii/cron/*.cron.md`, `.mitii/cron/events/*.event.md` | *When* should it run unattended? | `@mitii/automation` reconcile + materializer |
| **Smoke** | `docs/automation/smoke/*.sh` | Does the **control plane** queue/match/claim correctly? | You / CI (bash) |

```text
Trigger (cron / webhook / manual)
        │
        ▼
  Event or schedule spec  ──►  prompt + mode + autonomy + workspace
        │
        ▼
  ClaimRunner + host executor  ──►  SDK agent run (origin=automation)
        │
        ▼
  Skills selected by intent/route  ──►  playbook + hard rules in prompt
        │
        ▼
  Tools (run_command, create_github_issue, …)  ──►  repo effects
```

**Rule of thumb:** put reusable *behavior* in skills; put scenario-specific
*instructions* in agents or spec bodies; put *scheduling and filters* in cron/event
frontmatter; put *deterministic plumbing checks* in `.sh` smoke scripts.

---

## Part 1 — Designing a skill

### When you need a new skill

Create or extend a skill when:

- Several agents/scenarios share the same workflow (CI cover, incident triage, release).
- You want consistent hard rules (never push main, fingerprint before filing).
- The model needs a structured planning template (Discover / Change / Verify).

Do **not** put cron expressions, webhook types, or “run every Monday” in a skill.
That belongs in a **spec**.

### Skill locations

| Where | Use for |
|---|---|
| `packages/sdk/skills/<id>/SKILL.md` | Product defaults (`cicd-agent`, `incident-triage`) |
| `<repo>/.mitii/skills/<id>/SKILL.md` | Repo-specific overrides (same `name` wins over bundled) |

See [SKILLS_FORMAT.md](../SKILLS_FORMAT.md) for the full field list.

### Design process (recommended order)

#### 1. Name the workflow

One skill = one coherent workflow. Examples:

- `cicd-agent` — tests, CI, draft PRs
- `incident-triage` — logs, fingerprint, idempotent issues

If two workflows fight for the same `conflictGroup`, split them or tune
`priority` / `when`.

#### 2. Write L1 metadata (small, always relevant)

These fields control matching and the compact injected hint:

```yaml
---
name: my-workflow
title: My Workflow
description: One sentence the model can use to decide relevance.
intents: [test, bugfix]
routes: [execute, diagnose]
tags: [ci, automation, nightly]
priority: 170
conflictGroup: verify
alwaysApply: false
enabled: true
when:
  - After a commit needs tests
  - CI failed and logs are available
instruction: Diff-first; run repo test commands; never push to main.
---
```

Keep `description`, `when`, and `instruction` **short**. They cost tokens every
time the skill is selected.

#### 3. Add a `# Planning` block (optional but useful)

Extracted in metadata mode — good for automation:

```markdown
# Planning

Discover:
- Read diff / logs / payload
- Find how this repo runs tests

Change:
- Smallest fix or test addition only when autonomy allows apply

Verify:
- Re-run failing command
- No secrets in output
```

#### 4. Write the `# Playbook` (long form, on disk)

Put checklists, example commands, ticket templates, and diagrams here. The full
body is hydrated only when the skill is selected (L2).

Reference existing skills:

- `packages/sdk/skills/cicd-agent/SKILL.md`
- `packages/sdk/skills/incident-triage/SKILL.md`

#### 5. Add hard rules (non-negotiable)

Always spell out guards the tools also enforce:

- Never push to `main` / `master`
- Prefer `create_pull_request` / `create_github_issue` over raw `gh`
- Redact secrets in tickets and comments
- Use `fingerprint` for idempotent issues

Skills **do not grant tools**. Decision Policy + autonomy still gate
`run_command`, `apply_patch`, etc.

#### 6. Optional L3 resources (`references/`, `scripts/`)

```text
.mitii/skills/incident-triage/
  SKILL.md
  references/ticket-template.md
  scripts/fetch-ci-log.sh
```

Important:

- The catalog only **advertises** these paths in the manifest.
- The model reads/runs them through normal tools (`read_file`, `run_command`).
- A skill cannot bypass ToolGrant or path scopes.

**When to add a script under a skill**

| Use skill `scripts/` | Use repo `package.json` / Makefile instead |
|---|---|
| Example repro the model should copy | Canonical test command the whole team uses |
| One-off helper tied to the playbook | Standard `npm test` / `pnpm verify` |
| Template the model may adapt | CI already documents the command |

Prefer **documenting the repo’s real command** in the playbook over hiding logic
in skill scripts. Skill scripts are hints, not a second CI system.

---

## Part 2 — Agents, cron specs, and event specs

### Agent file (`.mitii/agents/<id>.md`)

**Purpose:** scenario entry point for `mitii ask`, GHA, or copied into a spec body.

```markdown
---
name: post-commit-cover
description: After a commit, write missing tests and open a draft PR.
mode: agent
origin: automation
autonomyPreset: apply_and_pr
---

# Post-commit test coverage

Follow the `cicd-agent` skill.

1. Inspect the latest commit diff.
2. …
```

Ship examples under `docs/automation/agents/`. Consumers copy to `.mitii/agents/`.

**Agent vs skill**

| Agent | Skill |
|---|---|
| “Do this now on this trigger context” | “Whenever CI/test work, behave like this” |
| Fixed prompt for one scenario | Reusable across many prompts |
| Sets mode / autonomy / origin | Sets matching + playbook |

Agents should **reference** skills by name (`Follow cicd-agent`) instead of
duplicating full playbooks.

### Schedule spec (`.mitii/cron/*.cron.md`)

**Purpose:** run on a cron expression.

```markdown
---
name: morning-health
trigger: schedule
cron: "0 9 * * MON-FRI"
mode: ask
autonomyPreset: readonly
enabled: true
---

Run a lightweight repo health summary …
```

Reconcile: `mitii schedule reconcile` (also runs on `mitii serve` startup).

### Event spec (`.mitii/cron/events/*.event.md`)

**Purpose:** run when an external event matches.

```markdown
---
name: ci-failure-triage
trigger: event
event: github.workflow_run.completed
filter.conclusion: failure
dedupeWindowSeconds: 3600
cooldownSeconds: 300
mode: agent
autonomyPreset: apply
enabled: true
---

Triage this CI workflow failure …
```

Notes:

- Dotted keys like `filter.conclusion` are supported in frontmatter.
- Filters match event attributes and payload paths (see `packages/automation/src/events/filters.ts`).
- Ingest manually: `mitii events ingest …` or via `mitii serve --webhook-port`.

### Choosing autonomy for a scenario

| Preset | Typical scenario |
|---|---|
| `readonly` | Summaries, health checks, echo smoke |
| `propose` | Plan-only triage |
| `apply` | Fix + ticket, no PR |
| `apply_and_pr` | Tests + draft PR |

Automation runs should set `origin: automation` so Decision Policy stays
headless (no interactive clarify).

---

## Part 3 — Shell scripts (`.sh`) — what they are for

Mitii uses bash smoke scripts for **control-plane** validation, not for agent
logic.

### Smoke scripts (`docs/automation/smoke/`)

| Script | Validates |
|---|---|
| `example1-post-commit.sh` | schedule create → trigger → optional `serve --echo` |
| `example2-ci-failure.sh` | reconcile event spec → ingest → match → filter |

Conventions (follow these for new smokes):

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DB="$(mktemp "${TMPDIR:-/tmp}/mitii-my-scenario.XXXXXX").db"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/mitii-my-scenario-ws.XXXXXX")"
export MITII_AUTOMATION_DB="$DB"
trap 'rm -f "$DB"; rm -rf "$WORKDIR"' EXIT

# 1. Seed minimal workspace + .mitii/cron/…
# 2. pnpm --filter @mitii/cli build (and host/automation if needed)
# 3. Exercise CLI commands with --json
# 4. Assert on JSON fields (status, queuedRuns, filtersJson)
# 5. Optional --echo for one executor tick
```

**What smoke scripts should test**

- Spec reconcile upserts the right `specId`
- Event type + filters queue or suppress runs
- `mitii serve` claims a run (with `--echo` for cheap executor path)
- Dedupe / cooldown behavior (second ingest with same id)

**What smoke scripts should not try to prove**

- That the model wrote perfect tests (needs real provider + repo)
- That `gh issue create` ran (needs network + credentials)
- Full agent tool loops (use integration test with mocked tools or manual sandbox)

### `--echo` mode

```bash
mitii serve --echo --poll-ms 1000 --db "$DB"
```

Forces the echo LLM provider. Use it to verify **claim → execute → terminal status**
without API keys.

Echo limitations:

- `mode: agent` + `apply*` often **fails** (echo does not apply edits).
- For echo smokes, use `mode: ask` + `autonomy: readonly` **or** only test
  queue/ingress without `--echo`.

Example 1 smoke uses ask/readonly under `--echo`; Example 2 smoke validates
ingress only (no echo executor).

### Repo / GHA shell scripts

Separate from Mitii smokes:

- `.github/workflows/*.yml` — production path with real keys
- `.github/actions/mitii-run` — wraps `mitii ask --agent …`
- Consumer repo scripts (`npm test`) — what the **skill playbook** should point at

---

## Part 4 — Testing a new CLI automation scenario

Use a **layered** approach. Do not jump straight to live GitHub.

### Layer 0 — Clarify the scenario contract

Write down:

1. **Trigger** — manual, cron, or event type (+ filters)
2. **Inputs** — diff, log file, webhook payload, workspace root
3. **Outputs** — draft PR, issue + fingerprint, Slack message, report path
4. **Autonomy** — readonly vs apply vs apply_and_pr
5. **Skills** — which skill(s) should attach

### Layer 1 — Skill + agent on the CLI (interactive dev)

Fastest loop while authoring behavior:

```bash
mkdir -p .mitii/agents .mitii/skills/my-workflow

# 1. Author skill (if new)
$EDITOR .mitii/skills/my-workflow/SKILL.md

# 2. Author agent
cp docs/automation/agents/post-commit-cover.md .mitii/agents/my-scenario.md
$EDITOR .mitii/agents/my-scenario.md

# 3. Dry run with echo (no API cost)
mitii ask --agent my-scenario --echo --origin automation --autonomy readonly

# 4. Real model (sandbox repo + key)
export ANTHROPIC_API_KEY=…
mitii ask --agent my-scenario --origin automation --autonomy apply_and_pr --json
```

Checklist:

- [ ] Correct skill appears in run (report / JSON / logs)
- [ ] Hard rules respected (no main push, draft PR, fingerprint)
- [ ] Exit code sensible (`0` done, `4` clarify gap for unattended)

Disable workspace skills to test bundled only:

```bash
MITII_DISABLE_WORKSPACE_SKILLS=1 mitii ask --agent my-scenario --echo "…"
```

### Layer 2 — Spec + control plane (no model)

Convert the scenario to unattended form:

```bash
# Schedule
mitii schedule create "my-job" \
  --cron "0 6 * * *" \
  --prompt "$(cat .mitii/agents/my-scenario.md)" \
  --workspace . \
  --mode agent \
  --autonomy apply

mitii schedule list --json
mitii schedule trigger <specId> --json
```

Or file-based:

```bash
mkdir -p .mitii/cron/events
cp docs/automation/cron/events/ci-failure.event.md .mitii/cron/events/
mitii schedule reconcile --json
```

Add **unit tests** when you introduce new matching logic:

- `packages/automation/src/tests/automation.spec.ts` — ingress, filters, dedupe
- `packages/automation` — `pnpm --filter @mitii/automation test`

### Layer 3 — Smoke script (regression gate)

Add `docs/automation/smoke/my-scenario.sh`:

1. Temp DB + temp workspace
2. Copy your event/cron spec into `$WORKDIR/.mitii/cron/…`
3. Run reconcile + ingest/trigger
4. Assert JSON outcomes
5. Document in [SHIP.md](./SHIP.md) checklist

Run locally:

```bash
chmod +x docs/automation/smoke/my-scenario.sh
./docs/automation/smoke/my-scenario.sh
./docs/automation/smoke/my-scenario.sh --echo   # only if ask/readonly
```

### Layer 4 — `mitii serve` / daemon

```bash
export MITII_AUTOMATION_DB=~/.mitii/automation/dev.db
mitii serve --echo --poll-ms 2000 --webhook-port 8787
# or: node apps/daemon/dist/main.js --cwd . --echo
```

Verify:

- Reconcile picks up `.mitii/cron/**/*.md`
- Claim loop runs queued jobs
- Webhook HMAC if using GitHub (`--github-webhook-secret`)

### Layer 5 — Sandbox repo + real provider

Same as production but isolated:

1. Copy agents + event specs into a throwaway GitHub repo
2. Set provider secret + `GITHUB_TOKEN`
3. Force the trigger (push commit, fail CI, or `mitii events ingest`)
4. Confirm real issue/PR/check/comment

### Layer 6 — GitHub Actions

Copy workflow examples from `.github/workflows/mitii-*.yml` and enable on the
consumer repo. GHA is the last mile, not the first debug surface.

---

## Part 5 — Worked example: adding “nightly dependency audit”

### 1. Skill (if not covered by an existing one)

`packages/sdk/skills/security-and-hardening/` may already match. If not, add
`.mitii/skills/deps-audit/SKILL.md` with `routes: [diagnose, execute]`, short
`instruction`, and a playbook that runs the repo’s audit command (`npm audit`,
`pnpm audit`, etc.).

### 2. Agent

`.mitii/agents/nightly-deps.md`:

```markdown
---
name: nightly-deps
mode: agent
origin: automation
autonomyPreset: apply
---

Audit dependencies per security-and-hardening. Open an issue if critical CVEs
found; use create_github_issue with a fingerprint derived from advisory ids.
```

### 3. Schedule spec

`.mitii/cron/nightly-deps.cron.md`:

```markdown
---
name: nightly-deps
trigger: schedule
cron: "0 3 * * *"
mode: agent
autonomyPreset: apply
enabled: true
---

Run the nightly dependency audit agent prompt …
```

### 4. Tests

| Layer | Command / artifact |
|---|---|
| Unit | filter/dedupe tests if new event filters added |
| Smoke | `docs/automation/smoke/nightly-deps.sh` — reconcile + trigger + queue |
| Echo | `mitii serve --echo` with `mode: ask` variant of prompt |
| Live | manual run on sandbox repo |
| GHA | optional workflow calling `mitii ask --agent nightly-deps` |

---

## Quick reference — file picker

| I need to… | Create / edit |
|---|---|
| Change how CI/incident work is done in general | `SKILL.md` (bundled or `.mitii/skills/`) |
| Define a one-off scenario prompt | `.mitii/agents/<id>.md` |
| Run on a schedule | `.mitii/cron/<name>.cron.md` |
| Run on GitHub webhook / ingest | `.mitii/cron/events/<name>.event.md` |
| Assert queue/match/reconcile | `docs/automation/smoke/<name>.sh` |
| Assert domain logic (filters, redaction) | `packages/automation/src/tests/*.spec.ts` |
| Ship to production CI | `.github/workflows/` + `.mitii/agents/` in consumer repo |

---

## Anti-patterns

| Avoid | Do instead |
|---|---|
| Huge `instruction` / `when` arrays | Short metadata + `# Playbook` body |
| Cron/event rules inside skills | Event spec frontmatter |
| Smoke script that calls live `gh` | Assert `mitii events ingest --json` |
| `mode: agent` + `--echo` expecting success | `ask`/`readonly` for echo, or skip echo |
| Duplicating `cicd-agent` in every agent | `Follow the cicd-agent skill` one-liner |
| Skill script as hidden test runner | Document repo’s canonical test command |

---

## See also

- [SKILLS_FORMAT.md](../SKILLS_FORMAT.md) — frontmatter fields, L1/L2/L3
- [packages/sdk/skills/ENGINEERING_PACK.md](../../packages/sdk/skills/ENGINEERING_PACK.md) — bundled skill index
- [ARCHITECTURE.md](../../packages/automation/ARCHITECTURE.md) — automation vs host boundary
- [SHIP.md](./SHIP.md) — release checklist for Examples 1 & 2
