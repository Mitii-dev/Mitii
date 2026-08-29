import { describe, expect, it } from "vitest";

import {
  TEXT_INDEX_DEFAULTS,
  TEXT_INDEX_SCHEMA_VERSION,
} from "./internal/text-index/constants";
import {
  expandCodeIdentifierTerms,
  expandFtsText,
  splitCodeIdentifier,
} from "./codeIdentifiers";
import { REPOSITORY_INDEX_FORMAT } from "./indexFormat";

describe("code identifier expansion", () => {
  it("splits camelCase, PascalCase, and snake_case identifiers", () => {
    expect(splitCodeIdentifier("validateJwt")).toEqual([
      "validate",
      "jwt",
    ]);
    expect(splitCodeIdentifier("ValidateJwt")).toEqual([
      "validate",
      "jwt",
    ]);
    expect(splitCodeIdentifier("validate_jwt")).toEqual([
      "validate",
      "jwt",
    ]);
    expect(splitCodeIdentifier("HTTPServer")).toEqual([
      "http",
      "server",
    ]);
    expect(splitCodeIdentifier("$foo")).toEqual(["foo"]);
    expect(splitCodeIdentifier("_id")).toEqual(["id"]);
  });

  it("keeps standalone terms at 3+ characters and identifier parts at 2+", () => {
    expect(expandCodeIdentifierTerms("id")).toEqual([]);
    expect(expandCodeIdentifierTerms("_id")).toEqual(["_id"]);
    expect(expandCodeIdentifierTerms("jwt")).toEqual(["jwt"]);
    expect(expandCodeIdentifierTerms("validateJwt")).toEqual([
      "validatejwt",
      "validate",
      "jwt",
    ]);
  });

  it("expands FTS text with original content plus identifier parts", () => {
    const expanded = expandFtsText(
      "export function validate_jwt() { return ValidateJwt(); }",
    );

    expect(expanded).toContain("validate_jwt");
    expect(expanded).toContain("validate");
    expect(expanded).toContain("jwt");
    expect(expanded).toContain("validatejwt");
  });

  it("keeps host format keys aligned with the text-index pipeline", () => {
    expect(REPOSITORY_INDEX_FORMAT.textIndexSchemaVersion).toBe(
      TEXT_INDEX_SCHEMA_VERSION,
    );
    expect(REPOSITORY_INDEX_FORMAT.textPipelineVersion).toBe(
      TEXT_INDEX_DEFAULTS.PIPELINE_VERSION,
    );
  });
});
