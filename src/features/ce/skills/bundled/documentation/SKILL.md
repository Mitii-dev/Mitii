---
name: documentation
description: Create or update README, architecture, and API documentation for packages and services. Use for README.md, project structure docs, payloads, and cross-service integration notes — not for unused-dependency audits.
---

# Documentation

## Quick Reference

- Prefer existing README conventions in the same folder before inventing a new template.
- Discover via `list_files`, `read_file` / `read_files`, `package.json`, route/API entry files — not full production builds.
- For **README / package docs**: verify by re-reading the written file for completeness; do **not** run app builds unless the user asks.
- For **Docusaurus / MDX site docs**: inspect config + sidebars, then run the docs build from `package.json`.
- Prefer builtin `read_file` / `write_file` / `apply_patch` over MCP filesystem tools.
- Never call `release_plan_controller` or git release tools for documentation work.

## When to use

* README / “Readme” / “Readfile” requests
* Architecture overviews for a service or monorepo package
* API route + payload documentation
* Cross-project integration notes
* Docusaurus page authoring (see subtype rules below)

## Core rules

1. Classify scope first: single README vs docs site (Docusaurus) vs MDX repair.
2. Read `package.json`, existing README, and top-level source layout before writing.
3. Keep one README job per package unless the user asked for multiple.
4. Include: what the project is, structure, how to run, key APIs/payloads, how it connects to siblings.
5. Do not expand into refactors, dependency cleanup, or release management.
6. Stop when the requested docs files are written and internally consistent.

## README workflow

1. `propose_file_scope` once with the target README path(s) — do not re-propose repeatedly.
2. Discover structure (`list_files`, key configs, main entrypoints).
3. Write or update the README with `write_file` / `apply_patch`.
4. Spot-check by reading the file back; fix gaps.
5. Done — skip lint/build unless asked.

See `references/readme-guide.md` for a recommended outline.

## Docusaurus workflow

1. Inspect `docusaurus.config.*`, `sidebars.*`, navbar, and docs plugin routes.
2. Match existing page conventions (frontmatter, imports, LiveCodeBlock).
3. Update sidebar/navbar when adding a new tree.
4. Verify with the docs build script from `package.json`.

## Out of scope

* `depcheck` / `knip` / unused-dependency audits
* Git commit / release / changelog automation
* Treating every “audit” word as documentation
