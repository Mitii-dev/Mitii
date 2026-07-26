#!/usr/bin/env node
/**
 * Phase 0: Move src/v8/* into src/v8/modules/* and rewrite relative imports.
 * Run from repo root: node scripts/migrate-v8-phase0.mjs
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const v8Root = join(repoRoot, "src/v8");
const modulesRoot = join(v8Root, "modules");

const REPOSITORY_STATE_INTERNAL = [
  "workspace",
  "catalog",
  "source-analysis",
  "chunking",
  "code-index",
  "code-indexing",
  "text-index",
  "embedding",
  "vector-index",
  "repo-graph",
  "repo-map",
  "shared",
];

const REPOSITORY_CONTEXT_INTERNAL = [
  "hybrid-retrieval",
  "context-selection",
  "context-assembly",
];

function copyTree(src, dest) {
  if (!existsSync(src)) {
    throw new Error(`Missing source: ${src}`);
  }
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
}

function listTsFiles(dir) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const abs = join(current, entry);
      if (statSync(abs).isDirectory()) {
        walk(abs);
      } else if (entry.endsWith(".ts")) {
        files.push(abs);
      }
    }
  };
  walk(dir);
  return files;
}

function moveDir(src, dest) {
  copyTree(src, dest);
  rmSync(src, { recursive: true, force: true });
}

function rewriteImports(filePath, rewriter) {
  const original = readFileSync(filePath, "utf8");
  const updated = rewriter(original, filePath);
  if (updated !== original) {
    writeFileSync(filePath, updated);
  }
}

/** Resolve a relative import from fromFile to the target path. */
function relImport(fromFile, toPath) {
  const fromDir = dirname(fromFile);
  let rel = relative(fromDir, toPath).replace(/\\/g, "/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel.replace(/\.ts$/, "");
}

function buildImportRewriter(moduleRoots) {
  return (content, filePath) => {
    let result = content;

    // Cross-module public imports
    result = result.replace(
      /from ["']\.\.\/\.\.\/core\/interaction-mode(?:\/index)?["']/g,
      'from "../../../request-intake"',
    );
    result = result.replace(
      /from ["']\.\.\/core\/interaction-mode(?:\/index)?["']/g,
      'from "../../request-intake"',
    );
    result = result.replace(
      /from ["']\.\.\/interaction-mode(?:\/index)?["']/g,
      'from "../interaction-mode"',
    );
    result = result.replace(
      /from ["']\.\.\/\.\.\/interaction-mode(?:\/index)?["']/g,
      'from "../../interaction-mode"',
    );
    result = result.replace(
      /from ["']\.\.\/core\/model-gateway(?:\/index)?["']/g,
      'from "../../model-gateway"',
    );
    result = result.replace(
      /from ["']\.\.\/\.\.\/core\/model-gateway(?:\/index)?["']/g,
      'from "../../../model-gateway"',
    );
    result = result.replace(
      /from ["']\.\.\/core\/request-envelope(?:\/index)?["']/g,
      'from "../../request-intake"',
    );

    // Old intent/task-analyzer paths within request-understanding
    result = result.replace(
      /from ["']\.\.\/intent(?:\/index)?["']/g,
      'from ".."',
    );

    // repository-state public types from repository-context internals
    const statePublic = join(modulesRoot, "repository-state/index.ts");
    if (filePath.includes("repository-context")) {
      for (const [pattern, sub] of [
        [/\.\.\/\.\.\/workspace\/types/g, "workspace/types"],
        [/\.\.\/workspace\/types/g, "workspace/types"],
        [/\.\.\/\.\.\/repo-graph\/schema/g, "repo-graph/schema"],
        [/\.\.\/repo-graph\/schema/g, "repo-graph/schema"],
        [/\.\.\/\.\.\/repo-map\/schema/g, "repo-map/schema"],
        [/\.\.\/repo-map\/schema/g, "repo-map/schema"],
        [/\.\.\/\.\.\/chunking\/types/g, "chunking/types"],
        [/\.\.\/chunking\/types/g, "chunking/types"],
        [/\.\.\/\.\.\/chunking\/CharacterTokenEstimator/g, "chunking/CharacterTokenEstimator"],
        [/\.\.\/chunking\/CharacterTokenEstimator/g, "chunking/CharacterTokenEstimator"],
        [/\.\.\/\.\.\/text-index\/types/g, "text-index/types"],
        [/\.\.\/text-index\/types/g, "text-index/types"],
        [/\.\.\/\.\.\/vector-index\/types/g, "vector-index/types"],
        [/\.\.\/vector-index\/types/g, "vector-index/types"],
      ]) {
        result = result.replace(
          new RegExp(`from ["']${pattern.source}["']`, "g"),
          (_m) => {
            const target = join(modulesRoot, "repository-state/internal", sub);
            return `from "${relImport(filePath, target)}"`;
          },
        );
      }
    }

    // Fix internal paths after directory moves within same module
    if (filePath.includes("repository-state/internal")) {
      result = result.replace(
        /from ["']\.\.\/\.\.\/(workspace|catalog|chunking|code-index|code-indexing|text-index|embedding|vector-index|repo-graph|repo-map|shared|source-analysis|ws-indexing-pipeline)/g,
        'from "../$1',
      );
      result = result.replace(
        /from ["']\.\.\/(ws-indexing-pipeline)/g,
        'from "../../pipeline/$1',
      );
    }

    if (filePath.includes("repository-state/pipeline")) {
      result = result.replace(
        /from ["']\.\.\/(workspace|catalog|chunking|code-index|code-indexing|text-index|embedding|vector-index|repo-graph|repo-map|shared|source-analysis)/g,
        'from "../internal/$1',
      );
    }

    if (filePath.includes("repository-context/internal")) {
      result = result.replace(
        /from ["']\.\.\/\.\.\/(hybrid-retrieval|context-selection|context-assembly)/g,
        'from "../$1',
      );
      result = result.replace(
        /from ["']\.\.\/(hybrid-retrieval|context-selection|context-assembly)/g,
        'from "../$1',
      );
    }

    if (filePath.includes("repository-context/pipeline")) {
      result = result.replace(
        /from ["']\.\.\/(hybrid-retrieval|context-selection|context-assembly)/g,
        'from "../internal/$1',
      );
    }

    return result;
  };
}

function migrate() {
  if (existsSync(modulesRoot)) {
    rmSync(modulesRoot, { recursive: true, force: true });
  }
  mkdirSync(modulesRoot, { recursive: true });

  // request-intake
  const intakeRoot = join(modulesRoot, "request-intake");
  moveDir(join(v8Root, "core/interaction-mode"), join(intakeRoot, "interaction-mode"));
  moveDir(join(v8Root, "core/request-envelope"), join(intakeRoot, "request-envelope"));

  // model-gateway
  moveDir(join(v8Root, "core/model-gateway"), join(modulesRoot, "model-gateway"));

  // request-understanding
  const understandingRoot = join(modulesRoot, "request-understanding");
  moveDir(join(v8Root, "intent"), join(understandingRoot, "intent"));
  moveDir(join(v8Root, "task-analyzer"), join(understandingRoot, "task-analyzer"));

  // repository-state
  const stateRoot = join(modulesRoot, "repository-state");
  mkdirSync(join(stateRoot, "internal"), { recursive: true });
  for (const dir of REPOSITORY_STATE_INTERNAL) {
    moveDir(join(v8Root, "repository", dir), join(stateRoot, "internal", dir));
  }
  moveDir(
    join(v8Root, "repository/ws-indexing-pipeline"),
    join(stateRoot, "pipeline/ws-indexing-pipeline"),
  );

  // repository-context
  const contextRoot = join(modulesRoot, "repository-context");
  mkdirSync(join(contextRoot, "internal"), { recursive: true });
  moveDir(
    join(v8Root, "repository/context-pipeline"),
    join(contextRoot, "pipeline/context-pipeline"),
  );
  for (const dir of REPOSITORY_CONTEXT_INTERNAL) {
    moveDir(join(v8Root, "repository", dir), join(contextRoot, "internal", dir));
  }

  // Remove old empty dirs
  for (const leftover of ["core", "intent", "task-analyzer", "repository"]) {
    const p = join(v8Root, leftover);
    if (existsSync(p)) rmSync(p, { recursive: true, force: true });
  }

  // Module index files
  writeFileSync(
    join(intakeRoot, "index.ts"),
    `export * from "./interaction-mode";
export * from "./request-envelope";
export { UserRequestEnvelopeBuilder } from "./request-envelope/UserRequestEnvelopeBuilder";
`,
  );

  writeFileSync(
    join(modulesRoot, "model-gateway/index.ts"),
    readFileSync(join(modulesRoot, "model-gateway/index.ts"), "utf8").replace(
      /export \* from "\.\/model-gateway"/,
      "",
    ),
  );

  writeFileSync(
    join(understandingRoot, "index.ts"),
    `export * from "./intent";
export * from "./task-analyzer";
export { IntentRouter } from "./intent/IntentRouter";
`,
  );

  writeFileSync(
    join(stateRoot, "index.ts"),
    `export * from "./pipeline/ws-indexing-pipeline";
export { WorkspaceIndexingPipeline } from "./pipeline/ws-indexing-pipeline/WorkspaceIndexingPipeline";
export type { WorkspaceSnapshot, WorkspaceFileEntry } from "./internal/workspace/types";
export type { RepoGraph } from "./internal/repo-graph/types";
export type { RepoMap } from "./internal/repo-map/types";
export type { TextChunk } from "./internal/chunking/types";
`,
  );

  writeFileSync(
    join(contextRoot, "index.ts"),
    `export * from "./pipeline/context-pipeline";
export { RepositoryContextPipeline } from "./pipeline/context-pipeline/RepositoryContextPipeline";
`,
  );

  writeFileSync(
    join(v8Root, "index.ts"),
    `export { UserRequestEnvelopeBuilder } from "./modules/request-intake";
export type { UserRequestEnvelope, CreateUserRequestInput } from "./modules/request-intake";
export type { AgentMode } from "./modules/request-intake";
export { IntentRouter } from "./modules/request-understanding";
export { WorkspaceIndexingPipeline } from "./modules/repository-state";
export { RepositoryContextPipeline } from "./modules/repository-context";
export type { LlmPort, ModelRequest, ModelCapabilities } from "./modules/model-gateway";
export { ModelCapabilityResolver } from "./modules/model-gateway";
`,
  );

  const rewriter = buildImportRewriter(modulesRoot);
  const allTs = listTsFiles(join(v8Root, "modules"));
  for (const file of allTs) {
    rewriteImports(file, rewriter);
  }

  console.log(`Migrated ${allTs.length} TypeScript files under src/v8/modules/`);
}

migrate();
