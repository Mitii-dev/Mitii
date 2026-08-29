# Mitii Settings

Settings live in the Mitii sidebar webview. The left rail is **icons only** when the panel is narrow (≤440px). Hover or focus an icon to see its name in a tooltip. When the panel is wider, the rail shows **icons + labels**.

Click **Save** to persist. Edits stay local until Save, except API key prompts and profile switch, which talk to the host immediately.

VS Code configuration keys use the `mitii.*` prefix. Profiles are stored in `.mitii/profiles.json`. API keys stay in VS Code SecretStorage.

## Pages

| Page | Tab id | What it is for |
|---|---|---|
| Provider | `model` | Connect a model. Open this first. |
| Workspace | `workspace` | Folder + repository index |
| Modes | `modes` | Ask / Plan / Agent defaults and run budget |
| Context | `context` | What is attached to each turn |
| MCP | `integrations` | Optional MCP servers |
| Developer | `debug` | Logging, token-budget tunables, diagnostics |

The index status chip opens **Workspace**. Onboarding and “open settings” open **Provider**.

---

## Provider

Required setup. Connection and credentials are at the top so you do not scroll past the index to find them.

### Connection

| UI field | Setting | Save / reflect |
|---|---|---|
| Provider | `mitii.provider.preset` + `mitii.provider.type` | Saved preset prefills base URL and model. After Save, the same preset is shown. |
| Base URL | `mitii.provider.baseUrl` | Saved as typed. Local hosts do not need a key. |
| Model | `mitii.provider.model` | Dropdown or Custom. Saved model id is reflected exactly. |

### Credentials

| UI field | Storage | Save / reflect |
|---|---|---|
| Set key / Clear | SecretStorage `mitii.provider.apiKey` | Never written to settings JSON. Status shows `configured` or `not set`. |
| Test connection | Host probe | Status pill only. Not a persisted setting. |

Anthropic and Gemini require a key. Echo and local OpenAI-compatible hosts usually do not.

### Token limits

The context window is the only token setting a customer needs. Retrieval, compaction, mutation batches, verification checks, and the derived model-call cap scale from that window. Developer → Token budget is optional.

| UI field | Setting | Save / reflect |
|---|---|---|
| Context window | `mitii.provider.contextWindow` | Type freely, then click **Save**. The field does not write on each keystroke. After Save, the raw number is what you see. `0` means “use the model preset”. |
| Max output | `mitii.provider.maximumOutputTokens` | Same commit rules as context window. `0` derives the output reserve from the window (~20%, floored at 10240 when the window allows so a 30k local cap can still finish a mutation batch). Leave at `0` unless you need a hard override. The legacy default `5000` is ignored so mutation batches are not truncated. |
| Derived budget | Live preview | Usable input, output reserve, model-call cap, files per mutation, verification checks, and a module-share bar. Updates as soon as the context window or max output changes. |
| Reset budgets to defaults | Clears `mitii.tokenBudget.*` | Turns off custom token-budget overrides and restores built-in ratios for the current window. |

Runtime still uses the **effective** window (`0` → model preset, else the stored number). The token meter uses that effective value, not `0`.

---

## Workspace

| UI field | Setting | Save / reflect |
|---|---|---|
| Folder path | Workspace folder | Read-only display of the active root. |
| Open folder | VS Code folder picker | Immediate. |
| Root path override | `mitii.workspace.rootPathOverride` | Saved on Save. Clear override writes empty/null and reflects no override. |
| Reindex / Refresh | Index pipeline | Immediate. Not a setting. |
| Index stats / capabilities | Index snapshot | Read-only diagnostics. |

---

## Modes

### Mode defaults (Ask / Plan / Agent)

Each mode has its own row. Switching the Ask / Plan / Agent control edits that mode only.

| UI field | Setting | Save / reflect |
|---|---|---|
| Thoroughness | `mitii.ui.modeDefaults.<mode>.thoroughness` | Per mode. `low` / `medium` / `high`. Also in the chat composer. Maps to exploration depth + working-set effort unless Developer intensity overrides are on. |
| Approval mode | `mitii.ui.modeDefaults.<mode>.approvalMode` | `safe` (ask) / `guided` (approve for me) / `pilot` (full access). |
| Default model | `mitii.ui.modeDefaults.<mode>.model` | Empty = use the active Provider model. |
| Show reasoning stream | `mitii.ui.showReasoning` | Global, not per mode. |
| Reasoning preview chars | `mitii.ui.reasoningPreviewMaxChars` | 500–50000. Reflected as the saved integer. |

Thoroughness mapping (when overrides are off):

| Thoroughness | Exploration depth | Working set (effort) |
|---|---|---|
| Low | `quick` | `low` |
| Medium | `auto` | `medium` |
| High | `deep` | `high` |

### Run budget

Caps for a single Mitii turn.

| UI field | Setting | Save / reflect |
|---|---|---|
| Unlimited run budget | `mitii.runBudget.unlimited` | When on, the four caps are ignored at runtime. |
| Model calls | `mitii.runBudget.maxModelCalls` | Minimum 1. |
| Tool calls | `mitii.runBudget.maxToolCalls` | Minimum 1. |
| Loop iterations | `mitii.runBudget.maxLoopIterations` | Minimum 1. |
| Wall time (min) | `mitii.runBudget.maxWallTimeMinutes` | Minimum 1. |

These caps are owned here. You do not need to retune them when the context window changes. Developer → Token budget does not override them.

### Log verbosity

Controls how much diagnostic detail lands in the run log (visible via "Export session log" / "Open session log").

| UI field | Setting | Notes |
|---|---|---|
| Log verbosity | `mitii.logVerbosity` | `minimal` (baseline events only), `standard` (adds reason codes and before/after values for clamps and soft failures), `verbose` (default; adds retry/nudge-level detail). Turn this down if exported logs are too noisy — it does not change what the agent does, only what it records. |

---

## Context

| UI field | Setting | Save / reflect |
|---|---|---|
| Repo map | `mitii.ui.contextToggles.repoMap` | Boolean, reflected as saved. |
| Diagnostics | `mitii.ui.contextToggles.diagnostics` | Boolean. |
| Git diff | `mitii.ui.contextToggles.gitDiff` | Boolean. |
| Active editor | `mitii.ui.contextToggles.editor` | Boolean. |
| Open tabs | `mitii.ui.contextToggles.openTabs` | Boolean. Default off. |
| Memory | `mitii.ui.contextToggles.memory` | Boolean. Default on. |
| Memory list | Workspace memory store | Add / delete / clear are immediate host calls. |
| Checkpoints | Checkpoint store | Restore / delete / clear are immediate host calls. |

---

## MCP

| UI field | Setting | Save / reflect |
|---|---|---|
| Enable MCP | `mitii.mcp.enabled` (and/or `.mitii/mcp.json`) | Master switch. Off by default. |
| Installed servers | `mitii.mcp.servers` | Enable, configure, or delete per server. Saved on Save. |
| Store catalog | Built-in catalog | Install copies a server into the workspace list. |

Runtime status (ready / error / disabled) is diagnostic only.

---

## Developer

Leave this off unless you need it. Options are grouped so the page stays scannable as more switches are added.

### Access

| UI field | Setting | Save / reflect |
|---|---|---|
| Enable developer settings | `mitii.developer.enabled` | Unlocks Logging, Intensity, Token budget, and Loop / stall policy editors. |

### Logging

| UI field | Setting | Save / reflect |
|---|---|---|
| Debug logging | `mitii.debug` | When on, Mitii shows the Output channel and prints verbose stacks. Locked until Access is enabled. |
| Log model I/O | `mitii.developer.modelIo` | When on (and Access enabled), writes sanitized model request/response bodies to `.mitii/logs/*-model-io.jsonl`. Not nested under `mitii.debug` (that key is a boolean). Large; may include workspace content — keep local. Command **Mitii: Export Shareable Diagnostic** builds one redacted markdown file under `.mitii/logs/` for pasting into online chat help. |

### Intensity

Leave off unless you need an edge case (for example quick planning with a high repair budget). When overrides are off, Modes → Thoroughness owns both axes.

| UI field | Setting | Save / reflect |
|---|---|---|
| Unlock intensity overrides | `mitii.developer.intensityOverrides` | When on, composer Thoroughness shows Custom until you pick a clubbed level. |
| Working set (effort) | `mitii.ui.effort` | `low` / `medium` / `high`. Editable only while overrides are on. |
| Ask / Plan / Agent depth | `mitii.ui.modeDefaults.<mode>.depth` | `auto` / `quick` / `deep`. Editable only while overrides are on. |

### Token budget

Changing the context window already scales the built-in defaults. Use Simple sliders only when you need a custom value. Custom values stay put when the window changes; everything else follows the window.

| UI field | Setting | Save / reflect |
|---|---|---|
| Custom token budget | `mitii.tokenBudget.enabled` | Turns on when you move a Simple slider or edit an Advanced field. When off, V8 defaults scale from the window. |
| Simple: files per mutation | `mitii.tokenBudget.minUniqueFilesPerCall` and `maxUniqueFilesPerCallCap` | Slider. Follows the context window (`W × outputRatio / 800`) until you set a value; then both min and cap pin to that count. |
| Simple: output reserve | `mitii.tokenBudget.outputRatio` | Slider as a percent of the context window. Unused while Provider → Max output is set. |
| Simple: repository / conversation / plan / skills | `mitii.tokenBudget.*Share` | Sliders. Each row shows that module’s percent of the **context window** and of usable input. |
| Simple: verification checks | `mitii.tokenBudget.verificationChecksBase` and `verificationChecksMax` | Slider. Follows usable input until you set a value. |
| Advanced | `mitii.tokenBudget.<key>` | Core ratios and clamps. Hidden “run cap” keys stay owned by Modes → Run budget. |
| Module split | Live preview | Stacked bar of output, tools, repository, conversation, plan, skills, and system as percent of the current window. |
| Reset budgets to defaults | Clears `mitii.tokenBudget.*` | Same action as Provider → Token limits. Restores window-scaled defaults. |

### Loop / stall policy

Working standards are **window-banded** in Agent Engine (`policy/loopPolicyBands.ts`):

| Band | Context window | Source |
|---|---|---|
| Compact | &lt; 50k | Band overrides on `AGENT_ENGINE_THRESHOLDS` |
| Standard | 50k – &lt; 100k | Base thresholds as-is |
| Wide | ≥ 100k | Band overrides |

Merge order: base → band → optional lab overrides. Enable Custom only to lab-test deltas on the active band. Leave off (or Reset) for deploy. Permanent ship changes go in `loopPolicyBands.ts`, not VS Code settings.

| UI field | Setting | Save / reflect |
|---|---|---|
| Active band (read-only) | Derived from provider context window | Shown in Developer → Loop / stall policy. |
| Custom loop policy | `mitii.loopPolicy.enabled` | When off, Engine uses band standards only. |
| Simple: min re-read calls / ratio / stall nudges | `mitii.loopPolicy.explorationReread*` / `maxExplorationStallNudges` | Exploration stall breaker (lab). |
| Simple: read/mutate pressure | `mitii.loopPolicy.maxReadOnly*` | How long execute may explore before requiring a patch (lab). |
| Advanced | `mitii.loopPolicy.<key>` | Truncation, unfulfilled-execute, rejected-mutation, must-read, verification repair, batch fallbacks (lab). |
| Reset loop policy to standards | Clears `mitii.loopPolicy.*` | Restores shipped band standards for the current window. |

### Diagnostics

Read-only: provider connection, MCP runtime, index token, index mode, preset label. Use **View → Output → Mitii** for logs.

---

## Profiles and Save

The footer is always visible.

| Control | Behavior |
|---|---|
| Profile select | Switches `.mitii/profiles.json` immediately and reloads provider fields. |
| New | Creates a profile from the current provider snapshot. |
| Save | Writes provider, UI, MCP, workspace override, and the active profile. Then the host bootstraps the webview so every field **reflects the stored value**. |

### Reflection rules

1. **Raw fields** (almost everything) show exactly what was saved.
2. **Context window `0`** stays `0` in the field. Runtime and the hint use the effective preset window.
3. **Max output `0`** stays `0` in the field. Runtime derives the reserve.
4. **Secrets** never echo back as text — only configured / not set.
5. **Invalid numbers** clamp to the field minimum on Save (token limits cannot go below 0; run-budget caps cannot go below 1).

---

## Tests

Field-level edit → save → reflect coverage lives in `apps/vscode/tests/settingsFields.test.ts`.
