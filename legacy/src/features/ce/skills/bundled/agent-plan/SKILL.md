---
name: agent-plan
description: Guide Agent mode planning depth (Auto/Quick/Deep), produce executable plans, continue into implementation, and avoid unnecessary discovery or replanning.
---

# Agent Plan

## Quick Reference

- Plan only as deeply as needed; prefer execution over ceremony.
- Auto → Direct / Quick / Deep. Uncertain Quick vs Deep → Quick unless safety/data/API/side effects are at stake.
- User-facing plan: heading `Plan`, one numbered list of concrete actions — no phase badges.
- After a valid plan in Agent mode, continue execution unless approval or a material decision is required.
- Replan only when scope, architecture, safety, or a core assumption changes.
- Stop when requested work is verified.

## Planning Depths

### Auto

Classify into Direct execution, Quick planning, or Deep planning.

**Direct execution when:** question/explanation; diagnosis-only; obvious localized change; one small file/function; exact patch given; status check; commit-message generation; deterministic read-only op; planning would cost more than doing the work.

Internal check only (target / change / verify / risk). Do not emit a visible plan unless it clarifies.

**Quick when:** clear and bounded; ~1–4 files; known deps; reversible; low/medium risk; short implement+verify path; no migrations, destructive actions, or major public-API changes.

**Deep when:** multiple subsystems; order matters; material uncertainty; migration/data transform; security/auth/secrets; public API or schema change; external/remote writes; destructive ops; release/deploy/infra; coordinated workstreams; multi-check verification.

Do not choose Deep merely because the repo is large.

### Quick limits

- ≤4 steps, ≤2 discovery actions before execute, ≤1 verification step
- No separate review phase unless a real decision is required
- No subagents unless controller-enabled
- No replan for ordinary implementation details

```text
Inspect (if needed) → Execute → Verify → Complete
```

### Deep limits

- Prefer 4–8 executable steps (hard max 12 top-level)
- Group into milestones; do not invent a step per file
- Internal phases (Diagnostics / Review / Execute / Verify) are orchestration only — never show as user-facing badges
- Add Review only for architecture, migration, security, public-API, destructive, or acceptance decisions
- Checkpoints only at meaningful risk boundaries

```text
Focused discovery → Review (if needed) → Ordered execution → Checkpoint → Verify → Complete
```

## User-Facing Plan Format

```text
Plan

1. Reproduce the affected package build failure.
2. Inspect the files and imports named by the failure.
3. Restore the intended structure with the smallest safe change.
4. Rerun the affected builds and start the application.
```

Hide: Diagnostics/Review/Execute/Verify labels, phase names, tool-policy metadata, internal IDs, dependency graphs, approval mechanics — unless the user asks for a technical/debug plan.

Machine-readable plans may still store `id`, `objective`, `phase`, `successCriteria`, and optional `files` / `dependsOn` / `risk` / `approvalRequired` for the controller.

## Ordering Rules

1. Foundational changes before dependents.
2. Shared contracts before consumers.
3. Migrations before code that requires them.
4. Deterministic analyzers before model interpretation of their output.
5. Validation before remote/destructive execution.
6. Prefer verifiable vertical slices over “wire everything at the end.”

## Discovery Rules

- Use existing context first; read only files that change the decision.
- Batch independent reads; do not re-list dirs or reread unchanged files.
- Stop discovery when there is enough evidence to execute.
- Unknown verify command → one narrow look at package scripts / tests / CI.

## Ask Guidance

- If the user asks for a plan only, produce the numbered Plan and stop.
- Prefer the smallest depth that covers risks; do not invent Deep ceremony for simple asks.

## Planning Guidance

- Resolve Auto to Direct / Quick / Deep before writing steps.
- Every step needs an observable success criterion.
- Include verification; exclude unrelated cleanup.
- Represent material risks and approvals when present.

## Agent Execution Guidance

- After a valid plan: validate once, begin the first ready step immediately.
- Stop only for required approval, destructive confirmation, unresolved material decision, missing dependency, or unsafe continuation.
- Resume saved plans only when task/workspace/repo/branch/goal/version still match; otherwise re-evaluate only the invalid portion.
- Do not grant the plan extra permissions beyond the controller.

## Verification Guidance

- Define the narrowest relevant check (targeted test, typecheck, build, runtime, schema, docs, git/GitHub state).
- Do not claim tests passed unless executed successfully.
- Unrelated pre-existing failures: report separately; do not expand scope or restart planning.

## Replanning

**Replan when:** user changes scope; missing dependency/API/file/tool; architecture invalidates sequence; unexpected destructive/migration/security/public-API/remote-write; verification disproves a core assumption.

**Do not replan for:** renames, equivalent helpers, minor tests/formatting/imports, recoverable tool errors, equivalent verify commands.

When replanning: record the invalid assumption, preserve completed valid steps, replace only affected pending steps, continue — no full-plan regeneration loops.

## Failure Behavior

- Plan fails validation → correct once from deterministic feedback; do not rerun full discovery.
- No progress (repeated identical reads/searches/plans/actions) → identify blocker; retry once with a different action or stop.
- Fall back to direct execution only when the task remains safe and bounded.

## Forbidden Actions

- Visible phase badges (Diagnostics/Review/Execute/Verify) in normal user plans
- Ceremonial empty phases or duplicate steps
- Deep planning for simple/local tasks
- Stopping after the plan in Agent mode without a blocking reason
- Unlimited plan regeneration or discovery loops
- Expanding into unrelated cleanup

## Completion

Done when requested behavior/artifact is implemented (or plan-only deliverable produced), required steps finished, relevant verification performed, approvals accounted for, and remaining unrelated issues reported separately. Planning itself completes as soon as execution can safely begin.
