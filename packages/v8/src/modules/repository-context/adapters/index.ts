/**
 * Public adapters implementing Repository Context ports for hosts and peers.
 */
export { ContextAssemblyFactory } from "../internal/context-assembly/ContextAssemblyFactory";
export { ContextSelector } from "../internal/context-selection/ContextSelector";
export { HybridRetrievalFactory } from "../internal/hybrid-retrieval/HybridRetrievalFactory";
export type {
  ContextAssemblyInput,
  ContextAssemblyResult,
} from "../internal/context-assembly/types";
export type {
  ContextSelectionInput,
  ContextSelectionResult,
} from "../internal/context-selection/types";
export type {
  HybridRetrievalInput,
  HybridRetrievalResult,
} from "../internal/hybrid-retrieval/types";
