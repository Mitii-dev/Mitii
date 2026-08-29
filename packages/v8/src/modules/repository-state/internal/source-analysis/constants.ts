import type {
  SourceAnalysisBuilderOptions,
  SourceFileReaderOptions,
  SourceLanguageId,
} from "./types";

export const SOURCE_ANALYSIS_SCHEMA_VERSION =
  1 as const;

export const SOURCE_ANALYSIS_IDS = {
  SYMBOL_PREFIX: "local-symbol",
} as const;

export const SOURCE_ANALYSIS_DEFAULTS = {
  MAXIMUM_FILE_BYTES: 2 * 1024 * 1024,

  MAXIMUM_SYMBOLS: 500,
  MAXIMUM_IMPORTS: 1_000,
  MAXIMUM_REFERENCES: 2_000,

  PARSER_SAFETY_MULTIPLIER: 2,

  MAXIMUM_SIGNATURE_CHARACTERS: 240,
  MAXIMUM_SIGNATURE_LINES: 3,

  FALLBACK_ON_EMPTY_RESULT: true,
  MINIMUM_REFERENCE_NAME_LENGTH: 2,
} as const;

export const SOURCE_PARSER_PRIORITIES = {
  TYPESCRIPT: 300,
  TREE_SITTER: 200,
  REGEX: 100,
} as const;

export const SOURCE_PARSER_IDS = {
  TYPESCRIPT: "typescript-compiler",
  TREE_SITTER: "tree-sitter",
  REGEX: "regex",
} as const;

export const SOURCE_LANGUAGE_BASENAMES: Readonly<
  Record<string, SourceLanguageId>
> = {
  dockerfile: "dockerfile",
  makefile: "make",
  "cmakelists.txt": "cmake",
  "go.mod": "gomod",
  "go.sum": "gomod",
  "requirements.txt": "python",
  "meson.build": "meson",
  build: "starlark",
  workspace: "starlark",
};

/**
 * Dialects that are not first-class LanguageProfileRegistry IDs.
 * Target-language extensions live only on LanguageProfileRegistry.
 */
export const SOURCE_LANGUAGE_DIALECT_EXTENSIONS: Readonly<
  Record<string, SourceLanguageId>
> = {
  ".scala": "scala",

  ".lua": "lua",
  ".ex": "elixir",
  ".exs": "elixir",
  ".sol": "solidity",
  ".zig": "zig",
  ".dart": "dart",
  ".hs": "haskell",
  ".lhs": "haskell",

  ".tf": "hcl",
  ".tfvars": "hcl",
  ".proto": "proto",

  ".vue": "vue",
  ".svelte": "svelte",
  ".css": "css",
  ".scss": "scss",

  ".json": "json",
  ".jsonl": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".xml": "xml",
  ".html": "html",
  ".htm": "html",

  ".md": "markdown",
  ".mdx": "markdown",
};

export const TYPESCRIPT_SOURCE_LANGUAGES =
  new Set<SourceLanguageId>([
    "typescript",
    "tsx",
    "javascript",
  ]);

export const SOURCE_SYMBOL_KIND_BY_NODE_TYPE: Readonly<
  Record<string, string>
> = {
  class_declaration: "class",
  class_definition: "class",
  class_specifier: "class",
  abstract_class_declaration: "class",
  interface_declaration: "interface",
  protocol_declaration: "interface",
  struct_item: "struct",
  struct_specifier: "struct",
  struct_declaration: "struct",
  trait_item: "trait",
  trait_definition: "trait",
  enum_declaration: "enum",
  enum_definition: "enum",
  enum_item: "enum",
  enum_specifier: "enum",
  function_declaration: "function",
  function_definition: "function",
  function_item: "function",
  function_signature: "function",
  generator_function_declaration: "function",
  method_definition: "method",
  method_declaration: "method",
  method_signature: "method",
  type_alias_declaration: "type",
  type_declaration: "type",
  type_spec: "type",
  type_alias: "type",
  module: "module",
  module_definition: "module",
  namespace_declaration: "module",
  object_declaration: "class",
  object_definition: "class",
  contract_declaration: "contract",
  variable_declaration: "variable",
  lexical_declaration: "const",
  FnProto: "function",
};

export interface RegexSourceSymbolPattern {
  pattern: RegExp;
  kind: string;
}

export const SOURCE_REGEX_SYMBOL_PATTERNS: Readonly<
  Record<
    SourceLanguageId,
    readonly RegexSourceSymbolPattern[]
  >
> = {
  typescript: [
    {
      pattern:
        /^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
      kind: "class",
    },
    {
      pattern:
        /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/,
      kind: "interface",
    },
    {
      pattern:
        /^(?:export\s+)?(?:async\s+)?function\s+\*?\s*([A-Za-z_$][\w$]*)/,
      kind: "function",
    },
    {
      pattern:
        /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/,
      kind: "type",
    },
    {
      pattern:
        /^(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/,
      kind: "enum",
    },
    {
      pattern:
        /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*[=:]/,
      kind: "const",
    },
  ],

  tsx: [
    {
      pattern:
        /^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
      kind: "class",
    },
    {
      pattern:
        /^(?:export\s+)?(?:async\s+)?function\s+\*?\s*([A-Za-z_$][\w$]*)/,
      kind: "function",
    },
    {
      pattern:
        /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*[=:]/,
      kind: "const",
    },
  ],

  javascript: [
    {
      pattern:
        /^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/,
      kind: "class",
    },
    {
      pattern:
        /^(?:export\s+)?(?:async\s+)?function\s+\*?\s*([A-Za-z_$][\w$]*)/,
      kind: "function",
    },
    {
      pattern:
        /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*[=:]/,
      kind: "const",
    },
  ],

  python: [
    {
      pattern:
        /^(?:async\s+)?def\s+([A-Za-z_]\w*)/,
      kind: "function",
    },
    {
      pattern:
        /^class\s+([A-Za-z_]\w*)/,
      kind: "class",
    },
  ],

  java: [
    {
      pattern:
        /^(?:(?:public|private|protected|abstract|final|static)\s+)*class\s+([A-Za-z_]\w*)/,
      kind: "class",
    },
    {
      pattern:
        /^(?:(?:public|private|protected|abstract|static)\s+)*interface\s+([A-Za-z_]\w*)/,
      kind: "interface",
    },
    {
      pattern:
        /^(?:(?:public|private|protected|static|final|synchronized|abstract)\s+)+[\w<>,?[\]\s]+\s+([A-Za-z_]\w*)\s*\(/,
      kind: "method",
    },
  ],

  go: [
    {
      pattern:
        /^func\s+(?:\([^)]*\)\s+)?([A-Za-z_]\w*)/,
      kind: "function",
    },
    {
      pattern:
        /^type\s+([A-Za-z_]\w*)\s+struct/,
      kind: "struct",
    },
    {
      pattern:
        /^type\s+([A-Za-z_]\w*)\s+interface/,
      kind: "interface",
    },
  ],

  rust: [
    {
      pattern:
        /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/,
      kind: "function",
    },
    {
      pattern:
        /^(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)/,
      kind: "struct",
    },
    {
      pattern:
        /^(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)/,
      kind: "enum",
    },
    {
      pattern:
        /^(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_]\w*)/,
      kind: "trait",
    },
  ],

  c: [
    {
      pattern:
        /^(?:static\s+)?(?:[\w*]+\s+)+([A-Za-z_]\w*)\s*\([^;]*\)\s*\{/,
      kind: "function",
    },
    {
      pattern:
        /^typedef\s+struct\s+([A-Za-z_]\w*)/,
      kind: "struct",
    },
  ],

  cpp: [
    {
      pattern:
        /^(?:class|struct)\s+([A-Za-z_]\w*)/,
      kind: "class",
    },
    {
      pattern:
        /^(?:(?:virtual|static|inline|constexpr)\s+)*(?:[\w:*&<>]+\s+)+([A-Za-z_]\w*)\s*\([^;]*\)/,
      kind: "function",
    },
  ],

  csharp: [
    {
      pattern:
        /^(?:(?:public|private|protected|internal|static|abstract|sealed)\s+)*class\s+([A-Za-z_]\w*)/,
      kind: "class",
    },
    {
      pattern:
        /^(?:(?:public|private|protected|internal|static)\s+)*interface\s+([A-Za-z_]\w*)/,
      kind: "interface",
    },
    {
      pattern:
        /^(?:(?:public|private|protected|internal|static|async)\s+)+[\w<>,?[\]\s]+\s+([A-Za-z_]\w*)\s*\(/,
      kind: "method",
    },
  ],

  ruby: [
    {
      pattern:
        /^class\s+([A-Za-z_]\w*)/,
      kind: "class",
    },
    {
      pattern:
        /^module\s+([A-Za-z_]\w*)/,
      kind: "module",
    },
    {
      pattern:
        /^def\s+(?:self\.)?([A-Za-z_]\w*[!?=]?)/,
      kind: "method",
    },
  ],

  php: [
    {
      pattern:
        /^(?:abstract\s+|final\s+)?class\s+([A-Za-z_]\w*)/,
      kind: "class",
    },
    {
      pattern:
        /^(?:(?:public|private|protected|static)\s+)*function\s+([A-Za-z_]\w*)/,
      kind: "function",
    },
  ],

  kotlin: [
    {
      pattern:
        /^(?:data\s+|sealed\s+|open\s+)?class\s+([A-Za-z_]\w*)/,
      kind: "class",
    },
    {
      pattern:
        /^fun\s+([A-Za-z_]\w*)/,
      kind: "function",
    },
    {
      pattern:
        /^interface\s+([A-Za-z_]\w*)/,
      kind: "interface",
    },
  ],

  swift: [
    {
      pattern:
        /^(?:(?:public|private|internal|open)\s+)?(?:class|struct|enum|protocol)\s+([A-Za-z_]\w*)/,
      kind: "type",
    },
    {
      pattern:
        /^func\s+([A-Za-z_]\w*)/,
      kind: "function",
    },
  ],

  scala: [
    {
      pattern:
        /^(?:case\s+)?class\s+([A-Za-z_]\w*)/,
      kind: "class",
    },
    {
      pattern:
        /^(?:case\s+)?object\s+([A-Za-z_]\w*)/,
      kind: "object",
    },
    {
      pattern:
        /^def\s+([A-Za-z_]\w*)/,
      kind: "function",
    },
    {
      pattern:
        /^trait\s+([A-Za-z_]\w*)/,
      kind: "trait",
    },
  ],

  lua: [
    {
      pattern:
        /^(?:local\s+)?function\s+([A-Za-z_]\w*)/,
      kind: "function",
    },
  ],

  elixir: [
    {
      pattern:
        /^defmodule\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/,
      kind: "module",
    },
    {
      pattern:
        /^defp?\s+([A-Za-z_]\w*[!?]?)/,
      kind: "function",
    },
  ],

  solidity: [
    {
      pattern:
        /^(?:abstract\s+)?contract\s+([A-Za-z_]\w*)/,
      kind: "contract",
    },
    {
      pattern:
        /^interface\s+([A-Za-z_]\w*)/,
      kind: "interface",
    },
    {
      pattern:
        /^function\s+([A-Za-z_]\w*)/,
      kind: "function",
    },
  ],

  zig: [
    {
      pattern:
        /^(?:pub\s+)?fn\s+([A-Za-z_]\w*)/,
      kind: "function",
    },
    {
      pattern:
        /^(?:pub\s+)?const\s+([A-Za-z_]\w*)/,
      kind: "const",
    },
  ],

  haskell: [
    {
      pattern:
        /^([a-z_]\w*)\s+::/,
      kind: "type",
    },
  ],

  bash: [
    {
      pattern:
        /^(?:function\s+)?([A-Za-z_]\w*)\s*\(\)\s*\{/,
      kind: "function",
    },
  ],

  shell: [
    {
      pattern:
        /^(?:function\s+)?([A-Za-z_]\w*)\s*\(\)\s*\{/,
      kind: "function",
    },
  ],

  sql: [
    {
      pattern:
        /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|FUNCTION|PROCEDURE)\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([A-Za-z_]\w*)/i,
      kind: "definition",
    },
  ],

  hcl: [
    {
      pattern:
        /^(?:resource|variable|output|module|provider)\s+"([^"]+)"/,
      kind: "block",
    },
  ],

  svelte: [
    {
      pattern:
        /^(?:export\s+)?(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/,
      kind: "export",
    },
  ],
};

export const SOURCE_GENERIC_IMPORT_PATTERNS = [
  {
    kind: "static" as const,
    pattern:
      /^\s*import\s+(?:type\s+)?(?:[\w*{}\s,$]+)\s+from\s+["']([^"']+)["']/,
  },
  {
    kind: "static" as const,
    pattern:
      /^\s*import\s+["']([^"']+)["']/,
  },
  {
    kind: "reexport" as const,
    pattern:
      /^\s*export\s+(?:type\s+)?(?:[\w*{}\s,$]+)\s+from\s+["']([^"']+)["']/,
  },
  {
    kind: "require" as const,
    pattern:
      /require\s*\(\s*["']([^"']+)["']\s*\)/,
  },
  {
    kind: "dynamic" as const,
    pattern:
      /\bimport\s*\(\s*["']([^"']+)["']\s*\)/,
  },
  {
    kind: "static" as const,
    pattern:
      /^\s*from\s+([A-Za-z_][\w.]*)\s+import\b/,
  },
  {
    kind: "static" as const,
    pattern:
      /^\s*import\s+([A-Za-z_][\w.]*)/,
  },
] as const;

export {
  SOURCE_TREE_SITTER_REFERENCE_QUERIES,
  SOURCE_TREE_SITTER_SYMBOL_QUERIES,
} from "./queries/TreeSitterQueryCatalog";

export const resolveSourceFileReaderOptions = (
  options: SourceFileReaderOptions = {},
): Required<SourceFileReaderOptions> => ({
  maximumBytes:
    options.maximumBytes ??
    SOURCE_ANALYSIS_DEFAULTS
      .MAXIMUM_FILE_BYTES,
});

export const resolveSourceAnalysisBuilderOptions = (
  options: SourceAnalysisBuilderOptions = {},
): Required<SourceAnalysisBuilderOptions> => ({
  fallbackOnEmptyResult:
    options.fallbackOnEmptyResult ??
    SOURCE_ANALYSIS_DEFAULTS
      .FALLBACK_ON_EMPTY_RESULT,
});

