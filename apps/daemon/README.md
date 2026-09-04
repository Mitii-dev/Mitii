# `@mitii/daemon`

Long-lived Mitii automation process (Phase 1).

```bash
mitii-daemon --cwd /path/to/repo
# equivalent:
mitii serve --cwd /path/to/repo
```

Uses `@mitii/automation` (queue) + `@mitii/host` (SDK executor). Does not import `apps/cli`.

See `packages/automation/ARCHITECTURE.md`.
