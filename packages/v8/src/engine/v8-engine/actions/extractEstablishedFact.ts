/**
 * Shim — owner is runtime/helpers/established-facts.
 */
export {
  extractEstablishedFact,
  upsertEstablishedFact,
  dropEstablishedFactsForPaths,
  extractCompilerErrorQueue,
  extractOutOfScopePaths,
  extractCompilerErrorPaths,
  parseCompilerErrorItems,
} from "../../../runtime/helpers/established-facts";
export type {
  EstablishedFact,
  CompilerErrorItem,
} from "../../../runtime/helpers/established-facts";
