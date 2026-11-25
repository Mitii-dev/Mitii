import type {
  RepositoryContextPipelineInput,
  RepositoryContextSelectorPort,
} from "../../contracts/types";
import type { HybridRetrievalResult } from "../../helpers/hybrid-retrieval/types";
import type { ContextSelectionResult } from "../../helpers/context-selection/types";
import type { PreparedRepositoryContextRetrieval } from "../types";

export function selectRepositoryContext(params: {
  input: RepositoryContextPipelineInput;
  retrieval: HybridRetrievalResult;
  prepared: PreparedRepositoryContextRetrieval;
  selector: RepositoryContextSelectorPort;
}): ContextSelectionResult {
  const { input, retrieval, prepared, selector } = params;
  return selector.select({
    query: input.query,
    retrieval,
    mode: input.mode,
    ...(input.breadth ? { breadth: input.breadth } : {}),
    ...(prepared.focusedReferences
      ? { references: prepared.focusedReferences }
      : {}),
    ...(input.selectionBudget ? { budget: input.selectionBudget } : {}),
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  });
}
