# README outline (enterprise package docs)

Use this as a default skeleton; adapt section names to the repo’s existing style.

1. **Title + one-paragraph purpose**
2. **What this package does** (audience, responsibilities)
3. **Repository / monorepo context** (siblings it talks to)
4. **Tech stack** (runtime, frameworks, key libraries)
5. **Project structure** (tree of important folders only)
6. **Setup & run** (install, env vars by name only — never secret values, scripts)
7. **Architecture** (short diagram or bullet data-flow)
8. **APIs / routes** (method, path, request/response payload shapes)
9. **Data models** (if applicable)
10. **Integrations** (auth, payments, AI providers, queues)
11. **Development conventions** (lint/test commands from package.json)
12. **Troubleshooting** (common failures)

## Verification for README work

- Re-read the README and confirm every user-requested topic is covered.
- Do **not** require `pnpm build` / full app builds for documentation-only changes.
