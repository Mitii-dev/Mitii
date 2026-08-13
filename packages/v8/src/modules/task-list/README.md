# Task list

Status: implemented
Facade: `TaskListPipeline`
Primary outcome: compact live checklist (`TaskList`) for the current run

## Responsibility

Own the working task list that hosts display while Agent (or Plan) runs:

- Replace / patch / clear a list of at most 8 items
- Derive a compact list from a user-visible / approved `PlanArtifact` (first N executable steps, all pending). Internal Agent plans are not copied into the live list.
- For Agent runs with no list yet, leave the list empty until the model creates one via `update_todos` (do not invent Diagnose/Apply/Verify placeholders)
- Serialize and parse markdown checkboxes for host files and prompts

## Input

- `TaskListApplyInput` — `replace` | `patch` | `clear` plus optional current list
- `PlanArtifact` — only for `deriveFromPlan`

## Output

- `TaskListApplyResult` — `applied` | `rejected` with a validated `TaskList`
- Stable reason codes (`task_list_replaced`, `task_list_patched`, …)

## Pipeline stages

1. Validate apply input or plan
2. Replace, patch, clear, or derive
3. Enforce unique ids and at most one `active` item
4. Return the public result

## Dependencies and ports

- Planning public `PlanArtifact` (derive only)
- No filesystem, host, or Agent Engine imports

## Public exports

- `TaskListPipeline`
- `taskListSchema` / `TaskList`
- apply input/result schemas
- `parseTaskListMarkdown` / `serializeTaskListMarkdown` / `serializeTaskListForPrompt`
- constants, defaults, reason codes

## Failure modes

- Invalid input throws `TaskListError` (`invalid_input`)
- Unknown patch ids or empty replace → `status: rejected` with `task_list_invalid`

## Genericness strategy

Titles, ids, and sources are caller-supplied. Derivation reads generic plan
phases/steps and does not hard-code languages, hosts, or providers.

## Explicit non-responsibilities

- Plan drafting or approval
- Tool execution or verification
- Host persistence / UI / CLI formatting
- Marking every item done when a run completes
- Attaching a list to every skill
- Dumping internal Discover/Change/Verify process templates into the live list
