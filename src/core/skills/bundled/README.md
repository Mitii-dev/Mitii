# Bundled Mitii skills

These skill playbooks ship inside the VS Code extension and are copied into each workspace at `.mitii/skills/` on first init.

They are **not** downloaded at runtime. Refresh upstream skills with:

```bash
AGENT_SKILLS_SOURCE_DIR=/path/to/agent-skills/skills bash scripts/sync-bundled-skills.sh
```

Edit Mitii-owned skills (e.g. `audit-cleanup/`) directly in this folder, then commit and publish a new extension version.

## Rules vs Skills

| Kind | Purpose | Where to author |
| --- | --- | --- |
| Rules | Always-on policy/conventions injected every turn by `ProjectRulesService` with high context priority. | `.mitii/rules/*.md`, `MITII.md`, `AGENTS.md` |
| Skills | On-demand procedures/playbooks cataloged by `SkillCatalogService`, then loaded with `use_skill` or pre-injected by tier. | `.mitii/skills/*/SKILL.md` |

Decision rule: holds on every task => Rule; workflow for a task type => Skill.
