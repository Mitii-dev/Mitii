# Running `mitii serve`

Start a local daemon:

```bash
mitii serve --cwd /path/to/repo
```

With auth:

```bash
openssl rand -hex 32 > ~/.mitii-serve-token
MITII_SERVER_TOKEN="$(cat ~/.mitii-serve-token)" mitii serve --cwd /path/to/repo
```

Health check:

```bash
curl http://127.0.0.1:4310/health
```

Create a session:

```bash
curl -X POST http://127.0.0.1:4310/session \
  -H "content-type: application/json" \
  -d '{"cwd":"'"$PWD"'","mode":"agent","approval":"manual"}'
```

Stream events:

```bash
curl -N http://127.0.0.1:4310/session/<id>/events
```

The daemon is useful when VS Code, terminal clients, SDK scripts, and future board UIs need to share one long-running runtime.
