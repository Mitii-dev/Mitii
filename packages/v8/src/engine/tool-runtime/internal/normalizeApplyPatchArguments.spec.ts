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

  it("drops expectedHash null so gemma-style patches validate (billbuddy headless run)", () => {
    const normalized = normalizeApplyPatchArguments({
      patches: [
        {
          path: "test/shared/config/testConfig.ts",
          oldText: "  capabilities: {\n    browserName: \"chrome\",\n  },",
          newText:
            "  capabilities: {\n    browserName: \"chrome\",\n    'goog:chromeOptions': {\n      args: ['--headless']\n    }\n  },",
          expectedHash: null,
          replaceAll: true,
        },
      ],
    });
    expect(normalized).toEqual({
      patches: [
        {
          path: "test/shared/config/testConfig.ts",
          oldText: "  capabilities: {\n    browserName: \"chrome\",\n  },",
          newText:
            "  capabilities: {\n    browserName: \"chrome\",\n    'goog:chromeOptions': {\n      args: ['--headless']\n    }\n  },",
          replaceAll: true,
        },
      ],
    });
    expect(
      applyPatchInputSchema.parse(
        coerceArgumentsToSchema(normalized, applyPatchInputSchema),
      ),
    ).toMatchObject({
      patches: [{ path: "test/shared/config/testConfig.ts", replaceAll: true }],
    });
  });

  it("coerces string replaceAll before schema validation", () => {
    const normalized = normalizeApplyPatchArguments({
      patches: [
        {
          path: "src/a.ts",
          oldText: "foo",
          newText: "bar",
          replaceAll: "true",
        },
      ],
    });
    expect(normalized).toEqual({
      patches: [
        {
          path: "src/a.ts",
          oldText: "foo",
          newText: "bar",
          replaceAll: true,
        },
      ],
    });
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
