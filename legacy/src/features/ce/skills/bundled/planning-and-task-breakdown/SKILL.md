---
name: planning-and-task-breakdown
description: Converts a planning goal and current evidence into a small, ordered, verifiable task list. Use only when planning is already active and the task requires decomposition. Do not use for simple edits, questions, or already well-defined tasks.
---

# Planning and Task Breakdown

## Purpose

Convert an approved task goal and available repository evidence into the smallest executable task list.

This skill does not decide whether planning is required, select the planning depth, control tool permissions, or replace the task-specific primary workflow. Those decisions belong to the planner and execution router.

## When to Use

Use this skill when:

* Planning is already active.
* The task spans multiple dependent changes.
* The implementation order is not obvious.
* The task contains independent workstreams.
* A broad goal must be converted into bounded executable tasks.

Do not use this skill for:

* Questions or explanations.
* Single-file changes with obvious scope.
* Localized compiler or test failures.
* Tasks that already contain a complete executable plan.
* Log analysis.
* Documentation-only edits with clear requested changes.

## Inputs

Use the canonical planning context:

* Task goal
* Target project or workspace
* Task intent and subtype
* Requested planning depth
* Repository evidence already collected
* Existing error or test clusters
* Approved file scope
* Risk and approval constraints
* Available verification commands

Do not repeat discovery already represented in the evidence packet.

## Decomposition Strategy

Choose the strategy that matches the task.

### Feature work

Prefer vertical slices that deliver independently testable behavior.

### Bugfix work

Decompose by root-cause or error cluster:

1. Reproduce or reuse the current failure evidence.
2. Inspect the exact affected files and contracts.
3. Apply the smallest compatible fix.
4. Rerun the original failing check.
5. Continue only when a new failure cluster appears.

### Migration or restoration work

Follow dependency order:

1. Establish the canonical target state.
2. Restore or migrate shared contracts.
3. Update dependent implementations.
4. Update consumers.
5. Remove obsolete structures only after verification.

### Audit or cleanup work

Separate:

1. Evidence collection
2. Candidate review
3. Approved changes
4. Verification

Do not combine discovery and deletion into one task.

## Task Contract

Every internal task must contain:

* `id`
* `kind`
* `objective`
* `acceptanceCriteria`
* `verification`
* `dependencies`
* `risk`
* `likelyPaths`
* `evidenceIds`
* `status`

Supported task kinds:

* `inspect`
* `reproduce`
* `diagnose`
* `design`
* `change`
* `restore`
* `cleanup`
* `verify`
* `smoke_test`

Phase and tool policy are derived by the orchestrator from `kind`. Do not invent phase labels.

## Task Sizing

Prefer tasks that represent one coherent outcome.

Use these default limits:

* Quick plan: 2–4 tasks
* Deep plan: 4–7 tasks
* More than 7 tasks: split into named workstreams

A task is too large when it:

* Contains multiple independent outcomes.
* Crosses unrelated subsystems.
* Requires unrelated verification methods.
* Mixes diagnosis, implementation, and cleanup.
* Contains destructive work together with ordinary edits.

File count is supporting evidence, not the primary measure of complexity.

## Acceptance Criteria

Acceptance criteria must be machine-verifiable whenever possible.

Good criteria:

* The original TypeScript error signature no longer appears.
* The affected package build exits successfully.
* The referenced module resolves from all updated consumers.
* The application starts and reaches the expected health endpoint.

Avoid criteria such as:

* Code looks correct.
* Structure is cleaner.
* All issues are fixed.

## Verification

Use the narrowest verification that proves the task.

* Reuse an existing check result when the workspace has not changed.
* Rerun a check only after a relevant workspace mutation.
* Treat a failing diagnostic check as successfully captured evidence.
* Treat a failing final verification as an incomplete task.
* Do not mark a task complete from model narration alone.

Each completed task must reference evidence proving its acceptance criteria.

## Evidence Reuse

Planning discovery may already satisfy some tasks.

When evidence already proves a task:

* Mark it `satisfied_before_execution`.
* Attach the existing evidence IDs.
* Do not repeat the command or file read.
* Begin execution at the first unsatisfied task.

## Parallelization

Parallelize only when workstreams are independently verifiable and do not modify shared contracts.

Do not parallelize:

* Shared schema changes
* Repository restoration
* Sequential migrations
* Changes that depend on the same files
* Work that requires one canonical architectural decision first

## Persistence

The canonical plan is stored in the internal Plan Repository.

Do not create `tasks/plan.md`, `tasks/todo.md`, checkpoint files, logs, or state files in the user repository unless the user explicitly requests persistent plan documents.

A ready plan must produce a handoff record containing:

* `planId`
* `rootGoalHash`
* `targetProjectId`
* `status: ready`
* `nextStepId`
* `evidenceIds`
* `workspaceRevision`

Agent-mode continuation messages such as “continue,” “execute the plan,” or “fix it” must resume this plan when the handoff remains valid.

## User-Facing Presentation

Internal tasks may contain IDs, kinds, dependencies, risks, evidence references, and execution metadata.

The normal user-facing plan should show only:

1. A concise numbered action list
2. Important risks or approvals
3. The verification outcome expected at completion

Do not display internal phase names, tool policy, machine IDs, or orchestration metadata unless the user requests planner-debug details.

## Completion Check

Before accepting the plan, verify:

* The goal matches the user’s requested direction.
* The target project is explicit.
* Existing evidence is reused.
* Every task has measurable acceptance criteria.
* Dependencies are valid.
* Destructive operations are isolated.
* Verification is project-specific.
* Quick plans contain no more than four tasks.
* Deep plans contain no more than seven tasks.
* The Plan-to-Agent handoff can be resumed.
