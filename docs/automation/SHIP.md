# Shipping Mitii Automation — E2E loops

Control-plane scaffolding (Phases 0–6) is in tree. **Ship** means these two
loops work on a real repo.

**How to design skills, agents, specs, and smoke tests for new scenarios:**
[DESIGN_AND_TESTING.md](./DESIGN_AND_TESTING.md)

## Example 1 — post-commit → tests → draft PR

### Via GitHub Actions (recommended)

1. Copy agents into the consumer repo:
   ```bash
   mkdir -p .mitii/agents
   cp docs/automation/agents/post-commit-cover.md .mitii/agents/
   ```
2. Enable `.github/workflows/mitii-post-commit-cover.yml` (or copy it).
3. Set secret `ANTHROPIC_API_KEY` (or other provider).
4. Push a commit that changes behavior without tests → workflow opens a draft PR.

### Via local daemon + webhook

```bash
mkdir -p .mitii/cron/events
cp docs/automation/cron/events/post-commit.event.md .mitii/cron/events/

export MITII_GITHUB_WEBHOOK_SECRET=…
mitii serve --webhook-port 8787 --github-webhook-secret "$MITII_GITHUB_WEBHOOK_SECRET"
# Point GitHub repo webhook → https://<host>:8787/hooks/github (push events)
```

### Smoke (no live model)

```bash
./docs/automation/smoke/example1-post-commit.sh --echo
```

## Example 2 — CI fail → evidence → ticket

### Via GitHub Actions

1. Copy `docs/automation/agents/incident-from-logs.md` → `.mitii/agents/`.
2. Enable `.github/workflows/mitii-ci-failure-triage.yml` (expects a workflow named `CI`).
3. On a failed CI run, Mitii opens/updates an issue with fingerprint title
   `[mitii:<fingerprint>]` via `create_github_issue`.

### Via local daemon

```bash
mkdir -p .mitii/cron/events
cp docs/automation/cron/events/ci-failure.event.md .mitii/cron/events/

export MITII_GITHUB_WEBHOOK_SECRET=…
mitii serve --webhook-port 8787 --github-webhook-secret "$MITII_GITHUB_WEBHOOK_SECRET"
# Webhook: workflow_run events → /hooks/github
```

### Smoke

```bash
./docs/automation/smoke/example2-ci-failure.sh --echo
```

## Safety (shipped)

| Guard | Where |
|---|---|
| Draft PRs by default; refuse head=`main`/`master` | `create_pull_request` |
| Refuse ambiguous / protected `git push` | `run_command` |
| Idempotent issues via `fingerprint` | `create_github_issue` |
| Secret redaction in evidence + delivery + issue bodies | `@mitii/automation` / tools |
| GitHub webhook HMAC (`X-Hub-Signature-256`) | `mitii serve --github-webhook-secret` |

## Release checklist

- [x] `pnpm --filter @mitii/automation test` green
- [x] `pnpm --filter @mitii/cli build` + `pnpm --filter @mitii/daemon build`
- [x] Smoke scripts pass with `--echo` (example1) / ingress filter (example2)
- [ ] Example 1 green on a sandbox repo with a real provider key
- [ ] Example 2 opens a fingerprint-stable issue on a forced CI failure
- [ ] Tag / publish `@mitii/cli` + `@mitii/automation` (and daemon) together
