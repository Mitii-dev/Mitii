# Parallel Agents

Phase 2 adds two delegation patterns.

| Pattern | Use when |
| --- | --- |
| Subagents | Research, review, verification, or tightly scoped implementation in the current branch |
| Worktrees | Independent tasks that should run in isolated branches |
| Daemon + board clients | Multiple clients need to attach to the same runtime |
| Async jobs | Overnight or background local work handled by `mitii worker` |

Create tasks:

```bash
mitii task add "Fix auth tests" --prompt "Fix the failing auth tests and verify them"
mitii task list
```

Run runnable tasks in isolated worktrees:

```bash
mitii task run --parallel 2
mitii task worktrees
```

Each worktree is registered in `.mitii/worktrees.json`, and task state is stored in `.mitii/tasks/board.json`.

For local overnight runs, queue work and run a worker:

```bash
mitii job enqueue "Update docs and run the docs verification command" --mode agent
mitii worker --max-jobs 1 --lease-ms 3600000
```

See [Async Jobs and Local Workers](./async-jobs.md) for the full queue, retry, cancel, and supervisor workflow.

Custom subagents live in `.mitii/agents/`:

```bash
mitii agents init
```
