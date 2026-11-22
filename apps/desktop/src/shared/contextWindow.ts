/**
 * Desktop context-window helpers — owned by `@mitii/ui-core` (renderer-safe).
 * Keep this file as a thin re-export so existing Desktop imports stay stable.
 */

export {
  DEFAULT_CONTEXT_WINDOW,
  clampMaximumOutputTokensToContext,
  inferContextWindowFromModelId,
  inferMaximumOutputTokensFromModelId,
  resolveEffectiveContextWindow,
} from '@mitii/ui-core';
