# @mitii/automation — Architecture

Status: Phases 1–6 control plane (schedules, events, delivery, incident evidence)  
Depends on: `better-sqlite3`, `zod`  
Must **not** depend on: `@mitii/v8`, `@mitii/sdk`, `@mitii/host`, apps

## Purpose

Own the **automation control plane**: specs, runs, cron materialization,
event ingress/match/dedupe, claim/lease execution queue, file-based specs,
webhook HTTP surface, artifact + evidence packs, and delivery queue.

Agent **execution** and **chat/GitHub delivery senders** are injected from
`@mitii/host` (`AutomationRunExecutor`, `DeliverySender`).

## Dependency graph

```text
apps/cli ──┐
apps/daemon ──┼──► @mitii/host ──► @mitii/sdk ──► @mitii/v8
apps/vscode ──┤         │
              │         ├── createAutomationRunExecutor
              │         └── createCompositeDeliverySender
              └──► @mitii/automation
```

Forbidden:

- `@mitii/automation` → sdk | host | v8 | apps
- `@mitii/v8` → automation
- `@mitii/sdk` → automation

## Module layout

```text
src/
  cron/ store/ materializer.ts runner/ specs/
  events/ webhook/ artifacts/
  delivery/          # queue + webhook sender port
  incident/          # CI log pull + evidence packs + fingerprints
  service.ts
```

## Phases

| Phase | Capability |
|---|---|
| 0 | origin / autonomy / GHA / skills (SDK+CLI) |
| 1 | schedules + claim runner + `mitii serve` |
| 2 | events + GitHub webhooks + issue/PR tools |
| 3 | delivery bus (webhook/slack/discord/telegram/github_*) |
| 4 | incident evidence + CI log pull + ticket templates |
| 5 | VS Code Automations panel + export/import |
| 6 | lease/delivery/multi-DB hardening tests |

## Safety defaults

- Runs: `origin: automation`, autonomy `apply`
- PRs: draft by default; refuse head `main`/`master`
- Delivery: retries with `maxAttempts`; secrets via env / metadata.token
- Incident titles: `[mitii:<fingerprint>]` for idempotent search
