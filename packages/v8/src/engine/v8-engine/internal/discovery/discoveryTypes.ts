import type {
  DiscoveryFileRef,
  DiscoveryVerificationHint,
} from "../../../../modules/planning";

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
}
