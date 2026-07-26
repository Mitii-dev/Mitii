# @mitii/vscode

VS Code extension package. Owns `contributes`, `activationEvents`, and `engines.vscode`.

```bash
pnpm --filter @mitii/vscode build
```

## Phase 13 boundary

- Activation composes `@mitii/sdk` (Echo + local understanding ports for smoke).
- Does **not** import legacy `ThunderController` / `src/kernel`.
- Full webview chat, SCM, indexing UX, and settings wiring is **Phase 15**.
- Legacy sources under repo-root `src/extension.ts`, `src/vscode/`, `src/webview-ui/` remain reference until Phase 15 migration deletes them.

## Packaging

`vsce package` runs from this package. Workspace root no longer carries the extension manifest.
