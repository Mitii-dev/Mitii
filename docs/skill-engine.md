# Skill Engine

Mitii skills are bounded workflow contributions. They improve task-specific behavior without replacing the planner, unlocking tools, or overriding mode and safety policy.

## Lifecycle

```text
request + mode + route + repository profile
  → metadata retrieval (bounded)
  → deterministic hard filters
  → explainable ranking and pinning
  → zero/one primary + zero/one support
  → lazy content loading
  → mode-specific bounded injection
  → sanitized telemetry
```

The final model prompt never contains the full catalog. `SkillCatalogService.search()` returns a small metadata set, `SkillResolver` reports at most ten candidates, and `SkillInjectionBuilder` loads no more than two skill bodies. Reference files remain on disk until explicitly requested.

## Storage and manifest

The authoritative workspace representation is:

```text
.mitii/skills/<skill-id>/
├── skill.json
├── SKILL.md
└── references/        # optional, data/Markdown only
```

`skill.json` uses schema version `1` and API version `1`. Existing `SKILL.md`-only skills remain compatible; the catalog derives a conservative legacy manifest for them.

The repository abstraction is `SkillRepository`. The first implementation stores documents on disk and writes with temporary-file replacement. Catalog consumers do not depend on this implementation, so metadata can move to SQLite or an installed-package index later without changing mode adapters.

Skills are data and Markdown. Executable entrypoints and escaping reference paths are rejected.

## Selection

Hard filters run before ranking:

- enabled, valid schema, API and edition;
- supported mode, intent, task kind, and subtype;
- repository language/framework/package manager/path;
- required tools and capabilities;
- negative triggers and exclusion pins.

Eligible candidates receive an explainable score from triggers, intent/task specificity, repository facts, priority, pinning, and sanitized historical outcomes. Pinning changes rank but never bypasses hard filters.

The resolver supports an empty result. Ask, Plan, and Agent continue with their normal workflows when no skill qualifies.

## Mode integration

- **Ask** receives read-only investigation, evidence, answer-structure, verification, output, and failure guidance.
- **Plan** receives discovery, planning, risk, step-template, verification, and failure guidance.
- **Agent** receives execution order, restrictions, verification, recovery, output, and failure guidance.

`SkillInjectionBuilder` extracts only common and active-mode sections. Every contribution states that system safety, mode restrictions, and tool policy take precedence.

Ask and Plan remain read-only through their existing tool filters and `ToolExecutor` phase checks. Required tools are eligibility constraints only. A skill cannot add a tool to the offered set.

## Planner independence

The planner consumes a `SkillResolution` plus a rendered contribution. It does not query skill storage or know the ranking algorithm. The stable boundaries are:

- catalog/repository → validated manifests;
- resolver → selected IDs and explanations;
- injection builder → bounded mode contribution;
- planner/mode adapter → contribution text and selected IDs;
- verification engine → declared requirements;
- telemetry → metadata-only events.

A future planner can replace discovery, compilation, or validation while continuing to consume these contracts.

## Internal UI

The Skills workspace is visible only in an Extension Development Host. The webview hides the tab and the controller independently rejects every management operation outside development mode.

It includes:

- searchable catalog;
- JSON manifest and Markdown editor;
- host-side validation and quick-reference preview;
- routing analyzer with filter and score explanations;
- manifest-defined positive/negative tests;
- in-memory sanitized usage analytics.

Skill documents are loaded lazily over request-ID-correlated webview messages and are not included in every UI state snapshot.

## Migration notes

1. Existing `SKILL.md` skills continue to load.
2. Add `skill.json` when structured routing, pinning, tests, or mode constraints are needed.
3. `modes`, `capabilities`, and `requires` remain deprecated compatibility aliases for `supportedModes`, `requiredCapabilities`, and `dependencies`.
4. The old hardcoded route resolver remains a fallback when the Skill Engine is not configured.
5. Plan persistence remains backward compatible; skill snapshots can be added later as optional plan fields.
