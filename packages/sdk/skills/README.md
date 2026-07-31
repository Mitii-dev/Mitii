# Bundled Mitii Skills

Put curated default skills here:

```text
packages/sdk/skills/<skill-id>/SKILL.md
```

These skills are loaded by `createFileSystemSkillsCatalog()` before workspace
skills. A workspace skill with the same `name` overrides the bundled one.

Use the format documented in `docs/SKILLS_FORMAT.md`.
