# Engineering skills pack (starter 8)

Adapted from [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) into Mitii’s `SKILL.md` format (`docs/SKILLS_FORMAT.md`).

These are **bundled defaults** under `packages/sdk/skills/`. Edit them in place. Replace any skill by overwriting its folder, or override per workspace without touching the pack.

## Included (phase 1 + automation)

| Skill | Conflict group | Primary intents |
|---|---|---|
| `spec-driven-development` | define | feature, scaffold, migrate, question |
| `planning-and-task-breakdown` | planning | feature, bugfix, … (plan-heavy) |
| `incremental-implementation` | build | feature, refactor, migrate, scaffold |
| `test-driven-development` | verify | test, bugfix, feature, refactor |
| `debugging-and-error-recovery` | debug | bugfix, diagnose, trace |
| `code-review-and-quality` | review | review, audit, refactor |
| `security-and-hardening` | review | security, audit, feature |
| `git-workflow-and-versioning` | ship | feature, bugfix, refactor, docs, migrate |
| `cicd-agent` | verify | test, bugfix, feature, config (CI/PR automation) |
| `incident-triage` | debug | bugfix, diagnose, trace (logs → ticket) |

Mitii still injects **at most a few** skills per turn (metadata mode). Long playbooks stay on disk; only frontmatter + `# Planning` enter the prompt.

## Edit

1. Open `packages/sdk/skills/<skill-id>/SKILL.md`
2. Change Mitii fields (`intents`, `routes`, `priority`, `when`, `instruction`) or the `# Planning` block
3. Edit `# Playbook` for the full workflow text
4. Set `enabled: false` to keep the file but skip loading

## Replace one skill

Overwrite:

```text
packages/sdk/skills/<skill-id>/SKILL.md
```

Or drop a same-`name` file here (wins over bundled):

```text
<workspace>/.mitii/skills/<skill-id>/SKILL.md
```

## Replace the whole pack

1. Delete the eight folders listed above (leave `safety-always`, `ask-concise`, `bugfix-localize`, `planning-default` unless you intend to change those too)
2. Copy new `<skill-id>/SKILL.md` trees into `packages/sdk/skills/`
3. Keep Mitii frontmatter (`intents`, `routes`, `when`, `instruction`, `# Planning`)

## Disable workspace uploads while testing bundled pack

```bash
MITII_DISABLE_WORKSPACE_SKILLS=1 mitii ask "…"
```

VS Code: `"mitii.skills.workspace.enabled": false`

## Refresh from upstream

No npm package install. Pull markdown only, then re-adapt frontmatter:

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/addyosmani/agent-skills.git /tmp/agent-skills
cd /tmp/agent-skills && git sparse-checkout set skills/<skill-id>
# Copy body under # Playbook; keep Mitii frontmatter + # Planning
```

## License

Upstream skills are MIT (addyosmani/agent-skills). Keep attribution comments in each `SKILL.md`.
