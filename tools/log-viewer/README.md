# Mitii Log Viewer

Standalone browser tool under `tools/` — not part of the VS Code extension or
the `@mitii/solid-benchmark` package.

Two modes in one server:

1. **Logs** — inspect `.mitii/logs` (model I/O + session timelines)
2. **Benchmark** — start/stop suites, run selected cases, live logs, re-run failures

## Run

```sh
pnpm log-viewer
```

Open the printed URL (default `http://127.0.0.1:8797`).

Jump straight to the runner:

```sh
pnpm log-viewer -- --benchmark
# or
node tools/log-viewer/server.mjs --benchmark --no-open
```

Optional paths:

```sh
pnpm log-viewer -- --root /path/to/repo
pnpm log-viewer -- --benchmark-root /path/to/tests/benchmark
pnpm log-viewer -- --port 8797
```

## Logs mode

- Enter a repo path or `.mitii/logs` path and click **Load**.
- Or click **Choose repo folder** and select a repo directory.
- Pick a `*-model-io.jsonl` file to see each model turn with formatted Input
  and Output.
- Pick a normal session `.jsonl` file to inspect the run timeline.

The viewer highlights bug signals such as provider errors, non-stop finish
reasons, invalid tool-call JSON, truncated payloads, missing request/response
pairs, failed runs, failed tools, and failed verification events.

## Benchmark mode

Open **Benchmark** in the top nav (or `/benchmark`).

| Action | Control |
|--------|---------|
| Live run console | Fullscreen modal (auto on start/refresh while running) |
| Activity feed | Left drawer — toggle **☰** / **L** |
| Collapse Runs / Inspector | Header chips **Runs** / **Inspector** |
| Re-run one case | **Re-run** on any results row |
| Provider / fixtures | **Provider**, **Reset fixtures** |

First time in this folder:

```sh
cd tools/log-viewer && npm install
```

Then from Mitii root:

```sh
pnpm log-viewer -- --benchmark
```

Hard-refresh (`Cmd+Shift+R`) after updates. Activity is restored on refresh from the server log buffer (and session backup).
