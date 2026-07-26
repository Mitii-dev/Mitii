import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryRepositoryStateStore,
  publishRepositoryStateInputSchema,
  repositoryStateDescriptorSchema,
  repositoryStateReferenceSchema,
  RepositoryStatePipeline,
} from "../index";
import type { PublishRepositoryStateInput } from "../index";

const GENERATED_AT = "2026-07-25T18:00:00.000Z";

const createCandidate = (
  overrides: Partial<PublishRepositoryStateInput> = {},
): PublishRepositoryStateInput =>
  publishRepositoryStateInputSchema.parse({
    schemaVersion: 1,
    workspaceId: "ws-1",
    snapshotId: "snap-complete-1",
    scanCompleteness: "complete",
    roots: [
      {
        rootId: "root-a",
        projectCatalogRevision: "catalog-1",
        codeIndexRevision: "code-1",
        textIndexRevision: "text-1",
        capabilities: [
          { capability: "catalog", status: "ready" },
          { capability: "codeIndex", status: "ready" },
          { capability: "textIndex", status: "ready" },
        ],
      },
    ],
    reasons: [],
    generatedAt: GENERATED_AT,
    ...overrides,
  });

const createPipeline = () => {
  const store = new InMemoryRepositoryStateStore();
  const pipeline = new RepositoryStatePipeline({
    store,
    clock: { now: () => new Date(GENERATED_AT) },
  });
  return { store, pipeline };
};

test("publishes an immutable descriptor with a derived stateToken", async () => {
  const { pipeline } = createPipeline();
  const result = await pipeline.publish(createCandidate());

  assert.equal(result.status, "published");
  if (result.status !== "published") {
    return;
  }

  assert.equal(
    repositoryStateReferenceSchema.safeParse(result.reference).success,
    true,
  );
  assert.equal(
    repositoryStateDescriptorSchema.safeParse(result.descriptor).success,
    true,
  );
  assert.equal(result.descriptor.readiness, "ready");
  assert.equal(result.descriptor.cleanupAllowed, true);
  assert.equal(result.reference.stateToken, result.descriptor.stateToken);
  assert.match(result.descriptor.stateToken, /^[a-f0-9]{64}$/);
});

test("partial and filtered scans degrade and block cleanup", async () => {
  const { pipeline } = createPipeline();

  for (const scanCompleteness of ["partial", "filtered", "truncated"] as const) {
    const result = await pipeline.publish(
      createCandidate({
        snapshotId: `snap-${scanCompleteness}`,
        scanCompleteness,
      }),
    );

    assert.equal(result.status, "published");
    if (result.status !== "published") {
      continue;
    }

    assert.equal(result.descriptor.readiness, "degraded");
    assert.equal(result.descriptor.cleanupAllowed, false);
    assert.ok(
      result.descriptor.reasons.some((reason) =>
        reason.code.startsWith("scan_"),
      ),
    );
  }
});

test("rejects unknown and workspace-mismatched state tokens", async () => {
  const { pipeline } = createPipeline();
  await pipeline.publish(createCandidate());

  const unknown = await pipeline.read({
    workspaceId: "ws-1",
    stateToken: "missing-token",
  });
  assert.equal(unknown.status, "not_found");
  if (unknown.status === "not_found") {
    assert.equal(unknown.code, "unknown_state_token");
  }
});

test("active-run pin retains state across a newer publication", async () => {
  const { store, pipeline } = createPipeline();

  const first = await pipeline.publish(createCandidate());
  assert.equal(first.status, "published");
  if (first.status !== "published") {
    return;
  }

  const pin = await pipeline.pin({
    state: first.reference,
    runId: "run-1",
  });
  assert.equal(pin.status, "pinned");

  const second = await pipeline.publish(
    createCandidate({
      snapshotId: "snap-complete-2",
      roots: [
        {
          rootId: "root-a",
          projectCatalogRevision: "catalog-2",
          codeIndexRevision: "code-2",
          textIndexRevision: "text-2",
          capabilities: [
            { capability: "catalog", status: "ready" },
            { capability: "codeIndex", status: "ready" },
            { capability: "textIndex", status: "ready" },
          ],
        },
      ],
    }),
  );
  assert.equal(second.status, "published");
  if (second.status !== "published") {
    return;
  }

  assert.notEqual(first.reference.stateToken, second.reference.stateToken);

  const latest = await pipeline.getLatest("ws-1");
  assert.equal(latest?.stateToken, second.reference.stateToken);

  const pinnedRead = await pipeline.read(first.reference);
  assert.equal(pinnedRead.status, "found");
  if (pinnedRead.status === "found") {
    assert.equal(pinnedRead.descriptor.stateToken, first.reference.stateToken);
  }

  await assert.rejects(
    () => store.deleteIfUnpinned(first.reference),
    /pinned/i,
  );

  const unpin = await pipeline.unpin({
    state: first.reference,
    runId: "run-1",
  });
  assert.equal(unpin.status, "unpinned");
  assert.equal(await store.deleteIfUnpinned(first.reference), true);
});

test("concurrent publication does not mutate a prior token", async () => {
  const { pipeline } = createPipeline();

  const [left, right] = await Promise.all([
    pipeline.publish(
      createCandidate({
        snapshotId: "snap-concurrent-a",
      }),
    ),
    pipeline.publish(
      createCandidate({
        snapshotId: "snap-concurrent-b",
        roots: [
          {
            rootId: "root-b",
            projectCatalogRevision: "catalog-b",
            codeIndexRevision: "code-b",
            textIndexRevision: "text-b",
            capabilities: [
              { capability: "catalog", status: "ready" },
              { capability: "codeIndex", status: "ready" },
              { capability: "textIndex", status: "ready" },
            ],
          },
        ],
      }),
    ),
  ]);

  assert.equal(left.status, "published");
  assert.equal(right.status, "published");
  if (left.status !== "published" || right.status !== "published") {
    return;
  }

  assert.notEqual(left.reference.stateToken, right.reference.stateToken);

  const leftRead = await pipeline.read(left.reference);
  const rightRead = await pipeline.read(right.reference);
  assert.equal(leftRead.status, "found");
  assert.equal(rightRead.status, "found");
  if (leftRead.status === "found" && rightRead.status === "found") {
    assert.equal(leftRead.descriptor.snapshotId, "snap-concurrent-a");
    assert.equal(rightRead.descriptor.snapshotId, "snap-concurrent-b");
  }
});

test("idempotent republish of the same manifest succeeds", async () => {
  const { pipeline } = createPipeline();
  const candidate = createCandidate();

  const first = await pipeline.publish(candidate);
  const second = await pipeline.publish(candidate);

  assert.equal(first.status, "published");
  assert.equal(second.status, "published");
  if (first.status !== "published" || second.status !== "published") {
    return;
  }

  assert.equal(first.reference.stateToken, second.reference.stateToken);
});

test("cancelled publication aborts before store write", async () => {
  const { pipeline } = createPipeline();
  const controller = new AbortController();
  controller.abort();

  const result = await pipeline.publish(createCandidate(), {
    abortSignal: controller.signal,
  });

  assert.equal(result.status, "cancelled");
  assert.equal(await pipeline.getLatest("ws-1"), undefined);
});

test("multi-root descriptors preserve per-root revisions", async () => {
  const { pipeline } = createPipeline();
  const result = await pipeline.publish(
    createCandidate({
      roots: [
        {
          rootId: "frontend",
          projectCatalogRevision: "fe-catalog",
          codeIndexRevision: "fe-code",
          textIndexRevision: "fe-text",
          graphRevision: "fe-graph",
          mapRevision: "fe-map",
          capabilities: [
            { capability: "catalog", status: "ready" },
            { capability: "codeIndex", status: "ready" },
            { capability: "textIndex", status: "ready" },
            { capability: "graph", status: "ready" },
            { capability: "map", status: "ready" },
          ],
        },
        {
          rootId: "backend",
          projectCatalogRevision: "be-catalog",
          codeIndexRevision: "be-code",
          textIndexRevision: "be-text",
          vectorProfile: "default",
          vectorIndexRevision: "be-vector",
          capabilities: [
            { capability: "catalog", status: "ready" },
            { capability: "codeIndex", status: "ready" },
            { capability: "textIndex", status: "ready" },
            { capability: "vectorIndex", status: "degraded" },
          ],
        },
      ],
    }),
  );

  assert.equal(result.status, "published");
  if (result.status !== "published") {
    return;
  }

  assert.equal(result.descriptor.roots.length, 2);
  assert.equal(result.descriptor.readiness, "degraded");
  assert.equal(
    result.descriptor.roots.find((root) => root.rootId === "backend")
      ?.vectorIndexRevision,
    "be-vector",
  );
});

test("rejects invalid candidates at the contract boundary", async () => {
  const { pipeline } = createPipeline();
  const result = await pipeline.publish({
    schemaVersion: 1,
    workspaceId: "",
    snapshotId: "snap",
    scanCompleteness: "complete",
    roots: [],
  } as unknown as PublishRepositoryStateInput);

  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.code, "invalid_candidate");
  }
});
