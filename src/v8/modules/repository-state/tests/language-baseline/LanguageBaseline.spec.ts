import assert from "node:assert/strict";
import test from "node:test";

import {
  ChunkingFactory,
  LANGUAGE_IDS,
  defaultLanguageProfileRegistry,
} from "../../index";
import { NodeSha256ChunkHasher } from "../../internal/chunking/adapters/node/NodeSha256ChunkHasher";
import { LanguageDetector } from "../../internal/source-analysis/LanguageDetector";
import { createSourceAnalysisBuilder } from "../../internal/source-analysis/SourceAnalysisFactory";

import { LANGUAGE_BASELINE_FIXTURES } from "./fixtures";

function createChunker() {
  return new ChunkingFactory().create({
    hasher: new NodeSha256ChunkHasher(),
  });
}

test("baseline fixtures cover every target language id plus unknown", () => {
  const covered = new Set(
    LANGUAGE_BASELINE_FIXTURES.map((fixture) => fixture.id),
  );

  for (const id of LANGUAGE_IDS) {
    assert.equal(
      covered.has(id),
      true,
      `missing baseline fixture for ${id}`,
    );
  }

  assert.equal(LANGUAGE_BASELINE_FIXTURES.length, LANGUAGE_IDS.length);
});

test("every language passes detection, deterministic chunking, and lexical token presence", async () => {
  const chunker = createChunker();
  const detector = new LanguageDetector();

  for (const fixture of LANGUAGE_BASELINE_FIXTURES) {
    const profile = defaultLanguageProfileRegistry.get(fixture.id);
    assert.equal(profile.capability, fixture.capability);

    const pathDetection =
      defaultLanguageProfileRegistry.detectFromPath(fixture.relativePath);
    assert.equal(
      pathDetection.languageId,
      fixture.id,
      `path detection mismatch for ${fixture.id}`,
    );

    if (fixture.shebang) {
      const shebangDetection =
        defaultLanguageProfileRegistry.detectFromShebang(fixture.shebang);
      assert.equal(shebangDetection?.languageId, fixture.id);
    }

    const detectorResult = detector.detect(fixture.relativePath);
    if (fixture.id === "unknown") {
      assert.equal(
        detectorResult.language === undefined ||
          detectorResult.source === "unknown",
        true,
      );
    } else {
      assert.equal(
        detectorResult.language,
        fixture.id,
        `LanguageDetector mismatch for ${fixture.id}`,
      );
    }

    const first = await chunker.chunk({
      sourceId: `source:${fixture.id}`,
      rootId: "root",
      relativePath: fixture.relativePath,
      language: fixture.id,
      content: fixture.content,
    });
    const second = await chunker.chunk({
      sourceId: `source:${fixture.id}`,
      rootId: "root",
      relativePath: fixture.relativePath,
      language: fixture.id,
      content: fixture.content,
    });

    assert.notEqual(first.status, "failed", `chunking failed for ${fixture.id}`);
    assert.notEqual(first.status, "rejected", `chunking rejected for ${fixture.id}`);
    assert.ok(first.chunks.length > 0, `no chunks for ${fixture.id}`);
    assert.deepEqual(
      first.chunks.map((chunk) => chunk.chunkId),
      second.chunks.map((chunk) => chunk.chunkId),
      `non-deterministic chunk ids for ${fixture.id}`,
    );

    const joined = first.chunks.map((chunk) => chunk.content).join("\n");
    assert.match(
      joined,
      new RegExp(fixture.searchToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `lexical token missing after chunking for ${fixture.id}`,
    );

    if (fixture.id === "unknown") {
      assert.equal(first.strategyId, "text");
    } else {
      assert.equal(
        first.strategyId,
        "code",
        `expected code chunker for ${fixture.id}, got ${first.strategyId}`,
      );
    }
  }
});

test("enhanced languages expose symbols; baseline languages degrade without fabricating enhanced facts", async () => {
  const analyzer = createSourceAnalysisBuilder();

  for (const fixture of LANGUAGE_BASELINE_FIXTURES) {
    const analysis = await analyzer.analyze({
      sourceId: `source:${fixture.id}`,
      file: {
        rootId: "root",
        relativePath: fixture.relativePath,
        kind: "file",
        depth: 1,
        size: fixture.content.length,
      },
      content: fixture.content,
      language: fixture.id === "unknown" ? undefined : fixture.id,
    });

    if (fixture.expectEnhancedSymbols) {
      assert.ok(
        analysis.symbols.length > 0,
        `expected enhanced symbols for ${fixture.id}`,
      );
      assert.notEqual(analysis.status, "unsupported");
      continue;
    }

    if (fixture.id === "unknown") {
      assert.equal(analysis.status, "unsupported");
      assert.equal(analysis.symbols.length, 0);
      assert.ok(
        analysis.warnings.some(
          (warning) =>
            warning.code === "language_unknown" ||
            warning.code === "parser_not_found",
        ),
      );
      continue;
    }

    // Baseline languages may use heuristic regex parsers, but must not claim
    // enhanced TypeScript-quality structural analysis.
    assert.notEqual(analysis.quality, "precise");
    if (analysis.status === "unsupported") {
      assert.equal(analysis.symbols.length, 0);
    }
  }
});
