import {
  CONTEXT_ASSEMBLY_IDS,
  CONTEXT_ASSEMBLY_SECRET_PATTERNS,
} from "./constants";

import type {
  ContextSecretPattern,
  ContextSecretRedactionResult,
} from "./types";

export class ContextSecretRedactor {
  public readonly id =
    CONTEXT_ASSEMBLY_IDS
      .SECRET_REDACTOR;

  public constructor(
    private readonly patterns:
      readonly ContextSecretPattern[] =
        CONTEXT_ASSEMBLY_SECRET_PATTERNS,
  ) {}

  public redact(
    content: string,
  ): ContextSecretRedactionResult {
    let redacted =
      content;
    const redactions:
      ContextSecretRedactionResult[
        "redactions"
      ] = [];

    for (
      const definition
      of this.patterns
    ) {
      const matcher =
        this.clonePattern(
          definition.pattern,
        );
      const count =
        [
          ...redacted.matchAll(
            matcher,
          ),
        ].length;

      if (count === 0) {
        continue;
      }

      redacted =
        redacted.replace(
          this.clonePattern(
            definition.pattern,
          ),
          definition
            .replacement,
        );

      redactions.push({
        patternId:
          definition.id,
        count,
      });
    }

    return {
      content:
        redacted,
      redactions,
    };
  }

  private clonePattern(
    pattern: RegExp,
  ): RegExp {
    const flags =
      pattern.flags
        .includes("g")
        ? pattern.flags
        : `${pattern.flags}g`;

    return new RegExp(
      pattern.source,
      flags,
    );
  }
}
