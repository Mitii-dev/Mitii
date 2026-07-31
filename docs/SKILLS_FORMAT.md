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

## Default injection behavior

By default, Mitii injects only compact metadata for selected skills:

```text
Skill: Null Crash Debugging
Description: Find and fix nullable-value crashes with a small regression test.
Use when: The user reports a null crash; A regression test is needed
Instruction: Keep the patch localized and verify the failing path.
```

The markdown body can contain your full playbook for future use, but it is not
sent to the model in the default `metadata` mode. This keeps token use low even
when the catalog grows to 21, 50, or more skills.

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
| `intents` | Yes | Task intents that activate this skill. |
| `routes` | No | Decision routes that activate this skill. |
| `tags` | No | Query keywords that boost matching. |
| `priority` | No | Higher wins when multiple skills match. Default `100`. |
| `conflictGroup` | No | Allows only one selected skill from that group. |
| `alwaysApply` | No | Use rarely. Default `false`. |
| `enabled` | No | Set `false` to keep a skill on disk but skip loading it. Default `true`. |
| `when` | No | Compact activation hints injected in metadata mode. |
| `instruction` | No | One short instruction injected in metadata mode. |

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
