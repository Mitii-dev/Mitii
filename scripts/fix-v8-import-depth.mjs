#!/usr/bin/env node
/** Fix relative import depth after nesting under internal/ and pipeline/ */
import { readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const modulesRoot = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "src/v8/modules");

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

function depthFixes(filePath) {
  const fixes = [];
  const rel = filePath.replace(modulesRoot + "/", "");

  // Files under */tests/ need one extra ../ for sibling internal modules
  if (rel.includes("/tests/")) {
    fixes.push([/from "\.\.\/chunking/g, 'from "../../chunking']);
    fixes.push([/from "\.\.\/text-index/g, 'from "../../text-index']);
    fixes.push([/from "\.\.\/embedding/g, 'from "../../embedding']);
    fixes.push([/from "\.\.\/shared/g, 'from "../../shared']);
    fixes.push([/from "\.\.\/source-analysis/g, 'from "../../source-analysis']);
    fixes.push([/from "\.\.\/workspace/g, 'from "../../workspace']);
    fixes.push([/from "\.\.\/CodeIndex/g, 'from "../../CodeIndex']);
    fixes.push([/from "\.\.\/context-selection/g, 'from "../../context-selection']);
    fixes.push([/from "\.\.\/hybrid-retrieval/g, 'from "../../hybrid-retrieval']);
  }

  // pipeline/context-pipeline/tests → internal is ../../../internal
  if (rel.includes("repository-context/pipeline/context-pipeline/tests/")) {
    fixes.push([/from "\.\.\/\.\.\/internal\//g, 'from "../../../internal/']);
    fixes.push([
      /from "\.\.\/\.\.\/\.\.\/repository-state\/internal\/workspace\//g,
      'from "../../../../repository-state/internal/workspace/',
    ]);
  }

  // catalog/manifests → workspace is ../../workspace
  if (rel.includes("catalog/manifests/")) {
    fixes.push([/from "\.\.\/workspace"/g, 'from "../../workspace"']);
  }

  // repo-map/ranking → repo-graph is ../../repo-graph
  if (rel.includes("repo-map/ranking/")) {
    fixes.push([/from "\.\.\/repo-graph"/g, 'from "../../repo-graph"']);
  }

  // llm classifier → model-gateway is ../../../../model-gateway
  if (rel.includes("intent/classifiers/llm/")) {
    fixes.push([/from "\.\.\/\.\.\/\.\.\/model-gateway"/g, 'from "../../../../model-gateway"']);
  }

  return fixes;
}

let fixed = 0;
for (const file of listTsFiles(modulesRoot)) {
  let content = readFileSync(file, "utf8");
  const original = content;
  for (const [pattern, replacement] of depthFixes(file)) {
    content = content.replace(pattern, replacement);
  }
  if (content !== original) {
    writeFileSync(file, content);
    fixed++;
  }
}
console.log(`Depth-fixed ${fixed} files`);
