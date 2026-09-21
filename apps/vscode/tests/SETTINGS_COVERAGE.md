# Settings regression coverage

Run `pnpm test` for the full suite, including the rendered webview tests. Run
`pnpm test:webview` for the settings UI suite alone.

| Suite | What it verifies |
| --- | --- |
| `settingsRoundTrip.test.ts` | Every catalog setting has a VS Code manifest registration (MCP uses the registered parent object). Every enum value, both boolean values, and representative text/numeric edits pass through the actual sidebar settings writer. Configuration and supported host snapshots reflect saved values. Hidden legacy/advanced settings are included here. |
| `sidebarSettingsPersistence.test.ts` | Workspace write target, value normalization/clamping, save/bootstrap ordering, and preservation of provider drafts during connection testing. The configuration mock rejects unregistered keys. |
| `webview-ui/tests/settings.test.tsx` | Mounts the real React App, changes rendered inputs, clicks Save, invokes the actual host writer against an in-memory VS Code configuration adapter, and reads host snapshots back. Scalar inputs are also remounted to verify persistence. Covers provider presets, custom/discovered models, missing-model validation, autocomplete, workspace inputs, all embedding sources, per-mode approvals/models, context switches, run budgets, logging, local loop controls, and both slider/number forms of Simple budgets. |
| `settingsFields.test.ts` | Parsing, clamping, defaults, token-limit calculations, profile reconciliation, mode mappings, and navigation behavior. The former tests that only wrote into a test-local object were replaced by the host/UI suites above. |
| `liveSandboxProcess.test.ts` | Subsequent commands observe access changes on the same process port; explicit sandbox network overrides remain authoritative. |
| `packages/host/src/config/createHostLlmPorts.spec.ts` | Model discovery works before model selection for OpenAI-compatible, Anthropic, and Gemini providers; unsuccessful discovery is not reported as connected. Requests are mocked. |

Access regressions include upgrading a pending approval, upgrading while a model
call is in flight, switching back before the next approval, and preventing a stale
global Full access value from bypassing a new run's mode default.

Index regressions distinguish the last published file count from the current
scan's discovered count, show the stage and truncation state, and preserve unsaved
embedding/file-limit changes when progress messages arrive. Discovered files are
not presented as an exact processed-files progress counter.

These tests use jsdom and a VS Code configuration adapter, not a running VS Code
extension host. Profile and MCP disk storage are mocked in the webview suite; API
key prompts, real provider credentials/networking, native embedding availability,
and installed-extension activation require integration/manual checks. Reload VS
Code after updating the extension manifest so new settings registrations take
effect. The old installed 2.7.x manifest lacks per-mode approval registrations.
