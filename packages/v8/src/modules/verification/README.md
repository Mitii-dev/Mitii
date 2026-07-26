# Verification

```text
Input:  VerificationInput { changedFiles, projects, verification, grant, pinnedState, changeScope }
Output: VerificationResult { status, checks, diagnostics, diff, reasonCodes }
```

Owns affected-project selection, applicable-check discovery, proportional
selection, Tool Runtime execution, diagnostic normalization, and the
evidence-only completion recommendation.

Does not spawn shells or touch the filesystem directly.

## Public API

| Export | Role |
|--------|------|
| `VerificationPipeline` | Public facade (`verify`) |
| `verificationInputSchema` / `VerificationInput` | Boundary input |
| `verificationResultSchema` / `VerificationResult` | Boundary result |
| `InMemoryManifestReader` | Test/host helper for trusted manifest reads |

```ts
const pipeline = new VerificationPipeline({
  tools: { execute: (input, options) => toolRuntime.execute(input, options) },
  manifests: new InMemoryManifestReader({ "package.json": "..." }),
});

const result = await pipeline.verify({
  schemaVersion: 1,
  workspaceRoot: "/repo",
  pinnedState: { workspaceId: "ws", stateToken: "tok" },
  changedFiles: ["src/app.ts"],
  projects: [{ projectId: "root", rootPath: ".", primaryLanguageId: "typescript" }],
  verification: { required: true, minimumEvidence: ["typecheck", "tests"], allowUnavailable: false },
  grant,
  changeScope: "localized",
});
```

## Flow

```text
VerificationInput
  → validate contracts
  → map changed files → projects/languages
  → discover checks from trusted manifests (language adapters)
  → select proportionally by change scope + required evidence
  → execute selected checks through Tool Runtime
  → normalize diagnostics across tools
  → inspect diff and stale-state risk
  → recommend verified_success | implemented_unverified | verification_failed | blocked | cancelled
```

## Policy highlights

- No universal hardcoded test command — discovery requires project evidence.
- Missing tools degrade to `unavailable` and never become success.
- Failed / skipped / timed-out / cancelled checks never become `verified_success`.
- Narrow changes keep narrow checks; `cross_cutting` / `public_api` expand.
- Only Verification may authorize `verified_success`.

## Language discovery

Adapters cover TypeScript/JavaScript, Python, Java, Kotlin, C#, Go, Rust,
C/C++, Ruby, PHP, Swift, Shell, and SQL. Unsupported or absent tooling returns
explicit unavailable/degraded evidence.

## Do not put here

- Direct shell/filesystem access (use Tool Runtime + manifest port)
- Route/authority decisions (`decision-policy`)
- Patch application (`tool-runtime` / Phase 8)
- Agent run loop (`agent-engine`)

## Tests

```bash
pnpm exec vitest run packages/v8/src/modules/verification
```
