# Kernel

The kernel is the host-neutral runtime layer. It should coordinate interface contracts, registries, dependency ordering, orchestration, lifecycle, and diagnostics without importing VS Code, Node host adapters, webview code, CE internals, or EE internals. Enforced by `test/architecture/target-boundaries.test.ts`.

Contains: `registries/` (contribution registries — tools, providers, context sources, commands, settings, policies, event sinks, modes, skills, MCP, UI, features), `bootstrap/RuntimeBuilder.ts` (host-neutral composition root), `tools/` (tool execution engine), `llm/` (provider-neutral LLM types and decorators), `telemetry/`, `config/`, `util/`, `policy/`.

`RuntimeBuilder` is built and tested (`test/kernel/runtime-builder.test.ts`) but not yet called by `ThunderController`/`HeadlessAgentHost` — both hosts still construct and register tools/context-sources/providers by hand. See `docs/architecture/enterprise-migration-plan.md` for the remaining-work tracking.
