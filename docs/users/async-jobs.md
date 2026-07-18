# Async Jobs and Local Workers

Mitii includes a small local job queue for long-running work you want to leave running on your own machine. It is an honest alternative to cloud agents: jobs run in the workspace, use your configured provider, write logs/results under `.mitii/jobs/`, and stop when the machine, terminal, or worker process stops.

## Queue a Job

```bash
mitii job enqueue "Refactor the billing tests and run the focused test suite" --mode agent
mitii job list
```

Modes match the normal CLI modes: `ask`, `plan`, `agent`, and `review`.

## Run a Worker

```bash
mitii worker --interval-ms 5000 --lease-ms 1800000 --max-jobs 10
```

Useful overnight pattern:

```bash
mitii job enqueue "Audit docs links and fix broken internal references" --mode agent
mitii job enqueue "Plan the checkout service migration with risks and tests" --mode plan
mitii worker --max-jobs 2 --lease-ms 3600000
```

The worker leases one queued job at a time. If it exits mid-job, the lease expires and a later worker can pick the job up again. Completed job output is written to `.mitii/jobs/completed/<job-id>.md`.

## Inspect and Recover

```bash
mitii job show <job-id>
mitii job retry <job-id>
mitii job cancel <job-id>
mitii worker --once
```

Use `--json` on queue and worker commands when scripting from `launchd`, `systemd`, GitHub webhooks, or another local supervisor.

## What This Is Not

Local workers do not provide hosted compute, remote wake-up, or guaranteed completion after your laptop sleeps. They are best for:

- Running a queue while you keep a terminal, tmux session, or service manager alive.
- Preserving local-first source, index, memory, and audit boundaries.
- Avoiding a cloud agent for teams that require code to stay on developer machines.

For production unattended use, run the worker under a local supervisor and keep provider/API credentials in the normal Mitii configuration path.
