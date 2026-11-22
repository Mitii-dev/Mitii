/** Corpus RAG — optional `.mitii/corpus/` text index and retrieval. */

export {
  runCorpusIndex,
  loadCorpusIndex,
  corpusDirectory,
  corpusIndexPath,
  corpusIndexExists,
  CORPUS_DIR_NAME,
  CORPUS_INDEX_FILE,
  CORPUS_INDEX_SCHEMA_VERSION,
} from '../corpus/corpusIndex.js';
export type {
  CorpusIndex,
  CorpusFileEntry,
  CorpusChunk,
} from '../corpus/corpusIndex.js';
export { CorpusRetrievalSource } from '../corpus/CorpusRetrievalSource.js';
