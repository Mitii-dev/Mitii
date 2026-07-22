## ModePolicy

```text
Task intent = what the user wants
Mode = what the agent is currently allowed to do
Interaction intent = requested response behavior
```

For example, the same bug can appear in every mode:

| Mode  | User request            | Interaction | Task       |
| ----- | ----------------------- | ----------- | ---------- |
| Ask   | “Why is login failing?” | `question`  | `diagnose` |
| Plan  | “Plan how to fix login” | `plan`      | `bugfix`   |
| Agent | “Fix the login failure” | `act`       | `bugfix`   |

You should not create three separate versions of `bugfix`.


# Should the mode be sent to the LLM?

Not necessarily.

The LLM should determine the user’s requested interaction from the message:

```text
"Explain this"     → question
"Plan this"        → plan
"Implement this"   → act
```

Then the deterministic mode policy applies the application constraint:

```text
Ask mode   → force question
Plan mode  → force plan
Agent mode → preserve inferred interaction
```

This is more reliable than asking the LLM to enforce mode behavior.

## Example outcomes

### Ask mode

```ts
{
  mode: 'ask',
  userMessage: 'Fix the authentication bug.',
}
```

Raw classifier:

```json
{
  "interactionIntent": "act",
  "primaryTaskIntent": "bugfix"
}
```

After mode policy:

```json
{
  "interactionIntent": "question",
  "primaryTaskIntent": "bugfix"
}
```

Meaning:

> Discuss or explain the requested bug fix without modifying files.

### Plan mode

```ts
{
  mode: 'plan',
  userMessage: 'Implement passwordless login.',
}
```

After policy:

```json
{
  "interactionIntent": "plan",
  "primaryTaskIntent": "feature"
}
```

Meaning:

> Create a plan for the feature without implementing it.

### Agent mode

```ts
{
  mode: 'agent',
  userMessage: 'Explain how authentication works.',
}
```

Result:

```json
{
  "interactionIntent": "question",
  "primaryTaskIntent": "question"
}
```

### Agent implementation

```ts
{
  mode: 'agent',
  userMessage: 'Add passwordless login.',
}
```

Result:

```json
{
  "interactionIntent": "act",
  "primaryTaskIntent": "feature"
}
```

# One catalog improvement

Your task intent named `question` overlaps with the interaction intent named `question`.

This is valid but can be confusing:

```json
{
  "interactionIntent": "question",
  "primaryTaskIntent": "question"
}
```

A cleaner task-intent name would be:

```text
general
```

or:

```text
explain
```

For example:

```json
{
  "interactionIntent": "question",
  "primaryTaskIntent": "general"
}
```

But this rename is optional. Your generalized catalog can remain unchanged for now.

The correct architecture is therefore:

```text
Generalized Task Catalog
          ↓
Rule or LLM Classification
          ↓
ModeIntentPolicy
          ↓
IntentResolver
          ↓
Skills and execution elsewhere
```
