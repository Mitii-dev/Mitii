# Mitii Serve Protocol

`mitii serve` runs one daemon per bound workspace. It exposes a loopback-first HTTP API plus per-session SSE event streams.

Default bind: `127.0.0.1:4310`.

## Security

- Loopback is the default.
- Binding to `0.0.0.0` or another non-loopback host requires `--insecure-bind`.
- Non-loopback binds also require `--token` or `MITII_SERVER_TOKEN`.
- Clients authenticate with `Authorization: Bearer <token>`.
- CORS is denied unless `--allow-origin` is set.
- Daemon actions are appended to `.mitii/daemon/audit.jsonl`.

## Routes

`GET /health`

```json
{ "ok": true, "version": "2.7.31", "cwd": "/repo", "sessions": 1 }
```

`GET /capabilities`

```json
{
  "features": ["sessions", "sse", "permissions", "cancel", "subagents", "worktrees"],
  "maxSessions": 5,
  "supportedModes": ["ask", "plan", "agent", "review"],
  "eventReplay": true
}
```

`POST /session`

```json
{ "cwd": "/repo", "mode": "agent", "approval": "manual", "runtime": "real" }
```

`GET /sessions`, `GET /session/:id`, and `DELETE /session/:id` list, inspect, and close sessions.

`POST /session/:id/prompt`

```json
{ "mode": "agent", "message": "Fix the failing test", "attachments": [] }
```

Returns `202` once the prompt is accepted. Results stream through SSE.

`GET /session/:id/events`

SSE frames use `id`, `event`, and JSON `data` fields. Reconnect with `Last-Event-ID` to replay buffered missed events.

```text
id: 7
event: assistant_delta
data: {"type":"assistant_delta","content":"I found the issue"}
```

`POST /session/:id/permissions/:approvalId/respond`

```json
{ "decision": "approved" }
```

`POST /session/:id/cancel` aborts an in-flight turn.

## Error Shape

```json
{ "error": { "code": "workspace_mismatch", "message": "Daemon is bound to ..." } }
```

Common statuses: `400` workspace mismatch, `401` auth failure, `404` missing session, `409` concurrent prompt, `503` session limit.
