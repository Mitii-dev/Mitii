/** Automation — SDK executor and delivery helpers for the `@mitii/automation` ClaimRunner. */

export { createAutomationRunExecutor } from '../automation/createAutomationRunExecutor.js';
export type { CreateAutomationRunExecutorOptions } from '../automation/createAutomationRunExecutor.js';
export {
  MEMORY_CONSOLIDATE_SCHEDULE_NAME,
  MEMORY_CONSOLIDATE_SCHEDULE_PROMPT,
  buildMemoryConsolidateScheduleInput,
  runMemoryConsolidateWithLease,
} from '../automation/memoryConsolidateRecipe.js';
export { createCompositeDeliverySender } from '../automation/delivery/createCompositeDeliverySender.js';
export type { CreateCompositeDeliverySenderOptions } from '../automation/delivery/createCompositeDeliverySender.js';
export { formatDeliveryMessage } from '../automation/delivery/formatMessage.js';
