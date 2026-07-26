#!/usr/bin/env node
/**
 * Fix import paths after Phase 0 V8 module migration.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modulesRoot = join(repoRoot, "src/v8/modules");

const STATE_INTERNAL = join(modulesRoot, "repository-state/internal");
const INTAKE = join(modulesRoot, "request-intake");

function listTsFiles(dir) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const abs = join(current, entry);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (entry.endsWith(".ts")) files.push(abs);
    }
  };
  walk(dir);
  return files;
}

function rel(fromFile, toAbsPath) {
  let r = relative(dirname(fromFile), toAbsPath).replace(/\\/g, "/");
  if (!r.startsWith(".")) r = `./${r}`;
  return r;
}

function replaceImport(content, fromFile, oldPrefix, newAbsDir) {
  const patterns = [
    new RegExp(`from ["']${escapeRegex(oldPrefix)}([^"']*)["']`, "g"),
    new RegExp(`from ["']${escapeRegex(oldPrefix)}/index["']`, "g"),
  ];

  let result = content;
  for (const pattern of patterns) {
    result = result.replace(pattern, (_match, subpath = "") => {
      const target = subpath
        ? join(newAbsDir, subpath)
        : join(newAbsDir, "index.ts");
      return `from "${rel(fromFile, target)}"`;
    });
  }
  return result;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fixFile(filePath) {
  let content = readFileSync(filePath, "utf8");
  const original = content;

  // repository-context → repository-state cross-module imports
  if (filePath.includes("repository-context")) {
    const stateModules = [
      "chunking",
      "workspace",
      "repo-graph",
      "repo-map",
      "text-index",
      "vector-index",
      "embedding",
      "shared",
      "source-analysis",
      "code-index",
    ];

    for (const mod of stateModules) {
      for (const prefix of [
        `../${mod}`,
        `../../${mod}`,
        `../../../${mod}`,
      ]) {
        content = replaceImport(content, filePath, prefix, join(STATE_INTERNAL, mod));
      }
    }

    // interaction-mode → request-intake
    for (const prefix of [
      "../../interaction-mode",
      "../../../interaction-mode",
      "../interaction-mode",
    ]) {
      content = replaceImport(
        content,
        filePath,
        prefix,
        join(INTAKE, "interaction-mode"),
      );
    }

    // pipeline/context-pipeline: ../internal → ../../internal
    if (filePath.includes("pipeline/context-pipeline")) {
      content = content.replace(
        /from ["']\.\.\/internal\//g,
        'from "../../internal/',
      );
    }

    // context-assembly tests: context-selection sibling
    content = content.replace(
      /from ["']\.\.\/context-selection/g,
      'from "../../context-selection',
    );
  }

  // repository-state pipeline → internal
  if (filePath.includes("repository-state/pipeline")) {
    const internalModules = [
      "workspace",
      "catalog",
      "chunking",
      "code-index",
      "code-indexing",
      "text-index",
      "embedding",
      "vector-index",
      "repo-graph",
      "repo-map",
      "shared",
      "source-analysis",
    ];
    for (const mod of internalModules) {
      content = replaceImport(
        content,
        filePath,
        `../${mod}`,
        join(STATE_INTERNAL, mod),
      );
      content = replaceImport(
        content,
        filePath,
        `../../${mod}`,
        join(STATE_INTERNAL, mod),
      );
    }
  }

  // request-understanding: envelope types from request-intake
  if (filePath.includes("request-understanding")) {
    for (const prefix of [
      "../../core/request-envelope",
      "../core/request-envelope",
      "../../../core/request-envelope",
    ]) {
      content = replaceImport(
        content,
        filePath,
        prefix,
        join(INTAKE, "request-envelope"),
      );
    }
    for (const prefix of [
      "../../core/interaction-mode",
      "../core/interaction-mode",
    ]) {
      content = replaceImport(
        content,
        filePath,
        prefix,
        join(INTAKE, "interaction-mode"),
      );
    }
  }

  // request-intake: interaction-mode sibling stays local; request-envelope ../interaction-mode ok

  if (content !== original) {
    writeFileSync(filePath, content);
    return true;
  }
  return false;
}

const files = listTsFiles(modulesRoot);
let fixed = 0;
for (const file of files) {
  if (fixFile(file)) fixed++;
}
console.log(`Fixed imports in ${fixed}/${files.length} files`);
