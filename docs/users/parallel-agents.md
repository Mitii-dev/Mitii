# Parallel Agents

Phase 2 adds two delegation patterns.

| Pattern | Use when |
| --- | --- |
| Subagents | Research, review, verification, or tightly scoped implementation in the current branch |
| Worktrees | Independent tasks that should run in isolated branches |
| Daemon + board clients | Multiple clients need to attach to the same runtime |

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

Custom subagents live in `.mitii/agents/`:

```bash
mitii agents init
```
