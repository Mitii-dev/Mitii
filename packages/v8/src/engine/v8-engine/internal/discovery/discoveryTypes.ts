import type {
  DiscoveryFileRef,
  DiscoveryVerificationHint,
} from "../../../../modules/planning";
import type { DiscoveryPassBudget } from "../../modules/plan-discovery/discoveryBudgets";

export interface DiscoveryObservationCollector {
  filesRead: DiscoveryFileRef[];
  searchHits: Array<{ path: string; reason: string }>;
  verificationHints: DiscoveryVerificationHint[];
  fileReads: number;
  searches: number;
  toolCalls: number;
  omittedFilesRead: number;
  omittedSearchHits: number;
  omittedVerificationHints: number;
  /** Resolved discovery envelope for this pass (taskSize × window band). */
  budget: DiscoveryPassBudget;
}
