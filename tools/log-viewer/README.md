# Mitii Log Viewer

Standalone browser viewer for Mitii logs. This stays under `tools/` and is not
part of the VS Code extension bundle.

## Run

```sh
pnpm log-viewer
```

Open the printed URL, normally:

```text
http://127.0.0.1:8797
```

Optional repo path:

```sh
pnpm log-viewer -- --root /path/to/repo
```

## Use

- Enter a repo path or `.mitii/logs` path and click **Load**.
- Or click **Choose repo folder** in the browser and select a repo directory.
- Pick a `*-model-io.jsonl` file to see each model turn with formatted Input
  and Output.
- Pick a normal session `.jsonl` file to inspect the run timeline.

The viewer highlights bug signals such as provider errors, non-stop finish
reasons, invalid tool-call JSON, truncated payloads, missing request/response
pairs, failed runs, failed tools, and failed verification events.
