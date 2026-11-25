# Verification

Gathers post-change evidence: maps files to projects, discovers trusted
checks, executes them through a tool port, normalizes diagnostics, and
recommends completion from that evidence. Does not own mutation or tool
runtime itself.

## Contract

**In:** `VerificationInput` (changed files, projects, grant, pinned state,
verification requirement, optional baseline).  
**Out:** `VerificationResult` (+ optional `RepoBuildState` /
`VerificationRecord`).

| Facade | Stages |
|---|---|
| `verify` | 1-map → 2-discover → 3-select → 4-execute → 5-normalize → 6-inspect → 7-recommend |
| `captureBuildState` / `compareBuildStates` | 8-capture + helpers/compare |
| `buildRecord` / `buildUserSummary` | 9–10 |

Ports (injected): `VerificationToolExecutorPort`,
`VerificationManifestReaderPort`, optional `VerificationRecordStorePort`,
`VerificationSyntaxPort`, `ModuleLoggerPort`.

## Example

```ts
import {
  VerificationPipeline,
  InMemoryManifestReader,
} from "@mitii/v8/modules/verification";

const pipeline = new VerificationPipeline({
  tools,
  manifests: new InMemoryManifestReader({}),
});
const result = await pipeline.verify(input);
```

## Non-responsibilities

Git shelling, tool runtime implementation, decision-policy grants, mutation,
and review finding generation. Language discovery stays under
`helpers/discovery/`.
