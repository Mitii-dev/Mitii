---

name: agent-plan
description: Guide Agent mode when structured planning is needed before execution. Supports Auto, Quick, and Deep depths, creates executable plans, continues into implementation, verifies results, and prevents unnecessary discovery or replanning loops.
---

# Agent Plan

Create the smallest executable plan that allows the current Agent task to be completed safely and efficiently.

This skill supports three planning depths:

* **Auto** — Determine whether the task needs direct execution, Quick planning, or Deep planning.
* **Quick** — Use a compact plan for clear, localized, low-to-medium-risk work.
* **Deep** — Use a structured plan for complex, uncertain, cross-component, destructive, or high-risk work.

Planning is an execution aid, not the final deliverable. After producing a valid plan, continue into execution unless approval or a material user decision is required.

---

# Core Principles

1. Plan only as deeply as the task requires.
2. Prefer execution over planning ceremony.
3. Use existing codebase context before calling discovery tools.
4. Inspect only enough files to identify scope, dependencies, risks, and verification.
5. Keep every plan step concrete and executable.
6. Do not create empty, repetitive, or ceremonial phases.
7. Do not stop after presenting a plan in Agent mode.
8. Do not replan unless a material assumption or safety boundary changes.
9. Use the narrowest relevant verification method.
10. Complete the user’s requested task without expanding into unrelated cleanup.

---

# Plan Presentation

Phases are internal orchestration metadata.

For normal user-facing plans:

* Use the heading `Plan`.
* Present one concise numbered list of concrete actions.
* Show what is being planned or executed through step titles, current-step status, blockers, and final verification status.
* Do not display Diagnostics, Review, Execute, or Verify as headings, badges, or section labels.
* Do not expose phase names, tool-policy metadata, internal IDs, operation categories, dependency edges, machine validation details, or approval mechanics unless the user explicitly requests a technical plan, execution trace, or planner-debug view.

Example user-facing plan:

```text
Plan

1. Reproduce the affected package build failure.
2. Inspect the files and imports named by the failure.
3. Restore the intended folder structure with the smallest safe change.
4. Rerun the affected builds and start the application.
```

The machine-readable plan may continue to store phases, dependencies, success criteria, risks, and approval requirements for execution control.

---

# Planning Depths

## Auto

Use Auto when the user or controller has not explicitly selected a planning depth.

Auto must classify the task into one of these outcomes:

```text
Direct execution
Quick planning
Deep planning
```

### Use direct execution when

* The task is a question or explanation.
* The task is diagnosis-only and requires no modifications.
* The requested change is obvious and localized.
* Only one small file or function is affected.
* The user provided an exact patch or deterministic instruction.
* The operation is a simple status check.
* The task is commit-message generation.
* The task is a deterministic read-only operation.
* Planning would take longer than the expected implementation.

Direct execution may still perform a brief internal check of:

```text
Target
Required change
Verification
Risk
```

Do not output a visible plan unless it adds useful clarity.

### Select Quick when

* The task is clear and bounded.
* One to four files are likely affected.
* Dependencies are known or easily discovered.
* The change is reversible.
* Risk is low or medium.
* The task has a short implementation and verification path.
* There are no migrations, destructive actions, or major public-interface changes.

### Select Deep when

* Multiple subsystems or packages are affected.
* Implementation order matters.
* Requirements contain material uncertainty.
* A migration or data transformation is involved.
* Security, authentication, permissions, or secrets are affected.
* A public API or persisted schema changes.
* External systems or remote writes are involved.
* The task contains destructive actions.
* A release, deployment, or infrastructure workflow is involved.
* Independent workstreams must be coordinated.
* Verification requires several distinct checks.

### Auto-selection rule

When uncertain between Quick and Deep, choose Quick unless the uncertainty affects:

* Behavior
* Persistent data
* Security
* Public APIs
* Cost
* External side effects
* Destructive operations

Do not choose Deep merely because the repository is large.

---

# Quick Planning

Quick planning is for clear, bounded tasks that need a small execution contract.

## Limits

* Maximum 4 steps
* Maximum 2 discovery actions before execution
* Maximum 1 verification step
* No separate review phase unless a real decision must be made
* No subagents unless explicitly enabled by the controller
* No replanning for normal implementation details

## Preferred flow

```text
Inspect, if needed
    ↓
Execute
    ↓
Verify
    ↓
Complete
```

Omit inspection when the required code and target are already available.

## Quick plan format

```markdown
Plan:
1. [Concrete change and target]
2. [Additional dependent change, if necessary]
3. Verify with [specific command or manual check]
```

For machine-readable plans:

```json
{
  "depth": "quick",
  "goal": "Concrete task outcome",
  "steps": [
    {
      "id": "step-1",
      "objective": "Make the requested change",
      "phase": "execute",
      "files": ["path/to/file.ts"],
      "dependsOn": [],
      "successCriteria": [
        "Requested behavior is implemented"
      ],
      "risk": "low"
    },
    {
      "id": "step-2",
      "objective": "Verify the change",
      "phase": "verify",
      "dependsOn": ["step-1"],
      "successCriteria": [
        "Targeted verification passes"
      ],
      "risk": "low"
    }
  ]
}
```

Do not expand a Quick plan into Diagnostics, Review, Execute, and Verify unless all those phases perform distinct necessary work.

---

# Deep Planning

Deep planning is for complex or high-risk work where execution order and checkpoints materially reduce risk.

## Limits

* Prefer 4–8 executable steps
* Maximum 12 top-level steps
* Group larger work into milestones instead of producing a long flat list
* Use only necessary phases
* Add checkpoints at meaningful risk boundaries
* Do not create a separate step for every file
* Do not split one logical change into artificial micro-steps

## Possible phases

### Diagnostics

Read-only discovery used to establish facts.

Examples:

* Read relevant architecture and implementation files
* Run bounded diagnostics
* Inspect repository structure
* Analyze schemas or dependency relationships
* Run approved deterministic audit scripts

### Review

Read-only decision validation.

Use only when the task requires:

* Architecture selection
* Migration review
* Security review
* Public API impact review
* Destructive-action review
* Acceptance-criteria confirmation

Do not add Review merely to restate Diagnostics.

### Execute

Perform approved modifications.

Examples:

* Edit source files
* Update configuration
* Add tests
* Create migrations
* Modify manifests
* Generate required artifacts
* Perform approved local or remote writes

### Verify

Validate the result using the narrowest relevant checks.

Examples:

* Targeted tests
* Type checking
* Linting
* Build validation
* Runtime checks
* Schema validation
* Git state verification
* Workflow validation
* Manual artifact inspection

## Preferred Deep flow

```text
Focused discovery
    ↓
Decision review, only when necessary
    ↓
Ordered execution
    ↓
Checkpoint
    ↓
Remaining execution
    ↓
Targeted verification
    ↓
Complete
```

---

# Step Requirements

Every internal planned step must have:

* `id`
* `objective`
* `phase`
* `successCriteria`

Include these when relevant:

* `kind`, when supported by the controller schema
* `files`
* `dependsOn`
* `risk`
* `operation`
* `checkpoint`
* `approvalRequired`

Do not include metadata mechanically. The normal user-facing plan must show only the objective or title and meaningful status; internal metadata must remain hidden unless detailed planner output is explicitly requested.

## Recommended schema

```json
{
  "id": "step-1",
  "objective": "Add route-specific skill selection",
  "phase": "execute",
  "operation": "workspace_edit",
  "files": [
    "src/runtime/skillResolver.ts"
  ],
  "dependsOn": [],
  "successCriteria": [
    "Only skills matching the resolved task route are selected",
    "Unrelated skills are excluded"
  ],
  "risk": "medium",
  "approvalRequired": false
}
```

The plan may describe the operation category, but the controller determines which tools are actually available.

The plan must never grant itself additional permissions.

---

# Dependency and Ordering Rules

1. Put foundational changes before dependent changes.
2. Define shared contracts before implementations that consume them.
3. Run migrations before code that requires the migrated structure.
4. Add deterministic analyzers before prompting the model to interpret their output.
5. Add routing before route-specific tools or skills.
6. Add validation before enabling remote or destructive execution.
7. Verify each meaningful vertical slice before starting an unrelated slice.
8. Keep unrelated changes in separate steps or separate tasks.

Prefer vertical slices when they create independently usable behavior.

Example:

```text
Good:
- Add commit-message route, context collector, validator, and tests
- Add Git commit execution route separately

Avoid:
- Add all Git tools
- Add all Git skills
- Connect everything at the end
```

---

# Discovery Rules

Discovery must be read-only and bounded.

1. Use existing context, repository maps, and previously read files first.
2. Read only files that can change the implementation decision.
3. Batch independent reads.
4. Do not repeatedly list the same directory.
5. Do not reread unchanged files unless the required lines are absent.
6. Do not inspect the entire repository for a localized task.
7. Do not run dependency, audit, lint, or build tools unless relevant.
8. Do not start subagents for work that one bounded search can complete.
9. Stop discovery when the plan has enough evidence to execute.
10. Do not turn discovery findings into another discovery phase.

When a verification command is unknown, perform one narrow discovery action to inspect:

* The relevant package manifest
* Script catalog
* Existing test convention
* Existing CI configuration

---

# Tool and Permission Rules

Tool access comes from the controller, route, current phase, and approval policy.

The plan must follow these boundaries:

```text
Diagnostics:
Read-only tools only

Review:
Read-only tools only

Execute:
Only approved workspace, Git, external, or remote write tools

Verify:
Diagnostics and approved verification tools
```

Never request write tools from Diagnostics or Review.

Never weaken controller-supplied approval requirements.

Never assume that Agent mode automatically allows:

* Dependency installation
* Git commits
* Git pushes
* Pull-request creation
* Issue creation
* Workflow dispatch
* Releases
* Deployments
* Data deletion
* Destructive commands

---

# Verification

Every planned task must define the narrowest relevant verification path.

Examples:

```text
Source-code change:
Targeted test, typecheck, build, or runtime behavior

Prompt or routing change:
Unit tests, prompt snapshots, and route-selection tests

Configuration change:
Parser, schema, or startup validation

Documentation:
Docs build, Markdown validation, link check, or manual inspection

Git operation:
Repository state and resulting commit verification

GitHub operation:
Remote object and URL verification

Log analysis:
File coverage, arithmetic checks, and bounded evidence validation

Workflow change:
YAML validation and static workflow analysis

Database migration:
Migration execution, schema check, and rollback validation
```

Do not run every available verification command.

Do not claim that tests passed unless they were actually executed successfully.

If verification reports unrelated pre-existing errors:

1. Record them separately.
2. Confirm whether the requested change is still valid.
3. Do not expand the task to fix unrelated failures.
4. Do not restart discovery or planning.

---

# Handoff to Execution

After a valid plan is produced:

1. Validate the plan.
2. Save the plan state when persistence is enabled.
3. Begin the first ready step immediately.
4. Do not stop merely to display the plan.
5. Stop only when:

   * Approval is required
   * A destructive action requires confirmation
   * A material user decision is unresolved
   * A required dependency is unavailable
   * Execution cannot continue safely

When approval is required:

* Preserve completed work
* Save the pending step
* State the exact requested action
* Resume from that step after approval
* Do not rerun completed discovery

---

# Saved Plan Behavior

When the user says “continue,” resume the active plan only when all applicable identifiers still match:

* Task ID
* Workspace
* Repository
* Branch
* Goal
* Plan version
* Relevant repository checkpoint
* Pending approval or step

If the saved plan is stale:

1. Preserve confirmed completed work.
2. Identify the invalid portion.
3. Re-evaluate only the invalid steps.
4. Do not regenerate the entire plan unless the goal or architecture changed.

When the user starts a different task, do not resume the old plan.

---

# Replanning

Replan only when:

* The user changes the requested scope.
* A required dependency, API, file, service, or tool does not exist.
* The discovered architecture invalidates the planned sequence.
* A destructive operation becomes necessary.
* A data migration appears.
* A security-sensitive change appears.
* A public API or persisted schema must change unexpectedly.
* A remote write or external side effect appears unexpectedly.
* Verification disproves a core planning assumption.

Do not replan for:

* Renamed files
* Equivalent helper functions
* Compatible file locations
* Minor test changes
* Formatting differences
* Small validation fixes
* Import corrections
* Local implementation details
* Recoverable tool errors
* A different but equivalent verification command

When replanning is justified:

1. Record the specific invalid assumption.
2. Preserve completed valid steps.
3. Replace only affected pending steps.
4. Increment the plan version.
5. Continue execution.

Do not create repeated full-plan regeneration loops.

---

# Plan Quality Gates

A plan is valid only when:

* Its depth is `quick` or `deep`.
* Auto has resolved to direct execution, Quick, or Deep.
* Step count fits the selected depth.
* Every step has an observable success criterion.
* Dependencies reference valid step IDs.
* No dependency cycle exists.
* Read-only phases contain no writes.
* No duplicate steps exist.
* No ceremonial phase exists.
* Verification is defined.
* Explicit user requirements are covered.
* Unrelated work is excluded.
* Risks and approvals are represented when material.
* At least one executable step is ready.

If the plan fails validation:

1. Correct it once using deterministic validation feedback.
2. Do not rerun full discovery.
3. Do not enter an unlimited plan-regeneration loop.
4. Fall back to direct execution only when the task remains safe and bounded.

---

# No-Progress Protection

Stop or change strategy when:

* The same file is read repeatedly without state changes.
* The same search is run repeatedly.
* The same plan is regenerated.
* The same validation failure repeats after a correction attempt.
* The same tool action is attempted with identical arguments.
* No task state changes after two consecutive actions.

After detecting no progress:

1. Use existing evidence.
2. Identify the exact blocker.
3. Retry once with a materially different action, or stop.
4. Do not continue generating more planning text.

---

# Completion

An Agent-mode task is complete when:

* The requested behavior or artifact is implemented.
* All required steps are complete.
* Relevant verification has been performed.
* No unresolved task-caused errors remain.
* Required approvals and external actions are accounted for.
* Remaining unrelated issues are reported separately.
* The final response summarizes:

  * What changed
  * What was verified
  * What remains, if anything

Planning is complete as soon as execution can safely begin.

After that, stop planning and execute.
