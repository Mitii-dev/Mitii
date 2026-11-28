import assert from "node:assert/strict";
import test from "node:test";

import {
  createFixture,
} from "./fixtures/textIndexFixtures";

test(
  "indexes Chunking output and searches it",
  async () => {
    const fixture =
      await createFixture();

    try {
      const chunking =
        await fixture.chunker
          .chunk({
            sourceId:
              "source:auth",
            rootId:
              "workspace",
            relativePath:
              "src/auth.ts",
            language:
              "typescript",
            content: [
              "export function authenticate(token: string) {",
              "  return verifyAuthenticationToken(token);",
              "}",
            ].join("\n"),
          });

      const indexed =
        await fixture.textIndex
          .coordinator.index({
            workspace:
              "/repo",
            workspaceSnapshotId:
              "snapshot-1",
            indexedAt: 100,
            chunking,
          });

      assert.equal(
        indexed.status,
        "indexed",
      );

      const result =
        await fixture.textIndex
          .search.search({
            workspace:
              "/repo",
            query:
              "authentication token",
            rootIds: [
              "workspace",
            ],
          });

      assert.equal(
        result.status,
        "complete",
      );

      assert.equal(
        result.matches[0]
          ?.relativePath,
        "src/auth.ts",
      );

      assert.match(
        result.matches[0]
          ?.snippet ?? "",
        /\[\[authentication/i,
      );
    } finally {
      fixture.database.close();
    }
  },
);

test(
  "search treats explicit files and folder prefix as one path scope",
  async () => {
    const fixture =
      await createFixture();

    try {
      for (const relativePath of [
        "packages/mui-builder/src/FormBuilder.tsx",
        "tsconfig.json",
        "packages/other/src/Other.ts",
      ]) {
        const chunking =
          await fixture.chunker
            .chunk({
              sourceId:
                `source:${relativePath}`,
              rootId:
                "workspace",
              relativePath,
              language:
                "typescript",
              content:
                "export const sharedscope = true;",
            });

        await fixture.textIndex
          .coordinator.index({
            workspace:
              "/repo",
            workspaceSnapshotId:
              "snapshot-1",
            indexedAt:
              100,
            chunking,
          });
      }

      const result =
        await fixture.textIndex
          .search.search({
            workspace:
              "/repo",
            query:
              "sharedscope",
            rootIds: [
              "workspace",
            ],
            folderPrefix:
              "packages/mui-builder",
            filePaths: [
              "tsconfig.json",
            ],
            maximumResults:
              10,
          });

      assert.deepEqual(
        result.matches
          .map((match) =>
            match.relativePath,
          )
          .sort(),
        [
          "packages/mui-builder/src/FormBuilder.tsx",
          "tsconfig.json",
        ],
      );
    } finally {
      fixture.database.close();
    }
  },
);

test(
  "skips unchanged documents and refreshes metadata separately",
  async () => {
    const fixture =
      await createFixture();

    try {
      const chunking =
        await fixture.chunker
          .chunk({
            sourceId:
              "source:stable",
            rootId:
              "workspace",
            relativePath:
              "src/stable.ts",
            content:
              "export const stable = true;",
            language:
              "typescript",
          });

      const first =
        await fixture.textIndex
          .coordinator.index({
            workspace:
              "/repo",
            workspaceSnapshotId:
              "snapshot-1",
            indexedAt: 100,
            chunking,
          });

      const unchanged =
        await fixture.textIndex
          .coordinator.index({
            workspace:
              "/repo",
            workspaceSnapshotId:
              "snapshot-1",
            indexedAt: 100,
            chunking,
          });

      const refreshed =
        await fixture.textIndex
          .coordinator.index({
            workspace:
              "/repo",
            workspaceSnapshotId:
              "snapshot-2",
            indexedAt: 200,
            chunking,
          });

      assert.equal(
        first.status,
        "indexed",
      );

      assert.equal(
        unchanged.status,
        "unchanged",
      );

      assert.equal(
        refreshed.status,
        "metadata_refreshed",
      );

      assert.equal(
        await fixture.textIndex
          .reader.getRevision(
            "/repo",
            "workspace",
          ),
        1,
      );
    } finally {
      fixture.database.close();
    }
  },
);
