# Window Budget

Window Budget turns an advertised model context window into one proportional token allocation. Every consumer (prompt, retrieval, planning, skills, mutation batches, compaction, run caps) reads the derived `WindowPolicy` instead of hard-coded counts.

## Responsibility

Given `contextWindowTokens`, optional host `maximumOutputTokens`, optional measured tool-schema tokens, and optional policy overrides, produce a validated `WindowPolicy`.

## Input

`WindowBudgetInput`:

- `schemaVersion`: `1`
- `contextWindowTokens`: advertised provider window
- `maximumOutputTokens`: omit or `0` to derive from the window; a positive value is a host override
- `toolSchemaTokens`: omit or `0` to use the fallback; a positive value is a measured tool-JSON cost
- `policy`: optional overrides for every ratio and clamp (developer settings)

## Output

`WindowPolicy`:

- `maximumOutputTokens` / `toolSchemaTokens` / `usableInputTokens` / `loopInputBudgetTokens`
- `sections`: repository, conversation, plan, skills, system
- `compaction`: warn/auto/hard ratios, how much tool history to keep, live
  tool-result content budget, compacted result/argument budgets, dropped-turn
  summary budget, observation size/count, and memory/observation reinjection
  budgets
- `mutation`: files per call and patch payload size (scaled from output)
- `planning`: diagnostic step cap and whether a visible plan / change-impact gate is affordable
- `run`: suggested model/tool call caps
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

Worked defaults (`outputRatio=0.10`, tool fallback 8k / 20% of W):

| Window | Output | Tools | Usable | Repo | Plan | Skills |
|---|---|---|---|---|---|---|
| 30k | 3,000 | 6,000 | ~21k | ~5.9k | ~1.3k | ~0.8k |
| 100k | 8,000 | 8,000 | ~84k | ~23.5k | ~5.0k | 2.4k cap |
| 200k | 8,000 | 8,000 | ~184k | 51.5k | 8k cap | 2.4k cap |

Mutation batch size follows **output**, not file-count guesses:

```text
maxUniqueFilesPerCall = clamp(O / filesPerOutputTokens, minFiles, maxFiles)
maxPatchesPerCall     = clamp(files × 2, files, maxPatchesPerCallCap)
maxPatchPayloadCharacters = O × charsPerOutputToken × patchPayloadOutputRatio
preferredBatchSize    = maxUniqueFilesPerCall
```

Planning affordances follow **usable input**, scaled with the window so a 30k local cap still plans:

```text
visiblePlanThreshold      = min(visiblePlanMinUsableTokens, W × visiblePlanMinUsableRatio)
changeImpactThreshold     = min(changeImpactMinUsableTokens, W × changeImpactMinUsableRatio)
visiblePlanAffordable     = U >= visiblePlanThreshold
changeImpactAffordable    = U >= changeImpactThreshold
maxSkills                 = clamp(maxSkillsBase + U / maxSkillsPerUsable, base, cap)
maxDiagnosticSteps        = clamp(base + U / perUsable, base, max)
maxModelCalls             = clamp(U / maxModelCallsPerUsable, min, max)
```

A 30k local window still gets the `maxModelCallsMin` floor (48) so package-scale
repair can run many small turns. Host `runBudget.unlimited` is not clamped.

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

The VS Code host maps Debug → developer → **Custom token budget** onto `policy` overrides. Each field is also a `mitii.tokenBudget.*` setting. When the toggle is off, V8 defaults apply. When it is on, every ratio and cap is editable and persisted. Reset clears those overrides.

`mitii.provider.maximumOutputTokens = 0` means “derive O from the window”. A positive value is a host override and still cannot exceed `W − 1`.

## Explicit non-responsibilities

- Does not construct prompts, retrieve files, grant tools, or run the model loop.
- Does not own provider capability discovery (Model Gateway advertises `W`).
- Does not persist settings (the host maps developer options onto `policy`).
