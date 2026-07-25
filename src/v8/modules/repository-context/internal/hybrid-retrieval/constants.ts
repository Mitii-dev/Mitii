export const HYBRID_RETRIEVAL_SCHEMA_VERSION =
  1 as const;

export const HYBRID_RETRIEVAL_IDS = {
  RETRIEVER:
    "hybrid-retriever",
  FACTORY:
    "hybrid-retrieval-factory",
  REQUEST_NORMALIZER:
    "hybrid-retrieval-request-normalizer",
  SOURCE_REGISTRY:
    "retrieval-source-registry",
  CANDIDATE_KEY_BUILDER:
    "retrieval-candidate-key-builder",
  RRF:
    "weighted-reciprocal-rank-fusion",
  TEXT_SOURCE:
    "text-index",
  VECTOR_SOURCE:
    "vector-index",
  REPO_MAP_SOURCE:
    "repo-map",
  REPO_GRAPH_SOURCE:
    "repo-graph",
} as const;

export const HYBRID_RETRIEVAL_DEFAULTS = {
  MAXIMUM_RESULTS:
    40,
  MAXIMUM_CANDIDATES_PER_SOURCE:
    100,
  RANK_CONSTANT:
    60,

  FAILURE_MODE:
    "best_effort",
  MINIMUM_SUCCESSFUL_SOURCES:
    1,

  RERANKER_CANDIDATE_POOL:
    100,
  RERANKER_WEIGHT:
    0.35,
  RERANKER_FAILURE_MODE:
    "fallback_to_fusion",

  TEXT_SOURCE_WEIGHT:
    1,
  VECTOR_SOURCE_WEIGHT:
    1,
  REPO_MAP_SOURCE_WEIGHT:
    0.7,
  REPO_GRAPH_SOURCE_WEIGHT:
    0.85,

  TEXT_SEARCH_MODE:
    "any",
  TEXT_PREFIX_MATCHING:
    true,
  TEXT_SNIPPET_TOKEN_COUNT:
    80,

  VECTOR_MINIMUM_SCORE:
    0,
  VECTOR_CANDIDATE_MULTIPLIER:
    3,

  MAXIMUM_QUERY_CHARACTERS:
    8_000,

  GRAPH_MAXIMUM_NODES_SCANNED:
    100_000,
  GRAPH_MAXIMUM_EDGES_SCANNED:
    250_000,
  GRAPH_MAXIMUM_ANCHOR_NODES:
    24,
  GRAPH_MAXIMUM_NEIGHBORS_PER_ANCHOR:
    12,

  MINIMUM_QUERY_TOKEN_CHARACTERS:
    2,
  MAXIMUM_QUERY_TOKENS:
    64,

  REPO_MAP_MAXIMUM_REASON_EVIDENCE:
    4,

  GRAPH_EXACT_PATH_SCORE:
    1,
  GRAPH_FILE_NAME_SCORE:
    0.92,
  GRAPH_PATH_TOKEN_SCORE:
    0.72,
  GRAPH_EXACT_SYMBOL_SCORE:
    1,
  GRAPH_SYMBOL_SUBSTRING_SCORE:
    0.82,
  GRAPH_NEIGHBOR_SCORE_FACTOR:
    0.65,
  GRAPH_MINIMUM_NEIGHBOR_SCORE:
    0.2,
} as const;

export const HYBRID_RETRIEVAL_LIMITS = {
  MAXIMUM_RESULTS:
    1_000,
  MAXIMUM_CANDIDATES_PER_SOURCE:
    5_000,
  MAXIMUM_FILTER_VALUES:
    1_000,
  MAXIMUM_QUERY_CHARACTERS:
    32_000,
  MAXIMUM_RANK_CONSTANT:
    10_000,
  MAXIMUM_SOURCE_WEIGHT:
    100,
  MAXIMUM_RERANKER_CANDIDATE_POOL:
    5_000,
  MAXIMUM_GRAPH_NODES_SCANNED:
    1_000_000,
  MAXIMUM_GRAPH_EDGES_SCANNED:
    2_000_000,
  MAXIMUM_GRAPH_ANCHORS:
    1_000,
  MAXIMUM_GRAPH_NEIGHBORS_PER_ANCHOR:
    1_000,
} as const;

export const HYBRID_RETRIEVAL_SOURCE_WEIGHTS:
  Readonly<Record<string, number>> = {
  [HYBRID_RETRIEVAL_IDS
    .TEXT_SOURCE]:
    HYBRID_RETRIEVAL_DEFAULTS
      .TEXT_SOURCE_WEIGHT,
  [HYBRID_RETRIEVAL_IDS
    .VECTOR_SOURCE]:
    HYBRID_RETRIEVAL_DEFAULTS
      .VECTOR_SOURCE_WEIGHT,
  [HYBRID_RETRIEVAL_IDS
    .REPO_MAP_SOURCE]:
    HYBRID_RETRIEVAL_DEFAULTS
      .REPO_MAP_SOURCE_WEIGHT,
  [HYBRID_RETRIEVAL_IDS
    .REPO_GRAPH_SOURCE]:
    HYBRID_RETRIEVAL_DEFAULTS
      .REPO_GRAPH_SOURCE_WEIGHT,
};

export const HYBRID_RETRIEVAL_GRAPH_EDGE_TYPES = [
  "imports",
  "references",
] as const;

export const HYBRID_RETRIEVAL_QUERY_STOP_WORDS =
  new Set([
    "add",
    "all",
    "and",
    "are",
    "build",
    "change",
    "code",
    "create",
    "does",
    "explain",
    "file",
    "find",
    "fix",
    "for",
    "from",
    "how",
    "implement",
    "into",
    "module",
    "please",
    "project",
    "refactor",
    "repository",
    "that",
    "the",
    "this",
    "update",
    "what",
    "where",
    "with",
  ]);

export const HYBRID_RETRIEVAL_MESSAGES = {
  CANCELLED:
    "Hybrid retrieval was cancelled.",
  EMPTY_QUERY:
    "The retrieval query is empty after normalization.",
  QUERY_TRUNCATED:
    "The retrieval query exceeded the maximum length and was truncated.",
  DUPLICATE_FILTER_REMOVED:
    "Duplicate retrieval filter values were removed.",
  DUPLICATE_SOURCE_ID:
    "Retrieval source IDs must be unique.",
  INVALID_SOURCE_WEIGHT:
    "Retrieval source weight must be finite and greater than zero.",
  SOURCE_FAILED:
    "A retrieval source failed.",
  REQUIRED_SOURCE_UNAVAILABLE:
    "A required retrieval source was unavailable.",
  SOURCE_TRUNCATED:
    "A retrieval source reached its candidate limit.",
  RESULT_LIMIT_REACHED:
    "The fused retrieval result reached its result limit.",
  RERANKER_FAILED:
    "The optional retrieval reranker failed; fused ordering was retained.",
  RERANKER_REQUIRED_FAILED:
    "The required retrieval reranker failed.",
  RERANKER_INCOMPLETE:
    "The reranker did not return a score for every candidate; missing candidates retained their fused score.",
  SNAPSHOT_MISMATCH:
    "Repository intelligence was produced from a different workspace snapshot.",
  CHANGE_TOKEN_MISMATCH:
    "Repo Map and Repo Graph were produced from different Code Index revisions.",
  VECTOR_DEPENDENCY_MISMATCH:
    "vectorIndex and embeddingProvider must be configured together.",
  FAILURE_POLICY_UNSATISFIED:
    "The configured retrieval source failure policy was not satisfied.",
  MINIMUM_SOURCES_UNSATISFIED:
    "The minimum successful retrieval source count was not satisfied.",
} as const;
