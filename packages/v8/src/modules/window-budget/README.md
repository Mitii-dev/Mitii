# Window Budget

Window Budget turns an advertised model context window into one proportional token allocation. Every consumer (prompt, retrieval, planning, skills, mutation batches, compaction, run caps) reads the derived `WindowPolicy` instead of hard-coded counts.

## Responsibility

Given `contextWindowTokens`, optional host `maximumOutputTokens`, optional measured tool-schema tokens, optional `effort` (`low` | `medium` | `high`, default `medium`), and optional policy overrides, produce a validated `WindowPolicy`.

## Input

`WindowBudgetInput`:

- `schemaVersion`: `1`
- `contextWindowTokens`: advertised provider window
- `maximumOutputTokens`: omit or `0` to derive from the window; a positive value is a host override
- `toolSchemaTokens`: omit or `0` to use the fallback; a positive value is a measured tool-JSON cost
- `policy`: optional overrides for every ratio and clamp (developer settings)
- `effort`: optional working-set overlay; omit to use `medium`

## Output

`WindowPolicy`:

- `effort`: `low` | `medium` | `high` (default `medium`)
- `maximumOutputTokens` / `toolSchemaTokens` / `usableInputTokens` / `loopInputBudgetTokens`
- `sections`: repository, conversation, plan, skills, system
- `compaction`: warn/auto/hard ratios plus absolute `autoMaxTokens` /
  `hardMaxTokens` ceilings from the effort overlay, how much tool history to keep, live
  tool-result content budget, compacted result/argument budgets, dropped-turn
  summary budget, observation size/count, and memory/observation reinjection
  budgets
- `mutation`: files per call and patch payload size (scaled from output)
- `planning`: diagnostic step cap and whether a visible plan / change-impact gate is affordable
- `run`: model/tool call caps and `maxVerificationRepairs` from the effort overlay
- `skills`: skill body budget and max selected skills
- `maxVerificationChecks`
- `resolvedPolicy`: the full policy after defaults + overrides
- `reasonCodes`: how output and tool cost were chosen

## How tokens are distributed

```text
W  = contextWindowTokens
O  = host override, or clamp(W × outputRatio, outputMin, min(outputMax, W × outputWindowCapRatio))
T  = measured tool schemas, or min(fallbackTokens, W × fallbackWindowRatio)
     then T is capped so W − O − T stays at least minimumUsableInputTokens when possible
U  = W − O − T                  // usable input
loop = U × loopSafetyRatio
```

Tool JSON is treated as a **fixed cost**. Shares below are of `U`, not of `W`:

| Slice | Share of U | Cap |
|---|---|---|
| Repository context | `repositoryShare` | `repositoryTokensCap` |
| Conversation / loop history | `conversationShare` | none |
| Plan text | `planShare` | `planTokensCap` |
| Skills | `skillsShare` | `skillsTokensCap` |
| System + rules | remainder | none |

Worked defaults (`outputRatio=0.20`, `outputMinTokens=10240`,
`outputWindowCapRatio=0.35`, tool fallback 8k / 20% of W):

| Window | Output | Tools | Usable | Repo | Plan | Skills |
|---|---|---|---|---|---|---|
| 30k | 10,240 | 6,000 | ~13.8k | ~3.9k | ~0.8k | ~0.6k |
| 100k | 20,000 | 8,000 | ~72k | ~20k | ~4.3k | ~2.9k |
| 200k | 32,768 | 8,000 | ~159k | ~45k | ~9.5k | ~6.4k |

Mutation batch size follows the **context window**, then the effort overlay
caps it so a 200k model does not keep 25-file patches:

```text
windowFiles            = (W × outputRatio) / filesPerOutputTokens
maxUniqueFilesPerCall  = clamp(windowFiles, minFiles, min(maxFilesCap, effort.maxUniqueFilesPerCall))
maxPatchesPerCall      = clamp(files × 2, files, maxPatchesPerCallCap)
maxPatchPayloadCharacters = O × charsPerOutputToken × patchPayloadOutputRatio
preferredBatchSize     = maxUniqueFilesPerCall
```

Medium effort (the default): 30k → 7 files, 48k → 8 files, 200k → 8 files
(not 25). High effort raises the 200k cap to 12; low effort lowers it to 4.

Planning affordances follow **usable input**, scaled with the window so a 30k local cap still plans:

```text
visiblePlanThreshold      = min(visiblePlanMinUsableTokens, W × visiblePlanMinUsableRatio)
changeImpactThreshold     = min(changeImpactMinUsableTokens, W × changeImpactMinUsableRatio)
visiblePlanAffordable     = U >= visiblePlanThreshold
changeImpactAffordable    = U >= changeImpactThreshold
maxSkills                 = clamp(maxSkillsBase + U / maxSkillsPerUsable, base, cap)
maxDiagnosticSteps        = clamp(base + U / perUsable, base, max)
maxModelCalls             = effort overlay (medium: 40)
```

Effort also sets compaction ceilings (`autoMaxTokens` / `hardMaxTokens`) and
`run.maxVerificationRepairs` (medium: 8). Host `runBudget.unlimited` is still
clamped to these window-effort loop caps.

Decision Policy then merges profile mutation budgets with these window caps using `min()` (and ORs `requireBatchedExecution`).

Compaction budgets also follow `U` so a 300k window retains more useful
tool-history memory than a 30k window before rereading. Tool-history sizing is
derived from ratios and clamped by developer-tunable min/max fields:

```text
keepRecentToolResults      = clamp(U × keepRecentToolResultsRatio, min, max)
compactedToolResultChars   = clamp(U × compactedToolResultCharsRatio, min, max)
compactedToolArgumentChars = clamp(U × compactedToolArgumentCharsRatio, min, max)
toolResultContentChars     = clamp(U × toolResultContentCharsRatio, min, max)
droppedTurnSummaryChars    = clamp(U × droppedTurnSummaryCharsRatio, min, max)
establishedFactChars       = clamp(U × establishedFactCharsRatio, min, max)
maxEstablishedFacts        = clamp(U × establishedFactCountRatio, min, max)
establishedFactReinject    = clamp(U × establishedFactReinjectCharsRatio, min, max)
memoryReinjectChars        = clamp(U × memoryReinjectCharsRatio, min, max)
```

Agent Engine consumes these derived values directly. It does not reintroduce
separate fixed caps for tool-result serialization, dropped tool summaries, or
mid-run observation reinjection.

## Pipeline stages

1. Validate input schema.
2. Merge host policy overrides onto defaults.
3. Derive or accept output reserve.
4. Charge tool-schema tokens as a fixed cost.
5. Split remaining usable input by shares.
6. Derive mutation, planning, skills, run, and verification numbers from `O` / `U`.
7. Validate the output contract.

## Dependencies and ports

None. Pure function of the input contract. No LLM, filesystem, or host APIs.

## Public exports

- `deriveWindowPolicy`
- `mergeWindowBudgetPolicy`
- `DEFAULT_WINDOW_BUDGET_POLICY` / `WINDOW_BUDGET_POLICY`
- `WINDOW_BUDGET_EFFORTS` / `DEFAULT_WINDOW_BUDGET_EFFORT` / `WINDOW_BUDGET_EFFORT_OVERLAY` / `resolveWindowBudgetEffort`
- `windowBudgetInputSchema`, `windowBudgetPolicySchema`, `windowPolicySchema`
- inferred types and `WindowBudgetError`

## Failure modes

- `invalid_input`: schema/version/limit failure. No partial policy is returned.

## Genericness strategy

- No provider, model, language, or host names.
- Every numeric behavior is a named policy field.
- Hosts tune via `policy` overrides; they do not fork the algorithm.

## Developer settings

The customer knob is the advertised context window. Built-in defaults already scale every derived budget from that window. Hosts should not require users to edit ratios.

The VS Code host maps Developer → **Token budget** onto `policy` overrides. Simple sliders cover files per mutation, output reserve, module shares, and verification checks. Advanced keeps the core ratios and clamps. Each field is also a `mitii.tokenBudget.*` setting. When the toggle is off, V8 defaults apply and scale with the context window. Moving a Simple slider turns custom budget on and pins that value so later window changes do not overwrite it. Reset clears those overrides.

`mitii.provider.maximumOutputTokens = 0` means “derive O from the window”. A positive value is a host override and still cannot exceed `W − 1`. The historical default `5000` is treated as unset (`output_legacy_default_ignored`) so mutation batches are not truncated. `O` is the planning reserve (input must not fill the window). Per-turn `max_tokens` is leftover context, owned by Prompt Construction / Agent Engine, unless the host overrode output.

## Explicit non-responsibilities

- Does not construct prompts, retrieve files, grant tools, or run the model loop.
- Does not own provider capability discovery (Model Gateway advertises `W`).
- Does not persist settings (the host maps developer options onto `policy`).
