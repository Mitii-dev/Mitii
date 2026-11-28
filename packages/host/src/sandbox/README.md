# Host sandbox glue

OS process isolation lives in **`@mitii/sandbox`**. This folder only:

1. Re-exports the package public surface for `@mitii/host` consumers.
2. Adds `buildHostSandboxPolicy` — loads `.mitii/safety.json` protected paths
   and delegates to `buildSandboxPolicy`.

Do not put backends, adapters, or wrap logic here.
