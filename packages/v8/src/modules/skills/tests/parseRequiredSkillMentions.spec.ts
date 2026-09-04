import { describe, expect, it } from "vitest";

import {
  mergeRequiredSkillIds,
  parseRequiredSkillMentions,
} from "../parseRequiredSkillMentions";

describe("parseRequiredSkillMentions", () => {
  it("extracts @skill mentions and cleans the message", () => {
    const result = parseRequiredSkillMentions(
      "@skill:module-doc-generator\nGenerate docs for test/Tablet",
    );

    expect(result.requiredSkillIds).toEqual(["module-doc-generator"]);
    expect(result.cleanedMessage).toBe("Generate docs for test/Tablet");
  });

  it("supports slash invocation on its own line", () => {
    const result = parseRequiredSkillMentions(
      "/module-doc-generator\nGenerate docs for test/Tablet",
    );

    expect(result.requiredSkillIds).toEqual(["module-doc-generator"]);
    expect(result.cleanedMessage).toBe("Generate docs for test/Tablet");
  });

  it("dedupes ids and caps at three", () => {
    const result = parseRequiredSkillMentions(
      "@skill:one @skill:two @skill:three @skill:four",
    );

    expect(result.requiredSkillIds).toEqual(["one", "two", "three"]);
  });
});

describe("mergeRequiredSkillIds", () => {
  it("merges explicit host ids with parsed mentions", () => {
    expect(
      mergeRequiredSkillIds(["planning-default"], ["module-doc-generator"]),
    ).toEqual(["planning-default", "module-doc-generator"]);
  });
});
