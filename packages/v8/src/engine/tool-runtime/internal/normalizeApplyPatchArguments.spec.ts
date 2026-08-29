import { describe, expect, it } from "vitest";

import { normalizeApplyPatchArguments } from "./normalizeApplyPatchArguments";
import { coerceArgumentsToSchema } from "./CoerceArgumentsToSchema";
import { applyPatchInputSchema } from "./ToolCatalog";

describe("normalizeApplyPatchArguments", () => {
  it("wraps a flat single-hunk object into patches[]", () => {
    const normalized = normalizeApplyPatchArguments({
      path: "index.html",
      oldText: "<head>\n</head>",
      newText: "<head>\n<link rel=\"icon\" href=\"x\">\n</head>",
    });
    expect(normalized).toEqual({
      patches: [
        {
          path: "index.html",
          oldText: "<head>\n</head>",
          newText: "<head>\n<link rel=\"icon\" href=\"x\">\n</head>",
        },
      ],
    });
  });

  it("parses stringified patches arrays (stripo favicon failure mode)", () => {
    const patchesJson = JSON.stringify([
      {
        path: "index.html",
        oldText: "<head>\n</head>",
        newText: "<head>\n<link rel=\"icon\" href=\"data:image/gif;base64,AAA\">\n</head>",
      },
    ]);
    const normalized = normalizeApplyPatchArguments({ patches: patchesJson });
    expect(normalized).toEqual({
      patches: [
        {
          path: "index.html",
          oldText: "<head>\n</head>",
          newText:
            "<head>\n<link rel=\"icon\" href=\"data:image/gif;base64,AAA\">\n</head>",
        },
      ],
    });
  });

  it("leaves a correct patches array unchanged", () => {
    const input = {
      patches: [{ path: "a.ts", oldText: "a", newText: "b" }],
    };
    expect(normalizeApplyPatchArguments(input)).toEqual(input);
  });
});

describe("coerceArgumentsToSchema apply_patch arrays", () => {
  it("coerces stringified patches through schema coerce + normalize", () => {
    const raw = {
      patches: JSON.stringify([
        { path: "src/a.ts", oldText: "const x = 1;\n", newText: "const x = 2;\n" },
      ]),
    };
    const normalized = normalizeApplyPatchArguments(raw);
    const coerced = coerceArgumentsToSchema(normalized, applyPatchInputSchema);
    expect(applyPatchInputSchema.parse(coerced)).toEqual({
      patches: [
        { path: "src/a.ts", oldText: "const x = 1;\n", newText: "const x = 2;\n" },
      ],
    });
  });
});
