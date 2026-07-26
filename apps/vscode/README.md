# @mitii/vscode

VS Code extension package. Owns `contributes`, `activationEvents`, and `engines.vscode`.

```bash
pnpm --filter @mitii/vscode build
pnpm --filter @mitii/vscode package
```

## Phase 17 host surface

- `@mitii/sdk` only (no legacy kernel / ThunderController)
- Chat: InputBox + Output Channel + sidebar WebviewView
- Cancel / clarify / approve via progress + QuickInput
- Provider settings: `mitii.provider.type|baseUrl|model` (echo or openai-compatible)
- API key: `Mitii: Set Provider API Key` → SecretStorage `mitii.provider.apiKey`, or env
- Default in-memory skills catalog via SDK `createDefaultSkillsCatalog`
- Index / commit-message / session export commands
- Full React `webview-ui` polish deferred

F5: `docs/INITIAL_LAUNCH.md` · Release: `docs/RELEASE.md`
