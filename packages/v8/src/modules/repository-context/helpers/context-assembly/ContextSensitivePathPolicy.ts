import {
  CONTEXT_ASSEMBLY_IDS,
  CONTEXT_ASSEMBLY_SAFE_TEMPLATE_SUFFIXES,
  CONTEXT_ASSEMBLY_SENSITIVE_ENV_PREFIX,
  CONTEXT_ASSEMBLY_SENSITIVE_EXACT_FILE_NAMES,
  CONTEXT_ASSEMBLY_SENSITIVE_FILE_SUFFIXES,
  CONTEXT_ASSEMBLY_SENSITIVE_PATH_SEGMENTS,
} from "./constants";

import type {
  ContextSensitivePathDecision,
} from "./types";

export class ContextSensitivePathPolicy {
  public readonly id =
    CONTEXT_ASSEMBLY_IDS
      .SENSITIVE_PATH_POLICY;

  public evaluate(
    relativePath: string,
  ): ContextSensitivePathDecision {
    const normalized =
      relativePath
        .trim()
        .replace(
          /\\/g,
          "/",
        )
        .replace(
          /^\.\/+/,
          "",
        )
        .toLowerCase();
    const segments =
      normalized.split("/");
    const fileName =
      segments.at(-1) ??
      "";

    if (
      CONTEXT_ASSEMBLY_SAFE_TEMPLATE_SUFFIXES
        .some(
          (suffix) =>
            fileName.endsWith(
              suffix,
            ),
        )
    ) {
      return {
        sensitive:
          false,
      };
    }

    const sensitiveSegment =
      segments.find(
        (segment) =>
          CONTEXT_ASSEMBLY_SENSITIVE_PATH_SEGMENTS
            .has(segment),
      );

    if (sensitiveSegment) {
      return {
        sensitive:
          true,
        matchedRule:
          `path-segment:${sensitiveSegment}`,
      };
    }

    if (
      CONTEXT_ASSEMBLY_SENSITIVE_EXACT_FILE_NAMES
        .has(fileName)
    ) {
      return {
        sensitive:
          true,
        matchedRule:
          `file-name:${fileName}`,
      };
    }

    if (
      fileName.startsWith(
        CONTEXT_ASSEMBLY_SENSITIVE_ENV_PREFIX,
      )
    ) {
      return {
        sensitive:
          true,
        matchedRule:
          `file-prefix:${CONTEXT_ASSEMBLY_SENSITIVE_ENV_PREFIX}`,
      };
    }

    const sensitiveSuffix =
      CONTEXT_ASSEMBLY_SENSITIVE_FILE_SUFFIXES
        .find(
          (suffix) =>
            fileName.endsWith(
              suffix,
            ),
        );

    return sensitiveSuffix
      ? {
          sensitive:
            true,
          matchedRule:
            `file-suffix:${sensitiveSuffix}`,
        }
      : {
          sensitive:
            false,
        };
  }
}
