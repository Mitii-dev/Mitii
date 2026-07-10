# Daemon Security

`mitii serve` is designed for local development first.

- It binds to `127.0.0.1` by default.
- Non-loopback binds require both `--insecure-bind` and a bearer token.
- Bearer tokens are compared with constant-time comparison.
- CORS is opt-in through `--allow-origin`.
- Session `cwd` values are canonicalized and must match the daemon-bound workspace.
- Session lifecycle, prompts, cancellation, and permission responses are logged to `.mitii/daemon/audit.jsonl`.

For enterprise-managed installs, prefer a per-user daemon, managed token provisioning, local provider policy enforcement, and workspace-level audit pack export.
