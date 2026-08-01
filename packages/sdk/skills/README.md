# Bundled Mitii Skills

Put curated default skills here:

```text
packages/sdk/skills/<skill-id>/SKILL.md
```

These skills are loaded by `createFileSystemSkillsCatalog()` before workspace
skills. A workspace skill with the same `name` overrides the bundled one.

Use the format documented in `docs/SKILLS_FORMAT.md`.

## Packs

- Core defaults: `safety-always`, `ask-concise`, `bugfix-localize`, `planning-default`
- Engineering starter 8 (adapted from addyosmani/agent-skills): see `ENGINEERING_PACK.md`

Edit any `SKILL.md` in place. To override without editing the pack, place a
same-name skill under `<workspace>/.mitii/skills/`.
