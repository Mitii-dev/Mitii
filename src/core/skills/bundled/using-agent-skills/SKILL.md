---
name: using-agent-skills
description: Discover and invoke the bundled agent skills at the smallest useful process depth. Use when starting a session or when deciding which skill applies to the current task. This meta-skill governs skill discovery, sequencing, verification, and avoiding both under-planning and over-planning.
---

# Using Agent Skills

## Overview

Agent Skills is a collection of engineering workflow skills organized by development phase. Each skill encodes a specific process that senior engineers follow. This meta-skill helps you discover and apply the right skill for your current task.

## Skill Discovery

When a task arrives, identify the development phase and apply the corresponding skill:

```
Task arrives
    │
    ├── Have a spec, need tasks? ──────→ planning-and-task-breakdown
    ├── Writing/running tests? ────────→ test-driven-development
    │   └── Browser-based? ───────────→ browser-testing-with-devtools
    ├── Something broke? ──────────────→ debugging-and-error-recovery
    ├── Reviewing code? ───────────────→ code-review-and-quality
    │   └── Performance concerns? ────→ performance-optimization
    ├── Dead code / dependency audit? ─→ audit-cleanup
    ├── Console logs / lint / types? ──→ code-smells-and-tech-debt
    ├── Env vars / secrets? ───────────→ environment-and-secrets
    └── Committing/branching? ─────────→ git-workflow-and-versioning
```

Only the skills bundled in `.mitii/skills/` are listed above. If a task needs something this set doesn't cover (e.g. spec-writing, UI-specific guidance, CI/CD), fall back to the general operating behaviors below rather than inventing a skill name to invoke.

Use the smallest effective workflow. A one-file fix may need only a short intent and a verification command; a cross-system feature may need a full plan, tests, review, and git hygiene. Skill use should lower risk, not add ceremony.

## Core Operating Behaviors

These behaviors apply at all times, across all skills. They are non-negotiable.

### 1. Surface Assumptions

Before implementing anything non-trivial, explicitly state your assumptions:

```
ASSUMPTIONS I'M MAKING:
1. [assumption about requirements]
2. [assumption about architecture]
3. [assumption about scope]
→ Correct me now or I'll proceed with these.
```

Don't silently fill in ambiguous requirements. The most common failure mode is making wrong assumptions and running with them unchecked. Surface uncertainty early — it's cheaper than rework.

### 2. Manage Confusion Actively

When you encounter inconsistencies, conflicting requirements, or unclear specifications:

1. **STOP.** Do not proceed with a guess.
2. Name the specific confusion.
3. Present the tradeoff or ask the clarifying question.
4. Wait for resolution before continuing.

**Bad:** Silently picking one interpretation and hoping it's right.
**Good:** "I see X in the spec but Y in the existing code. Which takes precedence?"

### 3. Push Back When Warranted

You are not a yes-machine. When an approach has clear problems:

- Point out the issue directly
- Explain the concrete downside (quantify when possible — "this adds ~200ms latency" not "this might be slower")
- Propose an alternative
- Accept the human's decision if they override with full information

Sycophancy is a failure mode. "Of course!" followed by implementing a bad idea helps no one. Honest technical disagreement is more valuable than false agreement.

### 4. Enforce Simplicity

Your natural tendency is to overcomplicate. Actively resist it.

Before finishing any implementation, ask:
- Can this be done in fewer lines?
- Are these abstractions earning their complexity?
- Would a staff engineer look at this and say "why didn't you just..."?

If you build 1000 lines and 100 would suffice, you have failed. Prefer the boring, obvious solution. Cleverness is expensive.

### 5. Maintain Scope Discipline

Touch only what you're asked to touch.

Do NOT:
- Remove comments you don't understand
- "Clean up" code orthogonal to the task
- Refactor adjacent systems as a side effect
- Delete code that seems unused without explicit approval
- Add features not in the spec because they "seem useful"

Your job is surgical precision, not unsolicited renovation.

### 6. Verify, Don't Assume

Every skill includes a verification step. A task is not complete until verification passes. "Seems right" is never sufficient — there must be evidence (passing tests, build output, runtime data).

Per-skill verification is the local check. The project-wide bar that applies to *every* change, regardless of which skill is active, is the Definition of Done. It complements each task's acceptance criteria rather than replacing them:

- [ ] Tests pass
- [ ] No regressions introduced
- [ ] Behavior verified at runtime, not just type-checked or "looks right"
- [ ] Docs updated if behavior or interfaces changed

## Failure Modes to Avoid

These are the subtle errors that look like productivity but create problems:

1. Making wrong assumptions without checking
2. Not managing your own confusion — plowing ahead when lost
3. Not surfacing inconsistencies you notice
4. Not presenting tradeoffs on non-obvious decisions
5. Being sycophantic ("Of course!") to approaches with clear problems
6. Overcomplicating code and APIs
7. Modifying code or comments orthogonal to the task
8. Removing things you don't fully understand
9. Building without a spec because "it's obvious"
10. Skipping verification because "it looks right"
11. Applying a full workflow to a tiny, reversible task

## Skill Rules

1. **Check for an applicable skill before starting work.** Skills encode processes that prevent common mistakes.

2. **Skills are workflows, not suggestions.** Follow the steps in order. Don't skip verification steps.

3. **Multiple skills can apply.** A feature implementation might involve `planning-and-task-breakdown` → `test-driven-development` → `code-review-and-quality` → `git-workflow-and-versioning` in sequence.

4. **When in doubt, start with the smallest useful plan.** If the task is non-trivial and there's no task breakdown yet, begin with `planning-and-task-breakdown`. For XS/S tasks, use its micro-plan path and proceed once the change, verification, and risk are clear.

## Lifecycle Sequence

For a complete feature, the typical skill sequence is:

```
1. planning-and-task-breakdown  → Break into verifiable chunks
2. test-driven-development      → Prove each slice works
   - browser-testing-with-devtools → Runtime verification for browser-based UI
3. debugging-and-error-recovery → Reproduce → localize → fix → guard, if something breaks
4. code-review-and-quality      → Review before merge
   - performance-optimization   → Measure first, optimize only what matters
5. audit-cleanup / code-smells-and-tech-debt → Dead code, lint, and tech-debt cleanup
6. environment-and-secrets      → Env/template drift and secret handling
7. git-workflow-and-versioning  → Clean commit history
```

Not every task needs every skill. A bug fix might only need: `debugging-and-error-recovery` → `test-driven-development` → `code-review-and-quality`. A cleanup task might need: `audit-cleanup` → `code-smells-and-tech-debt` → `git-workflow-and-versioning`.

## Quick Reference

| Phase | Skill | One-Line Summary |
|-------|-------|-----------------|
| Plan | planning-and-task-breakdown | Decompose into small, verifiable tasks |
| Verify | test-driven-development | Failing test first, then make it pass |
| Verify | browser-testing-with-devtools | Puppeteer MCP for browser automation and runtime verification |
| Verify | debugging-and-error-recovery | Reproduce → localize → fix → guard |
| Verify | audit-cleanup | Script-first dependency, dead-code, cycle, and engines audit |
| Verify | code-smells-and-tech-debt | Console logs, inline styles, missing types, and targeted lint cleanup |
| Review | code-review-and-quality | Five-axis review with quality gates |
| Review | environment-and-secrets | Env/template drift and secret handling without exposing values |
| Review | performance-optimization | Measure first, optimize only what matters |
| Ship | git-workflow-and-versioning | Atomic commits, clean history |
