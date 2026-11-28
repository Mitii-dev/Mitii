import {
  CONTEXT_ASSEMBLY_ALLOWED_CONTROL_CHARACTERS,
  CONTEXT_ASSEMBLY_IDS,
} from "./constants";

import type {
  ContextTextSanitizationResult,
} from "./types";

export class ContextTextSanitizer {
  public readonly id =
    CONTEXT_ASSEMBLY_IDS
      .TEXT_SANITIZER;

  public sanitize(
    content: string,
  ): ContextTextSanitizationResult {
    const normalized =
      content.replace(
        /\r\n?/g,
        "\n",
      );
    let removed = 0;
    let sanitized = "";

    for (
      const character
      of normalized
    ) {
      const code =
        character.codePointAt(
          0,
        );

      if (
        code === undefined
      ) {
        continue;
      }

      const unsupported =
        (
          code < 0x20 &&
          !CONTEXT_ASSEMBLY_ALLOWED_CONTROL_CHARACTERS
            .has(code)
        ) ||
        code === 0x7f;

      if (unsupported) {
        removed += 1;
        continue;
      }

      sanitized +=
        character;
    }

    return {
      content:
        sanitized,
      removedControlCharacters:
        removed,
      normalizedLineEndings:
        normalized !==
        content,
    };
  }
}
