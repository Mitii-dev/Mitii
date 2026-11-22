/**
 * Desktop context-window helpers — owned by `@mitii/host`.
 * Keep this file as a thin re-export so existing Desktop imports stay stable.
 */

export {
  DEFAULT_CONTEXT_WINDOW,
  clampMaximumOutputTokensToContext,
  inferContextWindowFromModelId,
  inferMaximumOutputTokensFromModelId,
  resolveEffectiveContextWindow,
} from '@mitii/host';
