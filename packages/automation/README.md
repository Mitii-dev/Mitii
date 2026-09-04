# `@mitii/automation`

Mitii **automation control plane** (Phase 1): schedules, SQLite run queue,
cron materialization, and a single claim/lease runner.

Agent execution is **not** in this package. Hosts inject
`AutomationRunExecutor` (see `@mitii/host`).

## Install

Workspace package — used by `@mitii/cli` and `@mitii/daemon`.

## Quick use

```ts
import { AutomationService } from '@mitii/automation';

const service = new AutomationService({ dbPath: '/tmp/mitii-auto.db' });
service.createSchedule({
  name: 'Morning health',
  cron: '0 9 * * MON-FRI',
  prompt: 'Summarize open PRs',
  workspaceRoot: '/path/to/repo',
  autonomyPreset: 'readonly',
  mode: 'ask',
});
service.close();
```

With an executor:

```ts
const service = new AutomationService({
  dbPath,
  executor: hostExecutor,
});
service.start({ workspaceRoot: '/path/to/repo' });
```

## Layout

See [ARCHITECTURE.md](./ARCHITECTURE.md).

## License

AGPL-3.0-or-later
