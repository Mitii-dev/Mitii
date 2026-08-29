import type { RepoGraphEdgeType } from "../repository-state";

import {
  DEFAULT_CHANGE_IMPACT_MAXIMUM_AFFECTED_NODES,
  DEFAULT_CHANGE_IMPACT_MAXIMUM_HOPS,
  DEFAULT_CHANGE_IMPACT_MAXIMUM_PACKAGES,
} from "./defaults";

export const CHANGE_IMPACT_POLICY = {
  maximumHops: DEFAULT_CHANGE_IMPACT_MAXIMUM_HOPS,
  maximumHopsCap: 6,
  maximumAffectedNodes: DEFAULT_CHANGE_IMPACT_MAXIMUM_AFFECTED_NODES,
  maximumAffectedNodesCap: 200,
  maximumPackages: DEFAULT_CHANGE_IMPACT_MAXIMUM_PACKAGES,
  defaultEdgeTypes: [
    "calls",
    "imports",
    "references",
    "depends_on",
  ] as const satisfies readonly RepoGraphEdgeType[],
  reverseEdgeTypes: new Set<RepoGraphEdgeType>([
    "calls",
    "imports",
    "references",
    "depends_on",
    "development_depends_on",
  ]),
  edgeTypeScore: {
    calls: 1,
    imports: 0.86,
    references: 0.78,
    depends_on: 0.7,
    development_depends_on: 0.55,
  } as const satisfies Partial<Record<RepoGraphEdgeType, number>>,
} as const;
