# Bundled Mitii skills

These skill playbooks ship inside the VS Code extension and are copied into each workspace at `.mitii/skills/` on init. Bundled-named workspace copies are refreshed when the extension's bundled source changes.

They are **not** downloaded at runtime. Refresh upstream skills with:

```bash
AGENT_SKILLS_SOURCE_DIR=/path/to/agent-skills/skills bash scripts/sync-bundled-skills.sh
pnpm run skills:validate
```

Edit Mitii-owned skills (e.g. `audit-cleanup/`, `documentation/`, `git-*`, `log-audit/`) directly in this folder, then commit and publish a new extension version.

## Skill layout

```text
bundled/<skill-name>/
├── SKILL.md
├── skill.json        # optional routing/manifest metadata for Skill Engine
├── scripts/          # optional helpers
└── references/       # optional schemas / guides
```

`skill.json` is optional but recommended. When present, it must match `SkillManifestSchema` (`schemaVersion: 1`) and is used by the Skill Engine for selection, conflicts, injection limits, and routing tests. `SKILL.md` frontmatter `description` must stay in sync with `skill.json` `description` (≤240 chars).

## Rules vs Skills

| Kind | Purpose | Where to author |
| --- | --- | --- |
| Rules | Always-on policy/conventions injected every turn by `ProjectRulesService` with high context priority. | `.mitii/rules/*.md`, `MITII.md`, `AGENTS.md` |
| Skills | On-demand procedures/playbooks cataloged by `SkillCatalogService`, then loaded with `use_skill` or pre-injected by the pipeline (0–1 active). | `.mitii/skills/*/SKILL.md` |

Decision rule: holds on every task => Rule; workflow for a task type => Skill.

Turn policy for which skill is active lives in `src/features/ce/pipeline/skills/skillResolver.ts`. When Skill Engine is configured (normal VS Code / headless hosts), `skill.json` manifests participate in scoring, conflict resolution, and injection strategy and override the hardcoded route resolver for the turn.

## Invocation

1. **Catalog** — every skill appears as `name: description` (description capped at **240** chars).
2. **Pipeline pre-injection** — `resolveSkillsForRoute` picks **at most one** active playbook (`injectSkills`). Meta skill `using-agent-skills` is deferred (load via `use_skill` only).
3. **`use_skill`** — on-demand full playbook load, capped at **24k** chars.

For `quick-ref` tiers, include a top-level `## Quick Reference` (or `## Overview`) section.

## Authoring checklist (enterprise)

- [ ] Folder name = frontmatter `name` (kebab-case)
- [ ] Valid `---` / `---` YAML frontmatter with `name` + `description`
- [ ] Description ≤ 240 chars, third person, includes WHAT + WHEN (+ Do not use when helpful)
- [ ] Optional `skill.json` matches frontmatter description and `SkillManifestSchema`
- [ ] `## Quick Reference` near the top
- [ ] Keep `SKILL.md` lean (target ≤ ~8k chars); put deep detail in `references/*.md` and link one level deep
- [ ] No dangling `references/` links
- [ ] Wired into routing when the skill should auto-load (`actSkillRouting` / `planSkillRouting` / `selectGitSkills`) or covered by Skill Engine manifest tests
- [ ] `pnpm run skills:validate` passes
