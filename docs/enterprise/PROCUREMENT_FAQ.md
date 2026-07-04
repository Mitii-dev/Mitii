# Procurement FAQ

## Deployment Model

Mitii is a VS Code extension with local workspace storage. There is no required Mitii server.

## Supported Platforms

Mitii targets macOS, Linux, and Windows. CI runs `npm test` on `ubuntu-latest`, `macos-latest`, and `windows-latest`.

## Offline And Local Models

Mitii supports OpenAI-compatible localhost providers such as Ollama and LM Studio. Set `mitii.enterprise.localProvidersOnly` to enforce local-only usage.

## Controls Procurement Teams Ask For

| Control | Setting or command |
|---|---|
| Disable session logging | `mitii.telemetry.sessionLogging` |
| Disable verbose diagnostics | `mitii.telemetry.debugMetrics` |
| Require approval for writes | `mitii.safety.requireApprovalForWrites` |
| Require approval for shell | `mitii.safety.requireApprovalForShell` |
| Local providers only | `mitii.enterprise.localProvidersOnly` |
| Strip file contents from audit packs | `mitii.enterprise.stripFileContentsFromAuditPacks` |
| Export review evidence | `Mitii: Export Audit Pack` |

## License

Mitii is licensed under AGPL-3.0-or-later. Commercial licensing questions should use the project contact in the README.

