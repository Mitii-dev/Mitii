---
name: planning-and-task-breakdown
description: Break work into ordered, verifiable tasks at the smallest useful planning depth. Use when there is a spec or clear requirement that needs implementation tasks, when the work feels too large or risky to start directly, when scope needs to be estimated, or when parallel work is possible. For small obvious changes, use a micro-plan instead of a full plan so planning does not become the work.
---

# Planning and Task Breakdown

## Overview

Decompose work only as much as needed to act safely. Good task breakdown turns vague or risky work into small, verifiable steps. Bad task breakdown turns obvious work into ceremony. Prefer the lightest plan that exposes dependencies, acceptance criteria, and verification.

Every planned task should be small enough to implement, test, and verify in a focused session. When the change is already obvious, write a micro-plan and start.

## Planning Depth

Choose the smallest useful planning shape before writing anything else:

| Situation | Output | Hard limit |
|---|---|---|
| **Tiny / obvious**: one file, known fix, low risk | Micro-plan | 3 bullets max |
| **Small**: 1-2 files, clear behavior, limited risk | Short task list | 2-4 tasks max |
| **Medium**: 3-5 files, multiple components, some uncertainty | Standard plan | Tasks + dependencies + verification |
| **Large / risky**: cross-cutting, migrations, ambiguous requirements, parallel agents | Full implementation plan | Phases + checkpoints + risks |

If the plan takes longer to write than the likely code change, stop planning and execute the micro-plan.

### Micro-Plan Format

Use this for tiny or obvious work:

```markdown
Plan:
- Change: [one sentence]
- Verify: [command or manual check]
- Risk: [low/medium/high and why]
```

Do not add phases, dependency graphs, or checkpoints to micro-plans.

### Short Task List Format

Use this for small work that has more than one step but does not need a full plan:

```markdown
Tasks:
- [ ] [Small task] — verify with [command/check]
- [ ] [Small task] — verify with [command/check]

Final check: [command or manual check]
```

Keep short task lists to 2-4 tasks. If that is not enough, use the standard task template.

## The Planning Process

### Step 1: Choose Planning Depth

Before writing code, briefly operate in read-only mode:

- Read the spec and relevant codebase sections
- Identify existing patterns and conventions
- Choose micro, short, standard, or full planning depth
- Note risks and unknowns that change implementation order

Do not write code until the plan shape is chosen. For small obvious work, this may take less than a minute.

### Step 2: Identify Dependencies

For standard and full plans, map what depends on what:

```
Database schema
    │
    ├── API models/types
    │       │
    │       ├── API endpoints
    │       │       │
    │       │       └── Frontend API client
    │       │               │
    │       │               └── UI components
    │       │
    │       └── Validation logic
    │
    └── Seed data / migrations
```

Implementation order follows the dependency graph bottom-up: build foundations first. For micro-plans and short task lists, name only the dependency that actually affects the next step.

### Step 3: Slice Vertically When Useful

Instead of building all the database, then all the API, then all the UI — build one complete feature path at a time:

**Bad (horizontal slicing):**
```
Task 1: Build entire database schema
Task 2: Build all API endpoints
Task 3: Build all UI components
Task 4: Connect everything
```

**Good (vertical slicing):**
```
Task 1: User can create an account (schema + API + UI for registration)
Task 2: User can log in (auth schema + API + UI for login)
Task 3: User can create a task (task schema + API + UI for creation)
Task 4: User can view task list (query + API + UI for list view)
```

Each vertical slice delivers working, testable functionality. Do not force vertical slicing onto a small local change where a direct edit is clearer.

### Step 4: Write Tasks

For standard and full plans, each task follows this structure:

```markdown
## Task [N]: [Short descriptive title]

**Description:** One paragraph explaining what this task accomplishes.

**Acceptance criteria:**
- [ ] [Specific, testable condition]
- [ ] [Specific, testable condition]

**Verification:**
- [ ] Tests pass: `npm test -- --grep "feature-name"`
- [ ] Build succeeds: `npm run build`
- [ ] Manual check: [description of what to verify]

**Dependencies:** [Task numbers this depends on, or "None"]

**Can parallelize:** [Yes/No, and with which task if yes]

**Files likely touched:**
- `src/path/to/file.ts`
- `tests/path/to/test.ts`

**Estimated scope:** [XS: 1 file | S: 1-2 files | M: 3-5 files | L: 5-8 files]

**Stop condition:** Ask the human if [specific ambiguity, destructive action, or risk appears].
```

### Step 5: Order and Checkpoint

Arrange tasks so that:

1. Dependencies are satisfied (build foundation first)
2. Each task leaves the system in a working state
3. Verification checkpoints occur after every 2-3 tasks
4. High-risk tasks are early (fail fast)

Add explicit checkpoints:

```markdown
## Checkpoint: After Tasks 1-3
- [ ] All tests pass
- [ ] Application builds without errors
- [ ] Core user flow works end-to-end
- [ ] Review with human before proceeding
```

For micro-plans and short task lists, use a single final verification instead of phase checkpoints.

## Task Sizing Guidelines

| Size | Files | Scope | Example |
|------|-------|-------|---------|
| **XS** | 1 | Single function or config change | Add a validation rule |
| **S** | 1-2 | One component or endpoint | Add a new API endpoint |
| **M** | 3-5 | One feature slice | User registration flow |
| **L** | 5-8 | Multi-component feature | Search with filtering and pagination |
| **XL** | 8+ | **Too large — break it down further** | — |

If a task is L or larger, it should be broken into smaller tasks. An agent performs best on S and M tasks.

**When to break a task down further:**
- It would take more than one focused session (roughly 2+ hours of agent work)
- You cannot describe the acceptance criteria in 3 or fewer bullet points
- It touches two or more independent subsystems (e.g., auth and billing)
- You find yourself writing "and" in the task title (a sign it is two tasks)

**When NOT to break a task down further:**
- The acceptance criteria are already obvious and testable
- The task is a local edit with one verification command
- Splitting would create sequencing overhead without reducing risk
- The next step is reversible and easy to inspect

## Anti-Overplanning Rules

- Prefer a micro-plan for XS work even when this skill is invoked.
- Cap small-task planning at one screen of text.
- Do not create fake phases for a one-sitting change.
- Do not require human approval for low-risk micro-plans unless the user asked for approval first.
- If the only unknown is "which exact line changes?", inspect the code and continue.
- Ask the human only when an assumption changes behavior, data, security, cost, or public API.

Planning should reduce uncertainty. When it only increases paperwork, shrink the plan.

## Plan Document Template

Use this only for standard or full plans:

```markdown
# Implementation Plan: [Feature/Project Name]

## Overview
[One paragraph summary of what we're building]

## Architecture Decisions
- [Key decision 1 and rationale]
- [Key decision 2 and rationale]

## Task List

### Phase 1: Foundation
- [ ] Task 1: ...
- [ ] Task 2: ...

### Checkpoint: Foundation
- [ ] Tests pass, builds clean

### Phase 2: Core Features
- [ ] Task 3: ...
- [ ] Task 4: ...

### Checkpoint: Core Features
- [ ] End-to-end flow works

### Phase 3: Polish
- [ ] Task 5: ...
- [ ] Task 6: ...

### Checkpoint: Complete
- [ ] All acceptance criteria met
- [ ] Ready for review

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| [Risk] | [High/Med/Low] | [Strategy] |

## Open Questions
- [Question needing human input]
```

## Parallelization Opportunities

When multiple agents or sessions are available:

- **Safe to parallelize:** Independent feature slices, tests for already-implemented features, documentation
- **Must be sequential:** Database migrations, shared state changes, dependency chains
- **Needs coordination:** Features that share an API contract (define the contract first, then parallelize)

Do not parallelize XS/S tasks unless they are truly independent. Coordination can cost more than it saves.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll figure it out as I go" | That's how you end up with a tangled mess and rework. 10 minutes of planning saves hours. |
| "The tasks are obvious" | Use a micro-plan. Capture intent and verification, then move. |
| "Planning is overhead" | Oversized planning is overhead. Right-sized planning prevents rework. |
| "I can hold it all in my head" | Context windows are finite. Written plans survive session boundaries and compaction. |
| "Small tasks need full plans too" | No. Small tasks need a tiny intent, a verification check, and then execution. |

## Red Flags

- Starting implementation without a written task list
- Tasks that say "implement the feature" without acceptance criteria
- No verification steps in the plan
- All tasks are XL-sized
- No checkpoints between tasks
- Dependency order isn't considered
- The plan is longer than the work it describes
- The agent keeps splitting reversible local edits into separate tasks

## Verification

Before starting implementation of a standard or full plan, confirm:

- [ ] Every task has acceptance criteria
- [ ] Every task has a verification step
- [ ] Task dependencies are identified and ordered correctly
- [ ] No task touches more than ~5 files unless there is a clear reason
- [ ] Checkpoints exist between major phases when there are phases
- [ ] Human approval is requested for high-risk, ambiguous, destructive, or cross-system plans

For a micro-plan, confirm only:

- [ ] The intended change is clear
- [ ] There is a verification command or manual check
- [ ] The risk is low enough to proceed without a full plan

## See Also

Acceptance criteria are per-task and answer "did we build the right thing?". They sit on top of the project-wide Definition of Done, the standing bar every task clears before it counts as done (see `using-agent-skills`):

- [ ] Tests pass
- [ ] No regressions introduced
- [ ] Behavior verified at runtime, not just type-checked or "looks right"
- [ ] Docs updated if behavior or interfaces changed
