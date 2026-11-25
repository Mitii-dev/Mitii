# Interaction Mode

Interaction Mode defines the user-facing execution cap for a request. Mode is not the same as intent: a request can ask for a change, but `plan` mode still prevents write grants.

## What This Component Does

- Defines the valid agent modes.
- Validates mode at request intake.
- Gives Decision Policy a hard cap for allowed behavior.
- Lets planning, skills, and context modules understand the caller's requested interaction style.

## Structure

```text
interaction-mode/
  constants.ts
  schema.ts
  types.ts
  README.md
```

## Types And Contracts

- `AgentMode`: public mode type.
- `agentModeSchema`: Zod schema used by intake and downstream module inputs.

Typical meaning:

- `ask`: answer or explain, no write tools.
- `plan`: produce or revise a plan, no write tools.
- `agent`: allow execution if Decision Policy also grants it.

## Technical Details

- Mode is validated before intent classification.
- Mode caps are interpreted by Decision Policy.
- Agent mode does not guarantee tool access; it only allows policy to grant tools when evidence supports it.

## Ownership Boundaries

Owns mode vocabulary and schema.

Does not own route selection, grant compilation, approval UX, or host labels.

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

mode in CreateUserRequestInput -> mode on envelope -> policy cap:

```json
{
  "sessionId": "session-1",
  "mode": "agent",
  "userMessage": "I am in a React app. In src/LoginForm.tsx, when the user clicks the \"Sign in\" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.",
  "referencedArtifacts": [
    { "kind": "file", "name": "LoginForm.tsx", "path": "src/LoginForm.tsx" }
  ],
  "workspace": { "workspaceId": "workspace-1" }
}
```

### Step-By-Step Flow

1. A user sends the real prompt shown above from an editor or chat host.
2. The host attaches workspace id `workspace-1` and the explicit target file `src/LoginForm.tsx`.
3. The module receives the real structure shown in the input block.
4. The module validates schema/version/limits before doing any work.
5. The module extracts the important target: `src/LoginForm.tsx`.
6. The module keeps the user constraint: existing validation and error handling must stay intact.
7. The module performs only its own responsibility and does not cross into neighboring modules.
8. Any budget, path, state, or provider constraint is applied before output is produced.
9. The module records warnings/reason codes instead of hiding degraded behavior.
10. The module returns the realistic output shape shown below.
11. The next pipeline stage consumes that output without reinterpreting raw user text.

### Realistic Output

Interaction Mode policy cap returns a result like this:

```json
{
  "inputMode": "agent",
  "allowedPolicyCeiling": "may_execute_if_policy_grants_tools",
  "ifModeWasAsk": "read_only_answer",
  "ifModeWasPlan": "plan_without_mutation",
  "decisionPolicyEffect": "agent mode permits write grants, but does not require them"
}
```
