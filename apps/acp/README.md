# `@mitii/acp`

**ACP-lite bridge** for Mitii. Stdio JSON-lines protocol — **not** the full Agent Client Protocol.

Decision Policy remains authority; **V8 does not import ACP.**

```bash
pnpm --filter @mitii/acp build
mitii-acp
# or
node apps/acp/bin/mitii-acp.js
```

## Protocol (v1)

One JSON object per line on stdin / stdout.

| Direction | Shape |
|---|---|
| → | `{ "op": "ping", "id"?: string }` |
| ← | `{ "op": "pong", "id"?: string }` |
| → | `{ "op": "prompt", "id", "prompt", "mode"?: "ask"\|"plan"\|"agent" }` |
| ← | `{ "op": "event", "id", "event" }` (per RunEvent) |
| ← | `{ "op": "result", "id", "result" }` |

Startup emits `{ "op": "ready", "protocol": "mitii-acp-lite", "version": 1 }`.

Smoke path uses `EchoLlmPort` via `createMitiiClient` (same authority stack as CLI/VS Code). Host wiring stays thin; full provider/MCP ports can be added later without pulling ACP into V8.

Architecture: `apps/acp` → `@mitii/sdk` / `@mitii/host` → `@mitii/v8`. Does not import `apps/cli`.
