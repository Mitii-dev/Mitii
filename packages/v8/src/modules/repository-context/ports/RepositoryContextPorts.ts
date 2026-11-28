import type {
  ContextAssemblyInput,
  ContextAssemblyResult,
} from "../helpers/context-assembly/types";
import type {
  ContextSelectionInput,
  ContextSelectionResult,
} from "../helpers/context-selection/types";
import type {
  HybridRetrievalInput,
  HybridRetrievalResult,
} from "../helpers/hybrid-retrieval/types";
import type { RepositoryStateReference } from "../../repository-state/index";
import type { RepositoryContextStateResolveResult } from "../contracts/types";

export interface RepositoryContextStateResolverPort {
  resolve(
    reference: RepositoryStateReference,
  ): Promise<RepositoryContextStateResolveResult>;
}

export interface RepositoryContextRetrieverPort {
  retrieve(input: HybridRetrievalInput): Promise<HybridRetrievalResult>;
}

export interface RepositoryContextSelectorPort {
  select(input: ContextSelectionInput): ContextSelectionResult;
}

export interface RepositoryContextAssemblerPort {
  assemble(input: ContextAssemblyInput): Promise<ContextAssemblyResult>;
}

export interface RepositoryContextPipelineDependencies {
  stateResolver: RepositoryContextStateResolverPort;
  retriever: RepositoryContextRetrieverPort;
  selector: RepositoryContextSelectorPort;
  assembler: RepositoryContextAssemblerPort;
}
