import {
  CONTEXT_SELECTION_DEFAULTS,
} from "./constants";

import type {
  ContextSelectorOptions,
  ResolvedContextSelectorOptions,
} from "./types";

export class ContextSelectionOptionsResolver {
  public resolve(
    options:
      ContextSelectorOptions = {},
  ): ResolvedContextSelectorOptions {
    return {
      requiredOverflowMode:
        options
          .requiredOverflowMode ??
        CONTEXT_SELECTION_DEFAULTS
          .REQUIRED_OVERFLOW_MODE,
    };
  }
}
