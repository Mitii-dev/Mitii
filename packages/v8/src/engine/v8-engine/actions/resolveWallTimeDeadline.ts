/** Shim — owner is runtime/helpers/budgets. */
export {
  WALL_TIME_WRAP_UP,
  resolveWallTimeReserveMs,
  isWithinWallTimeReserve,
  decideWallTimeDeadline,
  buildWallTimeWrapUpNudge,
} from "../../../runtime/helpers/budgets";
export type { WallTimeDeadlineAction } from "../../../runtime/helpers/budgets";
