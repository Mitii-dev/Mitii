import { describe, expect, it } from "vitest";

import { defaultLanguageProfileRegistry } from "./index";

describe("LanguageProfileRegistry indexes", () => {
  it("owns target-language extensions so dialect maps do not duplicate them", () => {
    const extensions = defaultLanguageProfileRegistry.extensionIndex();
    expect(extensions[".ts"]).toBe("typescript");
    expect(extensions[".py"]).toBe("python");
    expect(extensions[".go"]).toBe("go");
    expect(extensions[".vue"]).toBeUndefined();
    expect(defaultLanguageProfileRegistry.filenameIndex()["go.mod"]).toBe(
      "go",
    );
  });
});
