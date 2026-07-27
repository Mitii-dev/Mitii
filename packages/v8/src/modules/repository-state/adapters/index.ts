/**
 * Public adapters implementing Repository State ports for hosts and peer modules.
 */
export { InMemoryRepositoryStateStore } from "./InMemoryRepositoryStateStore";
export {
  InMemoryFileSystemAdapter,
} from "../internal/shared/filesystem/InMemoryFileSystemAdapter";
export {
  NodeFileSystemAdapter,
} from "../internal/shared/filesystem/NodeFileSystemAdapter";
export {
  CharacterTokenEstimator,
} from "../internal/chunking/CharacterTokenEstimator";
export {
  TextSearchService,
} from "../internal/text-index/TextSearchService";
export {
  SqliteTextIndexFactory,
} from "../internal/text-index/adapters/sqlite/SqliteTextIndexFactory";
export {
  VectorSearchService,
} from "../internal/vector-index/VectorSearchService";
export {
  EmbeddingVectorValidator,
} from "../internal/embedding/EmbeddingVectorValidator";
export {
  WorkspaceIndexingAdapterFactory,
} from "./WorkspaceIndexingAdapterFactory";
export type {
  WorkspaceIndexingAdapterComponents,
  WorkspaceIndexingAdapterFactoryOptions,
} from "./WorkspaceIndexingAdapterFactory";
