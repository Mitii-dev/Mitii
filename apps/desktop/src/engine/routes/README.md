# Engine routes

HTTP route modules for the desktop engine. `server.ts` only dispatches through `index.ts`.

- **Input:** `RouteContext` (`req`, `res`, `method`, `path`, `url`, `token`, `cwd`, `options`, `workspaceWatcher`) from `../http/types.ts`.
- **Output:** JSON (`sendJson`) or NDJSON (`/v1/prompt`, `/v1/resume`, workspace events, reindex/pull streams).
- **Table:** each module exports `<feature>Routes: readonly Route[]` (exact `path`, or `match` for param routes); `index.ts` concatenates them and exposes `findRoute`.
- **Modules:** health, chat, skills, mcp, recipes, workspace, git, provider, memory, checkpoints, profiles, history, indexStatus, evidence.
- **Auth:** every `/v1/*` handler calls `requireAuth` itself; `/health` is open.
- **Failure modes:** unknown route → 404 `not_found`; uncaught handler error → 500 `internal` (logged via `route_failed`).
- **Non-responsibilities:** agent authority (stays in `MitiiClient`), feature logic (lives in `engine/<feature>/` and `@mitii/host`).
