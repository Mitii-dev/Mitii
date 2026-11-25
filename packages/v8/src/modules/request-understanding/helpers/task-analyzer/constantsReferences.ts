/**
 * Source file extensions aligned with repository-state language coverage.
 * Supports the top programming languages plus common config/markup formats.
 */
export const TASK_ANALYZER_SOURCE_FILE_EXTENSIONS = [
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "pyi",
  "pyw",
  "java",
  "kt",
  "kts",
  "go",
  "rs",
  "c",
  "h",
  "cpp",
  "cc",
  "cxx",
  "hpp",
  "hxx",
  "cs",
  "rb",
  "php",
  "swift",
  "scala",
  "lua",
  "dart",
  "ex",
  "exs",
  "sol",
  "zig",
  "sql",
  "json",
  "jsonl",
  "yaml",
  "yml",
  "toml",
  "xml",
  "md",
  "mdx",
  "css",
  "scss",
  "sass",
  "less",
  "html",
  "htm",
  "vue",
  "svelte",
  "sh",
  "bash",
  "zsh",
  "tf",
  "tfvars",
  "proto",
  "graphql",
] as const;

export const SOURCE_FILE_EXTENSION_PATTERN = [
  ...TASK_ANALYZER_SOURCE_FILE_EXTENSIONS,
]
  .sort((first, second) => second.length - first.length)
  .join("|");

/**
 * Workspace-relative file cites. Rules that keep this generic:
 * - Path segments may be hidden dirs (`.github/`), relative (`./`, `../`), or
 *   drive-rooted (`C:/`).
 * - Extension match must end at an identifier boundary so
 *   `AppService.createUser` / `this.cartRepository` are not read as `*.c`.
 * - Longer extensions win via SOURCE_FILE_EXTENSION_PATTERN sort order
 *   (`cpp` before `c`, `tsx` before `ts`).
 */
export const FILE_REFERENCE_PATTERN = new RegExp(
  "[`'\"]?((?:(?:[a-zA-Z]:[\\\\/])|(?:\\.{1,2}[\\\\/])|(?:\\.?[a-zA-Z0-9_-]+[\\\\/]))*[a-zA-Z0-9_.-]+\\.(?:" +
    SOURCE_FILE_EXTENSION_PATTERN +
    "))(?![A-Za-z0-9_$])[`'\"]?",
  "gi",
);

export const FOLDER_REFERENCE_PATTERN =
  /(?:^|[\s"'`])((?:\.{1,2}\/|\.?[a-zA-Z0-9_-]+\/)(?:\.?[a-zA-Z0-9_.-]+\/)+)(?=$|[\s"'`,.;:!?)\]}])/g;

/**
 * Common first-segment workspace roots across languages and layouts.
 * Single-segment @mentions use this catalog; multi-segment @paths match
 * generically (any @foo/bar) so layouts are not JS-monorepo-only.
 */
export const WORKSPACE_PATH_ROOT_SEGMENTS = [
  "package",
  "packages",
  "app",
  "apps",
  "lib",
  "libs",
  "service",
  "services",
  "module",
  "modules",
  "src",
  "crate",
  "crates",
  "cmd",
  "internal",
  "pkg",
  "bin",
  "example",
  "examples",
  "testdata",
  "vendor",
  "third_party",
  "third-party",
  "proto",
  "api",
  "backend",
  "frontend",
  "server",
  "client",
  "web",
  "mobile",
  "desktop",
  "tool",
  "tools",
  "script",
  "scripts",
  "config",
  "configs",
  "deploy",
  "infra",
  "chart",
  "charts",
  "helm",
  "doc",
  "docs",
  "test",
  "tests",
  "spec",
  "specs",
] as const;

export const WORKSPACE_PATH_ROOT_ALTERNATION = WORKSPACE_PATH_ROOT_SEGMENTS.join("|");

/**
 * Chat @-mentions for workspace paths:
 * - multi-segment: @apps/docs, @crates/core, @backend/api (layout-neutral)
 * - single-segment roots from WORKSPACE_PATH_ROOT_SEGMENTS
 * Leading @ is stripped when storing the target value.
 */
export const AT_PATH_REFERENCE_PATTERN = new RegExp(
  `(?:^|[\\s"'\\\`])@((?:[A-Za-z_][\\w.-]*(?:\\/[\\w.-]+)+|(?:${WORKSPACE_PATH_ROOT_ALTERNATION})))\\b`,
  "gi",
);

export const SYMBOL_REFERENCE_PATTERN =
  /(?:^|[\s"'`])(?:function|method|class|interface|type|component|symbol|struct|trait|enum|module|namespace|def|fn)\s+[`'"]?([a-zA-Z_$][a-zA-Z0-9_$]*)[`'"]?/gi;

/**
 * Identifiers near runtime / compiler error phrasing across common ecosystems
 * (JS/TS, Python, Rust E-codes, linker unresolved symbols).
 */
export const ERROR_SYMBOL_REFERENCE_PATTERN =
  /(?:\b(?:Identifier|NameError|AttributeError|ImportError|ModuleNotFoundError|ReferenceError|TypeError|SyntaxError|Cannot find (?:name|module)|undefined reference to|unresolved import|error\[E\d+\])\b[^\n`'"]{0,100}[`'"]([A-Za-z_][A-Za-z0-9_$]*)[`'"]|\b(?:ReferenceError|TypeError|SyntaxError|NameError|AttributeError|ImportError|ModuleNotFoundError):\s*([A-Za-z_][A-Za-z0-9_$]*)\b)/g;

export const LOOKS_LIKE_FILE_PATTERN = /(?:^|\/)[^/]+\.[a-zA-Z0-9]+$/;

export const PACKAGE_FOLDER_PATTERN =
  /(?:^|\/)(?:packages?|services?|apps?|libs?|modules?)\/[^/]+\/?$/i;
