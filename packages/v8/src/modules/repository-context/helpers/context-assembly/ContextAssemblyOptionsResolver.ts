import {
  CONTEXT_ASSEMBLY_DEFAULTS,
  CONTEXT_ASSEMBLY_IDS,
  CONTEXT_ASSEMBLY_MESSAGES,
} from "./constants";

import {
  ContextAssemblyError,
} from "./ContextAssemblyError";

import {
  contextAssemblerOptionsSchema,
} from "./schema";

import type {
  ContextAssemblerOptions,
  ResolvedContextAssemblerOptions,
} from "./types";

export class ContextAssemblyOptionsResolver {
  public readonly id =
    CONTEXT_ASSEMBLY_IDS
      .ASSEMBLER;

  public resolve(
    options:
      ContextAssemblerOptions,
  ): ResolvedContextAssemblerOptions {
    const parsed =
      contextAssemblerOptionsSchema
        .safeParse(options);

    if (!parsed.success) {
      throw new ContextAssemblyError(
        CONTEXT_ASSEMBLY_MESSAGES
          .INVALID_OPTIONS,
        {
          operation:
            "resolve_options",
          componentId:
            this.id,
          cause:
            parsed.error,
        },
      );
    }

    return {
      maximumBytesPerItem:
        parsed.data
          .maximumBytesPerItem ??
        CONTEXT_ASSEMBLY_DEFAULTS
          .MAXIMUM_BYTES_PER_ITEM,
      requiredLoadFailureMode:
        parsed.data
          .requiredLoadFailureMode ??
        CONTEXT_ASSEMBLY_DEFAULTS
          .REQUIRED_LOAD_FAILURE_MODE,
      sensitivePathMode:
        parsed.data
          .sensitivePathMode ??
        CONTEXT_ASSEMBLY_DEFAULTS
          .SENSITIVE_PATH_MODE,
      redactSecrets:
        parsed.data
          .redactSecrets ??
        CONTEXT_ASSEMBLY_DEFAULTS
          .REDACT_SECRETS,
      allowRepresentationFallback:
        parsed.data
          .allowRepresentationFallback ??
        CONTEXT_ASSEMBLY_DEFAULTS
          .ALLOW_REPRESENTATION_FALLBACK,
    };
  }
}
