# Mitii memory: selective adaptation from ZeroClaw

Analysis date: 2026-09-28. Scope: the local Mitii working tree and `/Users/codewithshinde/Applications/workspace/ai-agents/modules-ref/zeroclaw-master`. Mitii HEAD was `8b90c7e217aa4007681558f0a02675dc1c3686eb`; the reference directory has no Git metadata, so no ZeroClaw revision can be asserted. Existing unrelated working-tree changes were left alone.

This is a source review and adaptation design, not an implementation. Mitii tests and focused synthetic probes were run; ZeroClaw was inspected statically. Performance benefits below are expectations to measure, not benchmark results.

**Recommendation:** retain Mitii's domain model, file-aware retrieval, host ports, approval queue, and graph separation. Adapt ZeroClaw's persistence, boundary enforcement, bounded reranking, maintenance, and extraction patterns. Reliability, identity, and authority should precede more autonomous learning.

## 1. What actually exists

### Mitii

The runtime path is:

```text
Host supplies store and embedding adapter
  -> executeStartEnrichment: workspace-scoped, layered retrieval
  -> MemoryPipeline: validate, query, filter, rank, budget, touch access
  -> prompt construction: memory instruction fragments
  -> provider request

CLI / VS Code tool completion capture
  -> heuristic observation
  -> observations.json + pending.json (default)
  -> approval -> MemoryPipeline.commit -> fact store

Graph tools -> KnowledgeGraphManager -> separate graph store
```

Mitii has structured types, concepts, file associations, privacy, explicit expiry, source IDs, version/supersession links, importance, and access history. Retrieval combines BM25, file matches, and optional vectors through reciprocal rank fusion (RRF), then mixes retention. Default limits are 600 estimated tokens and five facts; the engine explicitly selects layered mode.

Desktop and CLI use `.mitii/memory/facts.json`; VS Code uses workspace Memento. Observations, pending drafts, audits, and graph state are additional persistence surfaces. The MCP web package also has an optional, independent reader of `facts.json`.

Sources: [domain contracts](../../packages/v8/src/modules/memory/contracts/output/MemoryFact.ts), [retrieval](../../packages/v8/src/modules/memory/actions/RetrieveMemory.ts), [engine wiring](../../packages/v8/src/engine/agent-engine/pipeline/executeStartEnrichment.ts), [capture](../../packages/host/src/ports/memoryCapture.ts), [VS Code store](../../apps/vscode/src/memoryStore.ts), [MCP reader](../../packages/mcp/web/src/memory/handleMemoryTool.ts).

### ZeroClaw

The active memory implementation is principally in `crates/zeroclaw-memory`, with contracts in `crates/zeroclaw-api` and injection in `crates/zeroclaw-runtime/src/agent/memory_inject.rs`. Features include SQLite FTS5 and stored embeddings, embedding caching, multiple backend implementations, agent/principal scope wrappers, configurable write/read screening, model-driven consolidation, bounded optional MMR reranking, retention/budget maintenance, snapshots, and a SQLite graph.

Important limits on this comparison:

- `retrieval.rs` explicitly says its FTS/vector stage names and early-return score are inert. Its implemented addition is an optional per-handle recall cache, off by default. This is not a working staged retrieval system to transplant.
- Reranking is implemented but gated; default injection keeps the decay path. Typed fact extraction is also gated. Availability does not mean enabled behavior.
- ADR-010, separating session history, curated memory, and enrichment, is **proposed**, with outstanding acceptance gates. No `MemoryEnricher` implementation was found in the inspected memory/API directories. Adopt the authority principle as a design target, not as proof of a completed ZeroClaw integration.
- Its conflict helper also uses similarity as a proxy for conflict. It does not solve semantic contradiction reliably.
- Its recall cache documents lack of cross-handle/process coherence. Agent scoping deliberately permits certain legacy unattributed rows. These compatibility decisions should not become new Mitii defaults.

Reference sources: [factory](../../../modules-ref/zeroclaw-master/crates/zeroclaw-memory/src/lib.rs), [SQLite](../../../modules-ref/zeroclaw-master/crates/zeroclaw-memory/src/sqlite.rs), [retrieval decorator](../../../modules-ref/zeroclaw-master/crates/zeroclaw-memory/src/retrieval.rs), [reranker](../../../modules-ref/zeroclaw-master/crates/zeroclaw-memory/src/rerank.rs), [authority ADR](../../../modules-ref/zeroclaw-master/docs/book/src/architecture/decisions/ADR-010-memory-authority-boundaries.md).

## 2. Comparison and disposition

| Area | Mitii today | ZeroClaw reference | Mitii decision |
|---|---|---|---|
| Domain facts | Rich coding-oriented metadata and version links | Categories, optional kinds, keys, scope metadata | Keep Mitii types; add specific missing provenance and lifecycle fields |
| Retrieval | BM25 + file + vector RRF | Backend hybrid recall; optional reranker | Keep file stream and RRF; add bounded final diversity selection |
| Persistence | JSON/Memento; per-instance queues | SQLite/FTS5 plus other backends | Add one host-owned transactional SQLite implementation |
| Embeddings | Embeds candidate facts during every retrieval | Stored vectors, content cache, embedder identity handling | Adapt caching with explicit model/profile identity |
| Capture | Heuristic traces and human approval | Model-driven summary/fact extraction | Extract evidence-backed atomic drafts; preserve approval |
| Privacy | Fact-content redaction, conditional requester check | Scanned and scoped wrappers | Centralize all memory boundary checks; distinguish trust from approval |
| Prompt | Layered facts become system instruction fragments | Unified origin-sensitive injection | Central injection policy with evidence semantics and provenance |
| Conflicts | First high-Jaccard match is superseded | Recall/text similarity conflict candidates | Use similarity only to propose candidates; explicit replacement authority |
| Maintenance | Observation cap, duplicate consolidation, leases | Retention, category budgets, pinning, snapshots | Add lifecycle-specific budgets, recoverability, and explicit purge |
| Graph | Separate entity/relation JSON model | Typed SQLite nodes/edges | Add evidence and stable IDs incrementally; keep graph deliberate |
| Evaluation | Small deterministic fixtures | Broader tests across wrappers/backends/runtime | Expand production-mode and failure-boundary coverage |

## 3. Immediate correctness and authority fixes

### A. Corruption must not become an empty writable database — P0

`FileWorkspaceMemoryStore.readFacts()` returns `[]` on invalid JSON or an invalid envelope. A later `commit()` reads that empty list and renames a new envelope over the old file. The comment saying corruption cannot wipe durable memory does not match the behavior. A synthetic corrupt-envelope probe confirmed replacement with only the new fact.

The mutation queue is per store instance. It serializes calls through that object, not other host instances or processes. UI helpers create new instances. Unique temporary files and atomic rename prevent some partial-file problems, but do not make read-modify-write transactional or guarantee power-loss durability.

`MemoryPipeline.commit()` marks the old fact non-latest before writing its replacement, through two calls. A probe that failed the second write left no latest fact. Merely reversing the calls would exchange one inconsistency for another.

**Change:** first distinguish missing, valid, partially recoverable, corrupt, and unsupported-version states. Preserve corrupt bytes and deny mutation until recovery. Then introduce an atomic change-set API: replacement plus supersession plus revision validation in one transaction. Serialize preparation with persistence or use compare-and-swap with retry; batching already-prepared stale decisions is insufficient.

**Injection points:** [file store](../../packages/host/src/ports/memoryStore.ts), [store port](../../packages/v8/src/modules/memory/contracts/ports/MemoryPorts.ts), [commit orchestration](../../packages/v8/src/modules/memory/pipeline/MemoryPipeline.ts). Adapt transaction/recovery ideas from ZeroClaw SQLite, not its entire backend matrix.

**Acceptance:** injected interruption at each mutation boundary; two processes updating one workspace; concurrent approvals and appends; unknown schema preservation; no missing active replacement or silently overwritten data.

### B. Redact before every persistence surface — P0

Fact commits redact `content`. Capture writes its generated narrative to observations and pending storage before passing through the commit pipeline. Synthetic probes confirmed `<private>` content survived in both stores. A separate probe confirmed an explicit title retained private content even when the fact body was redacted.

This means approving fewer facts does not prevent sensitive capture. Graph observations are another independently persisted payload that needs the same review; the graph manager does not itself apply fact redaction.

**Change:** create a shared sanitization/validation boundary used before observations, pending drafts, facts, graph content, exports, and embedding requests. Cover titles and other free-text fields, not only bodies. Keep source references and hashes where the original payload is unnecessary. Add read-time eligibility checks for legacy records and quarantine questionable content. Screening is a mitigation, not a proof that arbitrary text is safe.

**Reference:** ZeroClaw [ScannedMemory](../../../modules-ref/zeroclaw-master/crates/zeroclaw-memory/src/scanned.rs) demonstrates write/read decorators and bounded refill after filtering. Its scanning is configurable; do not assume all modes are enabled.

**Acceptance:** synthetic private spans/secrets absent from all persisted and provider-bound fields, including pending data; legacy blocked rows do not consume all recall slots; audit records contain IDs and reason codes rather than raw sensitive payloads.

### C. Separate remembered evidence from instruction authority — P0

The engine maps memory blocks to generic prompt instructions, dropping their structured provenance. `InstructionBlockFragment` uses role `system` and trust `trusted_instruction`, including memory. XML-like memory markers identify fragments but do not lower their authority.

An approved memory can be useful and still be stale, misclassified, or derived from an untrusted tool result. Approval to retain a fact is not permission for it to override the current task or grant tools.

**Change:** introduce a memory evidence fragment with preserved source IDs, timestamps, scope, and confidence/validation state. Render recalled content as data using the existing prompt framework's supported roles/trust handling. State that current applicable instructions and verified current repository state govern conflicts. Escape delimiters and metadata. Keep any intentionally configured durable user instructions on a separately authorized instruction path.

**Injection points:** [engine enrichment](../../packages/v8/src/engine/agent-engine/pipeline/executeStartEnrichment.ts), [fragment implementation](../../packages/v8/src/modules/prompt-construction/internal/fragments/builtInFragments.ts), [system assembly](../../packages/v8/src/modules/prompt-construction/actions/BuildSystemAndConversation.ts).

Adopt ZeroClaw's single origin-aware injection decision from [memory_inject.rs](../../../modules-ref/zeroclaw-master/crates/zeroclaw-runtime/src/agent/memory_inject.rs): explicit policy for interactive work, scheduled jobs, and delegated work. Do not copy its blanket ACP/Code isolation decision; Mitii is a coding agent, and appropriately scoped coding memory is valuable.

**Acceptance:** malicious stored instructions cannot change tool grants; a current user correction wins over an old preference; background jobs and delegated tasks receive only explicitly eligible memories; provenance survives through the actual provider request path.

### D. Scope and eligibility must agree across hosts and tools — P0/P1

The private filter rejects mismatched owners only when both a stored user ID and `requesterUserId` are present. A probe confirmed that a private, user-attributed workspace fact passes without a requester. The engine's workspace retrieval does not provide a requester. This establishes a permissive contract; it is not evidence of an exploited multi-user endpoint.

There is also concrete identity drift:

- CLI defaults to `config.workspaceId ?? 'cli_workspace'`.
- Desktop hashes the resolved root with SHA-256 into `ws_...`.
- VS Code uses a different SHA-1 ID and stores facts in Memento.

Consequently, sharing a physical workspace does not automatically mean sharing retrievable memory. Path moves and worktrees need explicit policy too.

The optional MCP web reader discards `expiresAt`, `isLatest`, and scope metadata during soft parsing, then ranks shareable rows. A probe confirmed expired, superseded facts can be returned there even though the main pipeline filters them.

**Change:** define a canonical workspace/repository identity resolver and host-bound access context. Keep identity resolution distinct from authorization. Missing identity for genuinely user-private facts should deny recall; migrate ambiguous old private workspace rows under an explicit policy. Share eligibility logic across engine, UI, graph, export, and MCP surfaces, or make MCP consume a host-produced eligible projection with a clear version contract.

**Sources:** [CLI](../../apps/cli/src/ports.ts), [Desktop](../../apps/desktop/src/engine/workspace-id.ts), [VS Code](../../apps/vscode/src/ports.ts), [privacy filter](../../packages/v8/src/modules/memory/actions/RetrieveMemory.ts), [MCP parser](../../packages/mcp/web/src/memory/softParseFacts.ts), ZeroClaw [agent wrapper](../../../modules-ref/zeroclaw-master/crates/zeroclaw-memory/src/agent_scoped.rs) and [principal wrapper](../../../modules-ref/zeroclaw-master/crates/zeroclaw-memory/src/principal_plane.rs).

## 4. Retrieval improvements worth adapting

### E. Make embeddings incremental and cancellable — P1

Every retrieval constructs a BM25 index, embeds the query, and then awaits an embedding for every eligible fact sequentially. The host adapter calls the provider with a one-element batch. Two retrievals over two unchanged facts produced six embedding calls in the probe.

The default hash embedding is lexical hashing, not a learned semantic embedding. `resolveMemoryEmbeddingPort()` falls back to it, including for the bundled backend case. Labeling every vector-assisted result as semantic quality would be misleading.

**Change:** persist derived vectors by `(embeddingProfileId, dimensions, preprocessingVersion, embeddedTextHash)`, where the hash covers title, body, concepts, and files. Compute changed facts on commit/background indexing, batch provider requests, and embed only the query on a warm retrieval. Add deadline/cancellation propagation, finite-vector validation, bounded retries, and BM25/file fallback. Do not hold a transaction open during network embedding calls.

Mitii already has a profile-keyed [SQLite embedding cache](../../packages/v8/src/modules/repository-state/internal/embedding/SqliteEmbeddingVectorCache.ts). Extract an appropriate shared port/helper or reuse through public ownership boundaries; do not import another module's internals into memory. ZeroClaw's cache provides additional reference for bounds and invalidation, but copying its content-hash-only key would be weaker than retaining explicit profile identity.

At larger sizes, use incremental FTS/candidate retrieval instead of loading the entire store. Preserve Mitii's code-aware tokenization, synonyms, and file matching: SQLite FTS5 is not automatically equivalent. Compare rankings before switching. An ANN/vector service is unnecessary until measurements justify it.

**Acceptance:** warm unchanged retrieval performs zero fact embedding calls; switching models with equal dimensions cannot reuse stale vectors; canceled requests terminate; provider failure leaves useful lexical/file recall. Measure p50/p95 latency, embedding calls, and retrieval quality at 100, 1,000, and 10,000 facts.

### F. Preserve diversity at final selection and support abstention — P1

Mitii calls `diversifyBySource()` before retention mixing, then sorts by score again. The diversification helper also backfills excluded entries when it has room. With the normal candidate depth, this can restore the original source-heavy top ranks before final selection. `sourceIds` are often absent, so a broad source string such as `user` is also a poor diversity grouping.

RRF normalizes the best candidate to 1. That is relative ranking, not calibrated confidence that any fact is relevant. BM25 and vector paths have initial filters, but a strong relative rank alone should not defeat an explicit no-relevant-memory decision.

**Change:** keep RRF, retain per-stream evidence, and apply final selection after all score blending. Use bounded candidate overfetch, exact duplicate removal, optional MMR, and per-evidence-source/topic caps. Preserve the final diversity ordering during budgeting. Apply authorization/expiry filtering before diversity or duplicate collapse. Tune an abstention rule on negative queries rather than treating fused scores as probabilities.

Adapt [ZeroClaw's bounded reranker](../../../modules-ref/zeroclaw-master/crates/zeroclaw-memory/src/rerank.rs), especially eligibility-before-dedup and order-aware shingles. Its MMR uses lexical similarity; this does not require another LLM. It still needs Mitii-specific evaluation.

**Acceptance:** repeated memories do not occupy the entire final list; directional relationships remain distinct; irrelevant queries return no memory; diversity remains present in the final rendered request.

### G. Replace repeated layers with selective detail — P1

The engine always requests layered mode. Current layering independently assigns 30% to index clips, 30% to a timeline, and 40% to full facts. A single fact with `maxFacts: 1` was returned as three blocks in a probe. The timeline uses last access or creation time, not a separately modeled event history. Repeated recall can therefore make a fact look like recent timeline activity.

This is a presentation hierarchy, not demand-driven retrieval: all selected layers are injected immediately. It can spend scarce context repeating the same evidence and can fill five slots per layer rather than five total blocks.

**Change:** select unique facts once; render a compact summary or full detail according to task need. Reserve timeline rendering for actual episodic records and temporal questions. Permit an explicit read/open-memory operation for deeper detail, preserving scope checks. Budget the final rendered text including titles, markers, and provenance using the prompt estimator.

Record selected, rendered, and positively useful memory separately. Current access touches happen before final prompt construction, so a fact later omitted by the prompt budget may still gain retention credit. Retrieval frequency should not become a substitute for correctness.

**Acceptance:** unique-fact caps hold across all presentations; no redundant layers by default; stable preferences do not require a timeline; token accounting agrees with the actual request; feedback is tied to final inclusion and evidence of use.

## 5. Improve what is learned and how it changes

### H. Similarity is not replacement authority — P1

The current commit takes the first same-scope latest fact with Jaccard similarity above 0.7 and supersedes it. Jaccard ignores word order: `Alice manages Bob` and `Bob manages Alice` score 1. Their tokens describe different relationships. A small change in negation, environment, or numeric value can also carry the important meaning while preserving high overlap.

Exact reinforcement copies the existing record. A probe showed recommitting an expired exact fact returns committed while preserving its old expiry. New privacy, provenance, and other input metadata also need deliberate merge semantics rather than accidental retention of the old record.

**Change:** separate duplicate, supporting evidence, conflicting candidate, and explicit correction. Add a stable claim key where practical, for example `repo.packageManager` or `(entity, predicate, environment)`. Automatic replacement requires the same claim/applicability and authorized correction evidence, or an explicit target ID. Otherwise keep both and queue conflict review. Record who superseded what, why, and with which evidence; update the lineage atomically.

Preserve access and provenance intentionally on exact matches; define whether expired facts can be revived and under what evidence. Never silently make a private fact shareable through deduplication.

Do not port ZeroClaw's similarity-based conflict resolver as a semantic solution. Its order-aware retrieval duplicate handling is useful, but duplicate collapse during recall and durable supersession are different decisions.

### I. Extract verified lessons rather than tool-output snippets — P1/P2

Capture concatenates user prompt, tool input, and tool output, clips to 400 characters, then classifies keywords such as `error`, `always`, and `prefer`. Tool output can influence whether a draft becomes a user preference. The host event adapter passes a summary string as `toolInput`, so the structured file extractor cannot reliably recover paths from this path. Approval commits omit the draft's observation ID from `sourceIds`, weakening provenance.

Current `consolidate()` normalizes whitespace/case and marks older exact-equivalent content non-latest. It does not extract a verified fix or synthesize a durable lesson; the cron recipe is disabled by default and supplies a prompt rather than demonstrating a live autonomous extraction service.

**Change:** emit typed capture events with run/tool IDs, origin, structured files, outcome, and evidence references. Deterministic capture should prefer explicit user preferences and verified fixes. Optionally run a bounded extractor on successful task completion or selected observation batches, producing atomic drafts with evidence IDs, applicability, and confidence. Validate its output and retain the existing approval default.

For example, store “For this Electron target, rebuild native SQLite bindings after upgrading Electron; verified by test X” with evidence, rather than a raw `MODULE_NOT_FOUND` fragment. Distinguish an observed failure from a confirmed diagnosis and a verified remedy.

Use ZeroClaw's [bounded structured extraction](../../../modules-ref/zeroclaw-master/crates/zeroclaw-memory/src/consolidation.rs) as inspiration. Adapt its broad conversational categories to Mitii's coding evidence, task outcomes, and review workflow. Do not bulk-promote transcripts or infer stable cross-turn trends from one turn.

**Acceptance:** explicit user statement and tool output have distinct authority; only verified remedies are labeled verified; drafts link to evidence; rejected drafts cannot immediately return through equivalent recapture; extractor failure leaves normal work intact.

### J. Track repository applicability and freshness — P2, Mitii-specific

Neither file associations nor an age score establish that a fact still describes the current code. A valid memory for an older package version or another branch can harm a coding task despite high semantic relevance.

Add optional evidence/applicability: repository identity, file or symbol references, package/environment constraints, supporting commit/blob hash, last validation, and invalidation reason. Use the existing repository-state/change-impact facilities to schedule validation after relevant changes. A branch switch should trigger applicability checks, not automatically invalidate every memory.

Explicit preferences and durable design decisions should decay differently from temporary build failures. Support pinning and “needs revalidation” without equating pinned with higher instruction authority. Age, confidence, importance, usefulness, and validity should remain distinct concepts.

### K. Maintenance, deletion, recovery, and graph evolution — P2

Mitii caps observations at 10,000 but the inspected pending/fact/audit paths do not offer a unified byte/age budget. Pending writes and observation appends have weaker concurrency guarantees than the fact store; timestamp-based capture IDs can collide, and the observation temporary filename is fixed per process. Approval and consolidation use different lease resources, so neither is a global transaction lock for all memory writers.

Adapt ZeroClaw's [hygiene](../../../modules-ref/zeroclaw-master/crates/zeroclaw-memory/src/hygiene.rs), [budgets](../../../modules-ref/zeroclaw-master/crates/zeroclaw-memory/src/budget.rs), and [snapshot](../../../modules-ref/zeroclaw-master/crates/zeroclaw-memory/src/snapshot.rs) ideas with separate policies for pending drafts, observations, active facts, superseded versions, and audit events. Use UUIDs, explicit quarantine, archived history, and recoverable maintenance.

Distinguish forgetting one fact from purging its raw observation, pending draft, vectors, graph projection, export, and cache. Define snapshot retention and restore semantics so deleted material is not silently resurrected. A human-readable export should be an explicit derivative, with preserved identities and lineage in a machine-readable backup; do not introduce automatic repository-root snapshots containing personal memory.

The existing graph is useful for ownership/dependency questions, but names are its identifiers and observations are strings. Add stable IDs, aliases, evidence IDs, typed optional relations, and validity incrementally. File/fact-derived graph edges should be rebuildable projections; deliberately authored graph records can remain authoritative for relationships. Apply access and deletion policy to both. Bound graph expansion by hop count and token budget, and use it only when the query benefits.

## 6. Proposed architecture and migration

```text
Host-bound identity + origin + cancellation
                    |
          Memory application service
          /                       \
 Capture/extract drafts          Scoped retrieval
 sanitize + evidence            eligible candidate search
 approve / resolve conflict     BM25 + file + cached vectors
          |                     RRF -> final diversity
          |                     repository validation
          |                     evidence renderer + budget
          v                              |
 Transactional canonical store          v
 facts, revisions, pending,       Prompt construction
 observation references, audit
          |
 rebuildable FTS / vectors / derived graph edges
```

Keep decision logic in `packages/v8/src/modules/memory`. Keep SQLite opening, embedding-provider I/O, file migration, and persistence operations in `packages/host`. The prompt module owns trust-aware rendering. The engine owns turn origin, identity, cancellation, and final inclusion feedback. Host UIs expose one shared application service.

Start with these narrow contract additions, adapting names to existing conventions:

- A host-bound access context containing canonical workspace/repository identity, actor where applicable, allowed scopes, and turn origin.
- An atomic change-set operation with expected revision and idempotency key. A single SQLite transaction commits the change and associated audit/outbox records.
- A bounded search request with limit, filters, cancellation/deadline, and diagnostics. Index results resolve back to current canonical rows before injection.
- Embedding profile identity and batch support; cache invalidation tied to the embedded representation.
- Structured provenance and lifecycle/applicability metadata, preserved in retrieval results and rendered fragments.

Migration sequence:

1. Patch corruption handling, ingress redaction, private-access semantics, MCP stale filtering, and prompt authority in the existing implementation.
2. Define canonical workspace identity and explicit mappings from CLI/Desktop IDs. Migrate Memento through the VS Code host, which owns access to it. Do not guess that matching content means matching authorization.
3. Introduce host SQLite behind the port, using Mitii's existing [SQLite opener boundary](../../packages/host/src/sqlite/types.ts). Preserve the in-memory adapter for tests.
4. Import facts, versions, pending drafts, and observations with original IDs/timestamps and validation reports. Preserve unknown/corrupt source material separately. Record completed migration atomically and make retries idempotent.
5. Rebuild derived indexes; compare retrieval in shadow mode on the same dataset. Select one authoritative writer after cutover. Avoid indefinite dual-writing of JSON, Memento, and SQLite.
6. Keep a versioned export/rollback path. If rollback occurs after new SQLite writes, export those writes first; reverting to the old JSON snapshot alone would lose post-migration data.

This does not require another MCP server, a Rust subprocess, a vector database service, or adopting ZeroClaw's complete `Memory` trait. Multiple remote memory backends should wait for a demonstrated product need.

## 7. Delivery order and validation gates

| Slice | Work | Completion evidence |
|---|---|---|
| 1 — Correctness | Corruption preservation; privacy on every ingress; memory evidence rendering; shared stale/scope checks | Failure injection, private payload, prompt-conflict, and MCP parity tests |
| 2 — One durable owner | Canonical identity; atomic mutations; SQLite adapter; idempotent migration | Cross-host visibility, concurrent-process writes, restart/recovery and rollback tests |
| 3 — Efficient useful recall | Cached embeddings; bounded search; final diversity; unique fact rendering; actual-inclusion feedback | Zero warm fact re-embedding; latency distributions; negative-query precision; final-request token accounting |
| 4 — Better learning | Typed events; atomic drafts; evidence lineage; safe conflict resolution; approved extraction | Verified-fix and correction scenarios; negation/direction cases; provenance completeness |
| 5 — Lifecycle and UX | Freshness validation; pins; archives; purge; explanation UI; selective graph use | Stale repository scenarios, deletion propagation, export/restore, inspectable recall reasons |

The existing evaluation fixture has 11 cases and runs a pipeline without a real embedding adapter or the engine's layered mode. It provides useful deterministic regression coverage, but its irrelevant-rate calculation counts explicitly forbidden IDs rather than every unjudged selection; it is not a complete estimate of retrieval precision.

Expand evaluation across flat/layered or replacement rendering, hash/semantic/no-vector modes, all actual host readers, and final provider requests. Include distractors, paraphrases, no-match queries, negation, ownership reversal, scoped exceptions, repeated sources, expired reinforcement, user corrections, branch/package changes, missing identities, and malicious memory text. Measure task outcomes with memory off/current/improved: improved retrieval should reduce repeated mistakes without introducing stale advice.

Expose useful memory inspection: why selected, source, approval/validation state, scope, supersession history, last verified time, and whether it was actually sent. Offer correction, pin, reject, and explicit purge with honest affected-surface reporting. Keep telemetry to counts, IDs, durations, cache statistics, and reasons by default.

## 8. Validation performed

Existing suites: **7 files, 39 tests passed** using:

```sh
pnpm exec vitest run packages/v8/src/modules/memory packages/host/src/ports/memoryStore.spec.ts packages/host/src/ports/memoryPending.spec.ts packages/host/src/ports/memoryLeases.spec.ts packages/v8/src/engine/agent-engine/tests/AgentEngineSkillsMemory.spec.ts
```

Ten temporary synthetic characterization probes passed after correcting the probes to use the exported schema-version constant. They confirmed:

1. Direction-reversed relationships have Jaccard similarity 1.
2. Private workspace facts with an owner pass when requester identity is missing.
3. A replacement write failure can leave the original non-latest with no replacement.
4. Unchanged candidate facts are embedded again on repeated retrieval.
5. One fact can become three layered blocks with `maxFacts: 1`.
6. A subsequent commit replaces a corrupt envelope with only the new fact.
7. Private spans persist in observations and pending drafts before approval.
8. MCP shareable search returns expired, superseded facts.
9. Reinforcing an expired exact fact preserves its expired timestamp.
10. An explicit title retains private spans despite body redaction.

These probes asserted current behavior; passing them does not mean the behavior is desirable. Their temporary test file and temporary data were removed. No production code was changed. Cross-process stress tests, real embedding benchmarks, end-to-end model obedience tests, and ZeroClaw's Rust suite were not run; those remain implementation acceptance work.
