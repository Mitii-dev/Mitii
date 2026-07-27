/**
 * Public turn-output headroom helper for Engine preflight / recovery.
 * Algorithm lives in actions/; this facade avoids exporting actions/ from index.
 */
export {
  estimateTurnOutputHeadroom,
} from "./actions/EstimateTurnOutputHeadroom";
export type { TurnOutputHeadroom } from "./actions/EstimateTurnOutputHeadroom";
