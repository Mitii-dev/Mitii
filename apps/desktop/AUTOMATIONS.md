# Desktop Automations

Local flows that run Mitii agents the same way chat does.

**UX (Desktop → Automations):**

| Tab | What lives here |
|---|---|
| **Flows** | Flow tiles. Open one to edit. |
| **Runs** | Execution log (status, timeline, report) |

Canvas modules:

| Module | Role |
|---|---|
| Trigger | Run now |
| On commit | `git.commit.local` |
| Command | argv + timeout; output passed to the agent |
| Agent | Mode, message, profile, repository, context, MCP, skills, recipes |

MCP, skills, and recipes are **attached** from catalogs already configured in Desktop. They are not set up on this screen.

Specs on disk (same as CLI / daemon):

| File | Trigger |
|---|---|
| `.mitii/cron/<id>.cron.md` | Manual / cron |
| `.mitii/cron/events/<id>.event.md` | Events (`git.commit.local`, …) |

## Architecture (contracts)

```text
Renderer (canvas + inspector + run log)
        │  HTTP mitii-desktop/v1
        ▼
Desktop engine
        ├── @mitii/automation  (queue, reconcile, claim/lease)
        └── @mitii/host        (agent executor)
```

Follows [`docs/REPO_LAYOUT.md`](../../docs/REPO_LAYOUT.md):

- `apps/desktop` does **not** import `apps/cli` or `apps/daemon`
- `@mitii/automation` stays free of SDK/host imports
- Hosts **inject** `createAutomationRunExecutor`

```text
Trigger → Command* → Agent
```

Command output and agent attachments are appended to the agent message before `@mitii/host` starts the run.

## Flow schema

`mitii.automation.flow/v1` (`src/shared/automations/flow.ts`)

- Layout + mapping + **steps** persist in frontmatter `metadata.desktopFlow`
- Delivery targets persist in `metadata.delivery` (ClaimRunner / DeliveryBus)
- Serialize via `@mitii/automation` `serializeCronMarkdown` (shared with reconcile)
- UI: `src/renderer/automations/` · host: `src/engine/automations/` · map: [`src/STRUCTURE.md`](./src/STRUCTURE.md)

### Deterministic step kinds

| Kind | Behavior |
|---|---|
| `index` | `reindexWorkspace` via `@mitii/host` |
| `review` | Collect git status/diff; append review briefing to prompt |
| `command` | Argv-only spawn (no shell); blocked dangerous heads; optional fail-fast |
| `recipe` | Attach recipe id into agent context |
| `mcp` | Prefer named MCP server/tool in the run |
| `hook` | Note workspace hook kind (post-commit / pre-push / custom) |

## Engine HTTP surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/automations` | List specs, runs, runner status, stats |
| GET | `/v1/automations/flow/:specId` | Load flow document |
| POST | `/v1/automations/flow` | Save flow → write markdown + reconcile |
| GET | `/v1/automations/templates` | Built-in templates |
| POST | `/v1/automations/templates/apply` | Materialize template into workspace |
| POST | `/v1/automations/runner/start` | Start claim runner (+ optional webhook) |
| POST | `/v1/automations/runner/stop` | Stop runner |
| GET | `/v1/automations/runs/:runId` | Run inspector (timeline, report, deliveries) |
| GET | `/v1/automations/events` | Recent ingress event log |
| GET | `/v1/automations/connections` | Activated module connections |
| POST | `/v1/automations/connections/activate` | Save secrets + mark connection active |
| POST | `/v1/automations/connections/deactivate` | Deactivate connection |
| POST | `/v1/automations/trigger` \| `pause` \| `resume` \| `delete` | Spec ops |
| POST | `/v1/automations/events/ingest` | Manual / local event envelope |
| GET/POST | `/v1/automations/export` \| `import` | Portable JSON |

## Connections + runner

**Connections** tab (not the Flows home) holds:

- Module activation (GitHub HMAC, Slack token, …)
- Port (default `8787`)
- Optional bearer token (`Authorization` / `X-Mitii-Token`)
- GitHub HMAC secret (`X-Hub-Signature-256`)
- Local git post-commit hook

On start, Desktop embeds the same loop as `mitii serve` / `mitii-daemon` and exposes:

- `GET /health`
- `POST /events`
- `POST /hooks/github`

Copy the GitHub URL into the repository webhook settings (JSON, push / workflow_run / pull_request).

## Run inspector

Click a recent run to open the log:

- Timeline (queued → started → completed / delivery)
- Trigger event payload
- Delivery attempts
- Full report markdown (includes deterministic step results)

## Local on-commit

After a successful `POST /v1/git/commit`, the engine best-effort ingests:

```json
{ "eventType": "git.commit.local", "source": "desktop", "payload": { "message": "…" } }
```

Apply the **Local commit review** template (or any `event: git.commit.local` spec) and keep the runner started.

## Templates

| Id | Category |
|---|---|
| `morning-health` | schedule |
| `post-commit-cover` | git (GitHub push) |
| `ci-failure-triage` | ci |
| `local-commit-review` | git (local) |

## Export / import / cancel / local hooks

- **Export / Import** buttons download or restore portable JSON (`exportSpecs` / `importSpecs`)
- **Cancel run** from the run inspector (queued or running)
- **Local git hook**: installs Mitii-managed `.git/hooks/post-commit` that emits
  `git.commit.local` to the runner `/events` URL, or queues
  `.mitii/hooks/pending/*.json` when the runner is offline (drained on poll)
- **Runner prefs**: `.mitii/desktop-runner.json` + secrets file (do not commit secrets)

## Mapping preview

Agent inspector includes a sample JSON payload editor and live resolved-prompt
preview (`applyPromptMapping`) for template variables.

## Safety

Unattended runs use `origin: automation` and autonomy presets (`readonly` → `apply_and_pr`). Decision Policy, draft-PR defaults, and secret redaction remain in host/tools — the canvas never bypasses them.

## Dev

```bash
pnpm --filter @mitii/automation test
pnpm --filter @mitii/desktop test
pnpm --filter @mitii/desktop typecheck
pnpm --filter @mitii/desktop dev
```

Open **Automations** in the activity rail → New flow / Templates → Save → Start runner.
