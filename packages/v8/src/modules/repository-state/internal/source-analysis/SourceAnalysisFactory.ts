import {
  LanguageDetector,
} from "./LanguageDetector";

import {
  SourceAnalysisBuilder,
} from "./SourceAnalysisBuilder";

import {
  SourceAnalysisNormalizer,
} from "./SourceAnalysisNormalizer";

import {
  RegexSourceParser,
} from "./parsers/RegexSourceParser";

import {
  SourceParserRegistry,
} from "./parsers/SourceParserRegistry";

import {
  TreeSitterSourceParser,
} from "./parsers/TreeSitterSourceParser";

import {
  TypeScriptSourceParser,
} from "./parsers/TypeScriptSourceParser";

import type {
  SourceAnalysisFactoryOptions,
  SourceParser,
} from "./types";

export const createSourceAnalysisBuilder = (
  options:
    SourceAnalysisFactoryOptions = {},
): SourceAnalysisBuilder => {
  const parsers:
    SourceParser[] = [
    new TypeScriptSourceParser(),
  ];

  if (options.treeSitterRuntime) {
    parsers.push(
      new TreeSitterSourceParser(
        options.treeSitterRuntime,
      ),
    );
  }

  parsers.push(
    new RegexSourceParser(),
  );

  return new SourceAnalysisBuilder(
    new SourceParserRegistry(
      parsers,
    ),
    new LanguageDetector(
      options.languageDetector,
    ),
    new SourceAnalysisNormalizer(),
    options.builder,
  );
};
