import assert from "node:assert/strict";
import test from "node:test";

import {
  ChunkingFactory,
  NodeSha256ChunkHasher,
  chunkingResultSchema,
} from "../index";

function createChunker() {
  return new ChunkingFactory()
    .create({
      hasher:
        new NodeSha256ChunkHasher(),
    });
}

test(
  "chunks code around declarations",
  async () => {
    const chunker =
      createChunker();

    const result =
      await chunker.chunk(
        {
          sourceId:
            "source:auth",
          rootId:
            "workspace",
          relativePath:
            "src/auth.ts",
          language:
            "typescript",
          content: [
            "import { db } from './db';",
            "",
            "export function login() {",
            "  return db.login();",
            "}",
            "",
            "export class Session {",
            "  close() {}",
            "}",
          ].join("\n"),
        },
        {
          targetChunkCharacters:
            60,
          maximumChunkCharacters:
            80,
          minimumChunkCharacters:
            10,
          overlapCharacters:
            5,
          boundarySearchCharacters:
            20,
        },
      );

    assert.equal(
      result.status,
      "complete",
    );

    assert.equal(
      result.strategyId,
      "code",
    );

    assert.ok(
      result.chunks.length >= 3,
    );

    chunkingResultSchema.parse(
      result,
    );
  },
);

test(
  "uses matching Source Analysis symbol ranges",
  async () => {
    const content = [
      "import { db } from './db';",
      "",
      "export function login() {",
      "  return db.login();",
      "}",
    ].join("\n");

    const result =
      await createChunker()
        .chunk({
          sourceId:
            "source:analyzed",
          rootId:
            "workspace",
          relativePath:
            "src/analyzed.ts",
          language:
            "typescript",
          content,
          sourceAnalysis: {
            schemaVersion: 1,
            sourceId:
              "source:analyzed",
            rootId:
              "workspace",
            relativePath:
              "src/analyzed.ts",
            language:
              "typescript",
            languageSource:
              "explicit",
            parserId:
              "typescript-compiler",
            quality:
              "precise",
            status:
              "complete",
            symbols: [
              {
                localId:
                  "symbol:login",
                name:
                  "login",
                kind:
                  "function",
                exported:
                  true,
                startLine: 3,
                endLine: 5,
              },
            ],
            imports: [],
            references: [],
            warnings: [],
          },
        });

    const symbolChunk =
      result.chunks.find(
        (chunk) =>
          chunk.symbolLocalId ===
          "symbol:login",
      );

    assert.equal(
      symbolChunk?.title,
      "login",
    );

    assert.equal(
      symbolChunk?.startLine,
      3,
    );
  },
);

test(
  "preserves Markdown sections",
  async () => {
    const result =
      await createChunker()
        .chunk({
          sourceId:
            "source:readme",
          rootId:
            "workspace",
          relativePath:
            "README.md",
          content:
            "# Intro\nHello\n\n## Usage\nRun it.",
        });

    assert.equal(
      result.strategyId,
      "markdown",
    );

    assert.deepEqual(
      result.chunks.map(
        (chunk) =>
          chunk.title,
      ),
      ["Intro", "Usage"],
    );
  },
);

test(
  "makes input truncation explicit",
  async () => {
    const result =
      await createChunker()
        .chunk(
          {
            sourceId:
              "source:large",
            rootId:
              "workspace",
            relativePath:
              "large.txt",
            content:
              "a".repeat(200),
          },
          {
            maximumInputCharacters:
              100,
            targetChunkCharacters:
              40,
            maximumChunkCharacters:
              50,
            minimumChunkCharacters:
              10,
            overlapCharacters:
              5,
            boundarySearchCharacters:
              10,
          },
        );

    assert.equal(
      result.status,
      "partial",
    );

    assert.equal(
      result.statistics
        .omittedCharacters,
      100,
    );

    assert.ok(
      result.warnings.some(
        (warning) =>
          warning.code ===
          "input_truncated",
      ),
    );
  },
);

test(
  "returns deterministic chunk IDs",
  async () => {
    const input = {
      sourceId:
        "source:stable",
      rootId:
        "workspace",
      relativePath:
        "notes.txt",
      content:
        "The same input produces the same IDs.",
    } as const;

    const chunker =
      createChunker();

    const first =
      await chunker.chunk(input);

    const second =
      await chunker.chunk(input);

    assert.deepEqual(
      first.chunks.map(
        (chunk) => chunk.id,
      ),
      second.chunks.map(
        (chunk) => chunk.id,
      ),
    );
  },
);
