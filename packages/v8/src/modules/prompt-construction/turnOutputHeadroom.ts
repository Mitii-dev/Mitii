/**
 * Public turn-output headroom helper for Engine preflight / recovery.
 * Algorithm lives in helpers/; this facade avoids exporting helpers/ from index.
 */
export {
  estimateTurnOutputHeadroom,
} from "./helpers/EstimateTurnOutputHeadroom";
export type { TurnOutputHeadroom } from "./helpers/EstimateTurnOutputHeadroom";
