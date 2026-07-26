# @mitii/vscode

VS Code extension package. Owns `contributes`, `activationEvents`, and `engines.vscode`.

```bash
pnpm --filter @mitii/vscode build
pnpm --filter @mitii/vscode package
```

## Phase 15 host surface

- `@mitii/sdk` only (no legacy kernel / ThunderController)
- Chat: InputBox + Output Channel + sidebar WebviewView
- Cancel / clarify / approve via progress + QuickInput
- Settings → provider ports; API key via SecretStorage `mitii.provider.apiKey` or env
- Index / commit-message / session export commands
- Full React `webview-ui` polish deferred (see roadmap Phase 15 deferrals)

Release: `docs/RELEASE.md`
