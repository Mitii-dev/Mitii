# Prompt Construction

Prompt Construction builds the provider-neutral `ModelRequest` that is sent through Model Gateway. It combines policy, user message, conversation, repository context, skills, memory, optional plan text, tools, and model capabilities under a strict token budget.

## What This Module Does

- Validates `PromptConstructionInput`.
- Reserves output tokens before allocating input budget.
- Caps the final output limit at the window-derived reserve after prompt
  assembly. Leftover context can only shrink that cap.
- Builds system/developer/user/tool conversation messages.
- Serializes repository context into bounded prompt blocks.
- Injects selected skill and memory instruction blocks.
- Includes optional approved plan text.
- Adds filtered tool definitions.
- Reports budget, provenance, omissions, warnings, and reason codes.

## Structure

```text
prompt-construction/
  pipeline/                 PromptConstructionPipeline
  actions/                  Budgeting, tool serialization, context serialization
  contracts/
    input/                  PromptConstructionInput
    output/                 PromptConstructionResult, budgets, provenance
    ports/                  TokenEstimatorPort
    errors/                 PromptConstructionErrors
  internal/                 Token estimator and injection boundary helpers
  tests/
```

## Types And Contracts

- `PromptConstructionInput`: decision, user message, conversation, optional repository context, instructions, plan text, tools, model capabilities, model options, and output reserve.
- `PromptConstructionResult`: status, `ModelRequest`, budget report, provenance entries, omissions, warnings, and reason codes.
- `PromptRepositoryContext`: state token plus prompt-safe blocks.
- `PromptInstructions`: project rules, skills, and memory instruction blocks.
- `PromptBudgetReport`: context window, output reserve, section budgets, and limit status.

## Technical Details

- The public facade method is `PromptConstructionPipeline.construct`.
- Repository retrieval internals never enter the prompt path directly.
- Trust/provenance metadata distinguishes system, repository, skills, memory, plan, user, and tool content.
- Output reserve is calculated before context allocation, then the final
  `ModelRequest.maximumOutputTokens` is resolved after concrete prompt usage is
  known.
- The final output limit is recomputed every turn from the remaining context
  window. The window-derived reserve is the ceiling. Leftover input room can
  only shrink that cap so a 30k local window cannot spend ~18k tokens on one
  truncated patch.
- For example, a 30k context window with a 12k prompt and a 3k window-derived
  reserve resolves to 3k output tokens for that turn, not
  `floor((30k - 12k) * 0.95)`.
- If the assembled prompt consumes more than the planned input budget, output is
  reduced to fit the remaining context window instead of forcing a truncation.
- Sections can be omitted or truncated with explicit reason codes.
- Tool definitions are supplied after Agent Engine filters them by grant.

## Ownership Boundaries

Owns prompt assembly, budget allocation, provenance, omissions, and output headroom.

Does not own policy grants, repository retrieval, model HTTP, tool execution, or verification.

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/prompt-construction
```

## Example Flow

This example uses a realistic coding-agent request and shows the kind of structure this module receives and returns. The output is representative: ids, timings, and scores are examples, but the shape matches how this module is meant to be understood.

### Real Prompt

```text
I am in a React app. In src/LoginForm.tsx, when the user clicks the "Sign in" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.
```

### Real Input Structure

PromptConstructionInput -> PromptConstructionResult:

```json
{
  "prompt": "I am in a React app. In src/LoginForm.tsx, when the user clicks the \"Sign in\" button, show a loading label and disable the button until the login request finishes. Keep the existing validation and error handling. Add or update a focused test if there is already a LoginForm test nearby.",
  "workspaceId": "workspace-1",
  "stateToken": "state-abc",
  "targetFile": "src/LoginForm.tsx"
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

Prompt Construction result returns a result like this:

```json
{
  "schemaVersion": 1,
  "status": "complete",
  "request": {
    "model": "gpt-5-codex",
    "maximumOutputTokens": 12000,
    "toolChoice": "auto",
    "messages": [
      { "role": "system", "content": "You are Mitii Agent..." },
      { "role": "user", "content": "<user_request>...loading state...</user_request>" }
    ],
    "tools": [{ "name": "read_file", "description": "Read a workspace file", "inputSchema": { "type": "object" } }]
  },
  "budget": { "contextWindowTokens": 128000, "outputReservedTokens": 4096, "inputBudgetTokens": 123904, "withinLimits": true },
  "provenance": [{ "blockId": "repo:src/LoginForm.tsx", "section": "repository", "source": "repository-context", "trust": "untrusted_repository_content" }],
  "omissions": [],
  "warnings": [],
  "reasonCodes": ["output_reserved_first", "within_provider_limits"]
}
```
