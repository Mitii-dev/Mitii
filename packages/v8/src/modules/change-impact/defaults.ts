export const DEFAULT_CHANGE_IMPACT_MAXIMUM_HOPS = 3;
export const DEFAULT_CHANGE_IMPACT_MAXIMUM_AFFECTED_NODES = 80;
export const DEFAULT_CHANGE_IMPACT_MAXIMUM_PACKAGES = 20;
export const DEFAULT_CHANGE_IMPACT_MAXIMUM_EVIDENCE_PER_NODE = 5;

/**
 * Model-facing caps: keep sequencing useful under tool-result budgets.
 * Full walk may still visit up to maximumAffectedNodes; the tool output
 * prefers affectedFiles and a top-N affected node slice.
 */
export const DEFAULT_CHANGE_IMPACT_MODEL_FACING_AFFECTED_NODES = 8;
export const DEFAULT_CHANGE_IMPACT_MODEL_FACING_EVIDENCE_PER_NODE = 1;
export const DEFAULT_CHANGE_IMPACT_MODEL_FACING_AFFECTED_FILES = 24;
