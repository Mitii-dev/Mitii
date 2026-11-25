# Request Intake

**One job:** raw host request → trusted `UserRequestEnvelope`.

```text
CreateUserRequestInput  →  RequestIntakePipeline.intake() / intakeDetailed()  →  UserRequestEnvelope
```

No LLM. No file reads. No session storage.

---

## How to read this folder

```text
request-intake/
  pipeline/RequestIntakePipeline.ts   ← start here — THIS is where the flow is called
  actions/
    1-sanitize.ts                     ← step shelf (re-exports helper today)
    2-classify-command.ts
    3-extract-mentions.ts
    4-normalize-attachments.ts
    5-resolve-mode.ts
    6-build-envelope.ts
  helpers/                            ← real implementations (temporary; see brief)
  policy/                             ← limits, modes, slash catalogs
  constants.ts                        ← REQUEST_INTAKE_STAGES (logger + docs)
  contracts/                          ← input + envelope types + ModuleLoggerPort
  tests/{unit,contract}
```

**Where is the flow called?** Only in `pipeline/RequestIntakePipeline.ts` → `intakeDetailed()`  
(steps 1→6, in order). Opening `actions/N-*.ts` today shows exports; bodies still live under `helpers/` until the inline pass (tracked below).

---

## Flow

1. **Sanitize** text  
2. **Classify** leading `/commands`  
3. **Extract** `@path` mentions → artifact stubs  
4. **Normalize** image attachments  
5. **Resolve** ask / plan / agent mode  
6. **Build** `UserRequestEnvelope`

---

## Owns / does not own

**Owns:** validation, sanitize, slash classify, mentions, attachment policy, mode resolve, envelope shape, stage logging.

**Does not own:** understanding intent, grants, loading `@path` contents, `/compact` execution, transcript storage (engine/host rewrite).

---

## Host must pre-fill

| Host signal | Field |
|---|---|
| Selection | `referencedArtifacts` (`kind: "selection"`) |
| @-picker / tabs | `referencedArtifacts` (`kind: "file"` / `"folder"`) |
| Images | `attachments[]` |
| Steer / follow-up | `turnKind` |

---

## Public API

```ts
new RequestIntakePipeline({ clock, idGenerator, log }).intakeDetailed(input)
```

Prefer `intakeDetailed` when the engine needs `shortCircuitMeta` / `warnings`.

---

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/request-intake
```

---

# Refactor brief (module 2)

## What changed

- Unified layout toward the same pattern as window-budget: `pipeline/` + numbered `actions/` + `policy/` + `contracts/` + `tests/`.
- Moved former top-level domains (`sanitize`, `command-classify`, `mention-extract`, `attachment-normalize`, `interaction-mode`, `request-envelope`) under `helpers/`.
- Added numbered `actions/` shelf that matches pipeline order (1→6).
- Added `policy/` glance shelf for limits, modes, and slash/meta catalogs.
- Added `constants.ts` with `REQUEST_INTAKE_STAGES` (same names as action files / logger events).
- Added optional `ModuleLoggerPort`; `intakeDetailed` emits one stage event per step.
- Restored `createUserRequestInputSchema` limits to the real constant keys (`MAXIMUM_MESSAGE_CHARACTERS`, …).
- Collocated tests under `tests/{unit,contract}` (vitest).

## Why it changed

- Intake had many sibling folders with no single “start here” story.
- The engine and hosts need a stable envelope + short-circuit flag without caring about internal folders.
- Without stage logs, “why did mode become plan?” / “why did /stop short-circuit?” was guesswork.
- Module cleanup must stay readable **before** the engine rewrite.

## How we refactored it

1. Kept public contracts (`CreateUserRequestInput` → `UserRequestEnvelope` + `RequestIntakeResult`).
2. Left orchestration only in `RequestIntakePipeline.intakeDetailed()`.
3. Numbered the six steps to mirror call order.
4. Parked implementations under `helpers/` and re-exported through `actions/` (compat shelf).
5. Re-exported policy tables from `policy/` without changing values.
6. Wired optional logger; `composeV8Engine` can pass `intake.log`.
7. Contract + unit tests green.

## How constants / texts were moved

| Kind | Home |
|---|---|
| Envelope limits / defaults / origins / turn kinds | `helpers/request-envelope/constants.ts` → re-exported via `policy/` + module `index` |
| Agent modes | `helpers/interaction-mode/constants.ts` → `policy/` |
| Slash / meta command catalogs | `helpers/command-classify/constants.ts` → `policy/` (`BUILTIN_META_COMMAND_SPECS`, `MODE_SLASH_COMMANDS`) |
| User-facing validation messages | `REQUEST_ENVELOPE_MESSAGES.*` (no inline prose in schemas beyond references) |
| Stage names for logs | `REQUEST_INTAKE_STAGES` in module `constants.ts` |

Rule: add catalog/limit/message constants next to their policy owner; export through `policy/` / public `index`. Do not invent new magic strings in the pipeline.

## How logger helps identify problems

Inject `log` on the pipeline (or via `composeV8Engine({ intake: { log } })`):

```ts
new RequestIntakePipeline({
  clock,
  idGenerator,
  log: {
    stage(event) {
      // event.module === "request-intake"
      // event.stage === "1-sanitize" … "6-build-envelope"
      // event.reasonCodes, inputSummary, outputSummary, durationMs
    },
  },
}).intakeDetailed(input)
```

| Symptom | Look at |
|---|---|
| Mode flipped unexpectedly | `2-classify-command` (`slashMode`) then `5-resolve-mode` (`hostMode` vs `mode`) |
| `/stop` / `/compact` didn’t short-circuit | `2-classify-command` `shortCircuitMeta` + `metaName` |
| Missing @file artifact | `3-extract-mentions` `extractedCount` / `mergedCount` |
| Image dropped | `4-normalize-attachments` `reasonCodes` (warnings) + `kept` |
| Empty / oversized reject | fails before/at validate — check input schema limits, not logger |
| Slow intake | `durationMs` per stage |

## How to extend the module

| Goal | Where |
|---|---|
| New slash mode (`/ask`, …) | `MODE_SLASH_COMMANDS` in command-classify constants + mode schema if needed |
| New meta command (`/foo`) | `BUILTIN_META_COMMAND_SPECS` (+ lifecycle) |
| New attachment mime | `SUPPORTED_IMAGE_MIME_TYPES` + normalize policy |
| New artifact kind | envelope schema/types + mention extract if parseable |
| New turn kind / session action | envelope constants + schemas |
| New pipeline step | new numbered `actions/N-…`, call it from `intakeDetailed`, add `REQUEST_INTAKE_STAGES` + logger event + test |
| New stable stage/reason string | `constants.ts` / policy constants first |

Do not put LLM / file IO / session storage here.

## If something breaks later — how to fix

1. Reproduce with the smallest `CreateUserRequestInput` (message, mode, artifacts, meta).
2. Run with an injected logger — see which stage’s `outputSummary` diverges.
3. Fix at the owner: parse bug → helper/action for that step; limit/message → policy constants; envelope shape → contracts/schema.
4. Add a regression under `tests/unit` or `tests/contract`.
5. Re-run `pnpm exec vitest run packages/v8/src/modules/request-intake`.

## Bugs fixed while redesigning

| Bug | Fix |
|---|---|
| Input schema referenced non-existent limit keys (`MAX_MESSAGE_LENGTH`, …) so oversized messages were accepted | Restored `MAXIMUM_MESSAGE_CHARACTERS` / `MAXIMUM_*` keys matching envelope constants |
| Empty-request / attachment edge rules drifted from original contract | Restored original `createUserRequestInputSchema` refine semantics |
| No stage visibility for mode/meta/attachment drops | `ModuleLoggerPort` stage events on every step |

## Room left for improvement

- **Inline helpers into numbered `actions/`** so opening `2-classify-command.ts` shows the real function (match window-budget). Tracked as `RI-ACTIONS-INLINE`.
- Move envelope/mode **schemas** fully under `contracts/` (helpers keep algorithms only).
- Engine hosts should always prefer `intakeDetailed` + shared logger adapter.
- Optional richer reason codes (e.g. `attachment_dropped_mime`) instead of free-text warnings in logs.

## Verification

`pnpm exec vitest run packages/v8/src/modules/request-intake` → contract + unit (incl. logger stage order) passed.
