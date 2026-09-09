# Mitii Skills Format

Mitii supports two skill locations:

```text
packages/sdk/skills/<skill-id>/SKILL.md
```

Use this for **Mitii-curated default skills** that ship with the product.

```text
<workspace>/.mitii/skills/<skill-id>/SKILL.md
```

Use this for **workspace/user-uploaded skills**.

The load order is:

```text
1. SDK-bundled Mitii skills
2. Host-provided bundled skill roots
3. Workspace-uploaded skills
4. Extra uploaded roots
```

A later skill with the same `name` overrides an earlier one. This means your
50 default skills can ship with Mitii, while advanced users can override a
single skill by uploading another `SKILL.md` with the same `name`.

V8 never reads these files directly; the host loads them through
`SkillsCatalogPort`.

## Progressive disclosure

Mitii treats every skill as three layers:

| Layer | Loaded When | Contents |
|---|---|---|
| L1 index | Always available to host-side matching | `id`, `title`, `description`, intents, routes, tags, path globs, priority, conflict group, resource manifest |
| L2 body | Only after the L1 entry is selected | The markdown body of `SKILL.md`, injected as the selected skill instruction |
| L3 resources | Only on demand through normal tools | Files under `references/` and scripts under `scripts/` |

By default, filesystem catalogs list only compact L1 metadata:

```text
Skill: Null Crash Debugging
Description: Find and fix nullable-value crashes with a small regression test.
Use when: The user reports a null crash; A regression test is needed
Instruction: Keep the patch localized and verify the failing path.
```

The markdown body can contain the full playbook. The V8 `SkillsPipeline` matches
on L1, resolves conflicts, then hydrates L2 for selected skills only. The final
skills budget is charged against hydrated L2 content, so omitted skills surface
with reasons such as `budget`, `conflict`, or `empty_content`.

L3 resource manifests are advisory. A selected skill may tell the model that
`references/foo.md` or `scripts/repro.ts` exists, but Skills never reads or runs
them. Normal ToolGrant/path scopes/command rules still decide whether any
resource can be read or executed.

## Required shape

```md
---
name: null-crash-debugging
title: Null Crash Debugging
description: Find and fix nullable-value crashes with a small regression test.
intents: [bugfix, diagnose]
routes: [execute, diagnose]
tags: [null, crash, test]
priority: 150
conflictGroup: debugging
alwaysApply: false
enabled: true
when: [The user reports a null crash, A regression test is needed]
instruction: Keep the patch localized and verify the failing path.
---

# Full Playbook

You can write detailed examples, checklists, references, and scripts here.
Mitii keeps this body out of the prompt by default.
```

## Fields

| Field | Required | Purpose |
|---|---:|---|
| `name` | Yes | Stable skill id. Use lowercase kebab-case. |
| `title` | No | Human-friendly name. Defaults to `name`. |
| `description` | Yes | Compact model-facing summary. Keep it one sentence. |
| `intents` | No | Task intents that activate this skill. Standard skills may omit this and rely on stronger title/description keyword matching. |
| `routes` | No | Decision routes that activate this skill. |
| `tags` | No | Query keywords that boost matching. |
| `paths` | No | Workspace-relative globs that gate a skill, for example `**/parse.ts` or `apps/vscode/**`. |
| `languages` | No | Soft language tags from host/repository evidence. Boost only. |
| `projectKinds` | No | Soft project-kind tags from host/repository evidence. Boost only. |
| `sizeClass` | No | Packer hint: `S` (tiny), `M` (default working), `L` (full playbook). Compact windows may omit `L`. |
| `requireTagEvidence` | No | When `true`, also require query/tag or recommended-tag overlap (not intent alone). Use for niche skills like CI. |
| `priority` | No | Higher wins when multiple skills match. Default `100`. |
| `conflictGroup` | No | Allows only one selected skill from that group. |
| `alwaysApply` | No | Use rarely. Default `false`. |
| `enabled` | No | Set `false` to keep a skill on disk but skip loading it. Default `true`. |
| `when` | No | Compact activation hints injected in metadata mode. |
| `instruction` | No | One short instruction injected in metadata mode. |
| `license` | No | agentskills.io-compatible metadata. Parsed but not model authority. |
| `compatibility` | No | agentskills.io-compatible metadata. Parsed but not model authority. |
| `allowed-tools` | No | Upstream advisory field. Mitii ignores it unless Decision Policy independently grants matching tools. |

Mitii accepts minimal agentskills.io-style skills with only `name` and
`description`. Mitii extensions are optional.

Package authoring should keep `name` at 64 characters or fewer and
`description` at 1024 characters or fewer for agentskills.io compatibility.

## Resource folders

Optional resources live beside `SKILL.md`:

```text
.mitii/skills/null-crash-debugging/
  SKILL.md
  references/checklist.md
  scripts/repro.ts
```

The catalog exposes only the relative manifest. Reading references and running
scripts remains a tool-runtime decision; skill text cannot broaden ToolGrant,
path scopes, allowed hosts, or command rules.

## Optional planning block

Skills may include a compact planning template in the markdown body. In
metadata mode, Mitii extracts only this small block, not the whole playbook.

Use one of these headings:

```md
# Agent Discovery
# Planning
# Plan Template
```

Then add phase names with bullet steps:

```md
# Agent Discovery

Discover:
- Locate current behavior
- Collect evidence

Change:
- Choose non-hardcoded extension approach
- Implement smallest coherent change

Verify:
- Run lint/typecheck/tests
```

When this skill is selected, V8 treats these as planning hints. V8 still
validates, budgets, and normalizes the final plan; skills never grant tools or
permissions.

Valid `routes`:

```text
direct_answer, repository_answer, clarify, diagnose, plan, execute
```

Common `intents`:

```text
bugfix, feature, refactor, optimize, diagnose, test, audit, review,
security, trace, scaffold, migrate, schema, mock, config, dependency,
docs, style, format, question
```

## Authoring guidance

Keep `description`, `when`, and `instruction` small. Those fields are the
token-sensitive part. Put longer examples in the markdown body.

Prefer one focused skill per intent or workflow. For a 50-skill pack, use
`conflictGroup` to prevent near-duplicates from loading together, for example
`debugging`, `testing`, `migration`, or `docs`.

## Forcing a skill for one run

Explicit attachment bypasses relevance matching but not policy or tool grants.

Prompt (VS Code / CLI):

```text
@skill:module-doc-generator
Generate docs for test/Tablet
```

Slash alias (first line only):

```text
/module-doc-generator
Generate docs for test/Tablet
```

CLI:

```bash
mitii ask "Generate docs" --skill module-doc-generator
```

Automation agent (`.mitii/agents/<id>.md` frontmatter):

```yaml
skills: cicd-agent, module-doc-generator
```

SDK / engine start input:

```json
{ "requiredSkillIds": ["module-doc-generator"] }
```

Forced skills pack first, do not count toward `maxSkills`, and win conflict
groups over optional matches. If a forced skill cannot fit the skills budget
even in compact form, the run continues with a warning and omission reason
`required_budget`.

VS Code also supports pinning up to three skills from the chat composer: click
**`/`** or type **`@skill:`** for autocomplete. Pinned skills show as chips
above the input for the next message.

## Skipping Skills

To skip one uploaded skill without deleting it:

```yaml
enabled: false
```

To run CLI without workspace-uploaded skills:

```bash
MITII_DISABLE_WORKSPACE_SKILLS=1 mitii ask "explain this repo"
```

To run VS Code without workspace-uploaded skills, set:

```json
{
  "mitii.skills.workspace.enabled": false
}
```

This disables only workspace-uploaded skills. Mitii-bundled default skills still
load unless the host explicitly passes `includeBundled: false`.
