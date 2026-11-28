import assert from "node:assert/strict";
import test from "node:test";

import {
  createAssembler,
  createItem,
  createSelection,
  createSnapshot,
} from "./fixtures/assemblyFixtures";

test(
  "assembles full files as untrusted, provenance-rich blocks",
  async () => {
    const files = {
      "src/app.ts":
        "import { run } from './run';\nrun();\n",
    };
    const result =
      await createAssembler(
        files,
      ).assemble({
        selection:
          createSelection([
            createItem(),
          ]),
        snapshot:
          createSnapshot(
            files,
          ),
      });

    assert.equal(
      result.status,
      "complete",
    );
    assert.equal(
      result.blocks.length,
      1,
    );
    assert.equal(
      result.blocks[0]
        ?.trust,
      "untrusted_repository_content",
    );
    assert.equal(
      result.blocks[0]
        ?.content,
      files[
        "src/app.ts"
      ],
    );
    assert.equal(
      result.blocks[0]
        ?.provenance
        .selectionKey,
      "file:app:src/app.ts",
    );
  },
);

test(
  "loads exact line ranges without expanding them",
  async () => {
    const files = {
      "src/app.ts":
        "line 1\nline 2\nline 3\nline 4",
    };
    const item =
      createItem({
        key:
          "range:app:src/app.ts:2-3",
        representation:
          "exact_range",
        startLine:
          2,
        endLine:
          3,
      });
    const result =
      await createAssembler(
        files,
      ).assemble({
        selection:
          createSelection([
            item,
          ]),
        snapshot:
          createSnapshot(
            files,
          ),
      });

    assert.equal(
      result.blocks[0]
        ?.content,
      "line 2\nline 3",
    );
    assert.deepEqual(
      result.blocks[0]
        ?.lineRanges,
      [
        {
          startLine:
            2,
          endLine:
            3,
        },
      ],
    );
  },
);

test(
  "uses a visible representation fallback when an outline source is unavailable",
  async () => {
    const files = {
      "src/app.ts":
        "export function run() { return true; }",
    };
    const result =
      await createAssembler(
        files,
      ).assemble({
        selection:
          createSelection([
            createItem({
              representation:
                "file_outline",
            }),
          ]),
        snapshot:
          createSnapshot(
            files,
          ),
      });

    assert.equal(
      result.status,
      "partial",
    );
    assert.equal(
      result.blocks[0]
        ?.requestedRepresentation,
      "file_outline",
    );
    assert.equal(
      result.blocks[0]
        ?.representation,
      "targeted_excerpt",
    );
    assert.ok(
      result.warnings.some(
        (warning) =>
          warning.code ===
          "representation_fallback",
      ),
    );
  },
);

test(
  "truncates content without exceeding the selected token allocation",
  async () => {
    const files = {
      "src/app.ts":
        "const value = 1;\n".repeat(
          200,
        ),
    };
    const result =
      await createAssembler(
        files,
      ).assemble({
        selection:
          createSelection([
            createItem({
              allocatedTokens:
                24,
              estimatedTokens:
                24,
            }),
          ]),
        snapshot:
          createSnapshot(
            files,
          ),
      });
    const block =
      result.blocks[0];

    assert.ok(block);
    assert.equal(
      block.truncated,
      true,
    );
    assert.ok(
      block.tokenEstimate <=
        24,
    );
    assert.equal(
      result.budget
        .usedTokens,
      block.tokenEstimate,
    );
  },
);

test(
  "sanitizes control characters and redacts secrets before output",
  async () => {
    const files = {
      "src/config.ts":
        "const api_key = \"ghp_123456789012345678901234567890\";\u0000\n",
    };
    const result =
      await createAssembler(
        files,
      ).assemble({
        selection:
          createSelection([
            createItem({
              key:
                "file:app:src/config.ts",
              relativePath:
                "src/config.ts",
            }),
          ]),
        snapshot:
          createSnapshot(
            files,
          ),
      });
    const content =
      result.blocks[0]
        ?.content ??
      "";

    assert.equal(
      content.includes(
        "ghp_",
      ),
      false,
    );
    assert.equal(
      content.includes(
        "\u0000",
      ),
      false,
    );
    assert.ok(
      result.warnings.some(
        (warning) =>
          warning.code ===
          "secrets_redacted",
      ),
    );
    assert.ok(
      result.warnings.some(
        (warning) =>
          warning.code ===
          "content_sanitized",
      ),
    );
  },
);

test(
  "blocks sensitive files and supports fail-closed required context",
  async () => {
    const files = {
      ".env":
        "PASSWORD=super-secret-value",
    };
    const item =
      createItem({
        key:
          "file:app:.env",
        relativePath:
          ".env",
        priority:
          "required",
        origin: [
          "explicit_file",
        ],
      });
    const input = {
      selection:
        createSelection([
          item,
        ]),
      snapshot:
        createSnapshot(
          files,
        ),
    };
    const partial =
      await createAssembler(
        files,
      ).assemble(
        input,
      );
    const failed =
      await createAssembler(
        files,
        {
          requiredLoadFailureMode:
            "fail",
        },
      ).assemble(
        input,
      );

    assert.equal(
      partial.status,
      "partial",
    );
    assert.equal(
      partial.blocks.length,
      0,
    );
    assert.equal(
      partial.dropped[0]
        ?.cause,
      "sensitive_path",
    );
    assert.equal(
      failed.status,
      "failed",
    );
    assert.equal(
      failed.blocks.length,
      0,
    );
  },
);
