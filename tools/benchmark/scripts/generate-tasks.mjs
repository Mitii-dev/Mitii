#!/usr/bin/env node
/**
 * Generates 500–1000 external eval tasks for Mitii (not shipped in VSIX).
 *
 * Usage:
 *   node tools/benchmark/scripts/generate-tasks.mjs --profile standard
 *   node tools/benchmark/scripts/generate-tasks.mjs --count 750 --output tools/benchmark/tasks/eval/generated
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const benchmarkDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

const profile = valueOf(args, '--profile') ?? 'standard';
const countArg = valueOf(args, '--count');
const outputDir = resolve(valueOf(args, '--output') ?? join(benchmarkDir, 'tasks/eval/generated'));
const shardSize = Number(valueOf(args, '--shard-size') ?? '100');

const profiles = JSON.parse(readFileSync(join(benchmarkDir, 'config/profiles.json'), 'utf8'));
const profileConfig = profiles.profiles[profile] ?? profiles.profiles.standard;
const targetCount = countArg ? Number(countArg) : profileConfig.targetCount;

const fixtureCatalog = JSON.parse(readFileSync(join(benchmarkDir, 'datasets/fixture-catalog.json'), 'utf8'));
const fixtures = fixtureCatalog.fixtures;

const tasks = [];
const seenIds = new Set();

function addTask(task) {
  if (seenIds.has(task.id)) return false;
  seenIds.add(task.id);
  tasks.push({ ...task, tier: 'eval' });
  return true;
}

// --- Category generators ---

function generateFixtureAsk() {
  const askTemplates = [
    (f, file) => `Explain the purpose of ${file} in this ${fixtures[f].stack} project.`,
    (f, file) => `What does ${file} export or define? Summarize without inventing details.`,
    (f, file) => `How does ${file} connect to other modules in this codebase?`,
    (f, file) => `List the key functions, classes, or routes defined in ${file}.`,
    (f, file) => `What dependencies or imports does ${file} use?`,
    (f, file) => `Describe error handling patterns visible in or around ${file}.`,
    (f, file) => `What would you inspect first in ${file} when debugging a runtime issue?`,
    (f, file) => `Summarize the public API surface exposed via ${file}.`,
    (f, file) => `Which tests (if any) cover behavior related to ${file}?`,
    (f, file) => `What refactoring opportunities exist in ${file}? Be specific to the file.`,
    (f, file) => `How is ${file} referenced elsewhere in the repository?`,
    (f, file) => `What configuration in package.json affects ${file}?`,
    (f, _file) => `Give an architecture overview of this ${fixtures[f].stack} codebase.`,
    (f, _file) => `What are the main entry points and request/data flows?`,
    (f, _file) => `Which files would you read to onboard a new engineer to this repo?`,
  ];

  for (const [fixture, meta] of Object.entries(fixtures)) {
    for (const file of meta.entryFiles) {
      for (let i = 0; i < askTemplates.length; i++) {
        const slug = file.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
        addTask({
          id: `eval-ask-${fixture}-${slug}-t${i}`,
          tier: 'eval',
          category: `fixture-ask-${meta.category}`,
          mode: 'ask',
          fixture,
          prompt: askTemplates[i](fixture, file),
          verify: ['exit_0', 'stdout_not_empty', `file_exists:${file}`],
        });
      }
    }
    for (const symbol of meta.symbols) {
      addTask({
        id: `eval-ask-${fixture}-symbol-${symbol.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
        tier: 'eval',
        category: `fixture-ask-${meta.category}`,
        mode: 'ask',
        fixture,
        prompt: `Where is "${symbol}" defined or used in this codebase? Explain its role.`,
        verify: ['exit_0', 'stdout_not_empty'],
      });
    }
  }
}

function generateFixturePlan() {
  const planScenarios = [
    'Add comprehensive unit tests for the main module',
    'Introduce structured logging across the application',
    'Add input validation for all public endpoints or components',
    'Plan a migration from JavaScript to TypeScript incrementally',
    'Add health check and readiness endpoints',
    'Improve error messages for API consumers',
    'Add API documentation generation (OpenAPI or similar)',
    'Plan performance profiling for hot paths',
    'Add environment-based configuration with validation',
    'Plan CI pipeline steps: lint, test, build',
    'Add rate limiting for public routes',
    'Plan accessibility improvements for UI components',
    'Add integration tests with a test database or mock server',
    'Plan dependency audit and security hardening',
    'Add observability: metrics and tracing hooks',
    'Plan refactoring to reduce coupling between modules',
    'Add caching layer for frequently accessed data',
    'Plan feature flags for gradual rollout',
    'Add database migration strategy (if applicable)',
    'Plan dark mode support for the UI',
  ];

  for (const [fixture, meta] of Object.entries(fixtures)) {
    for (let i = 0; i < planScenarios.length; i++) {
      addTask({
        id: `eval-plan-${fixture}-s${i}`,
        tier: 'eval',
        category: `fixture-plan-${meta.category}`,
        mode: 'plan',
        fixture,
        prompt: `${planScenarios[i]} in this ${meta.stack} project. Break into ordered steps with verification.`,
        verify: ['exit_0', 'json_path:steps'],
      });
    }
  }
}

function generateFixtureAgent() {
  const agentTasks = [
    { prompt: 'Read src structure and list the top 3 improvement areas without editing files.', verify: ['exit_0', 'jsonl_event:end'] },
    { prompt: 'Inspect the main entry file and summarize middleware or bootstrap setup.', verify: ['exit_0', 'jsonl_event:end'] },
    { prompt: 'Find TODO or FIXME comments if any; report locations.', verify: ['exit_0', 'jsonl_event:end'] },
    { prompt: 'Propose a minimal test file skeleton for the core module (describe only, do not write unless asked).', verify: ['exit_0', 'jsonl_event:end'] },
    { prompt: 'Review package.json scripts and suggest one missing script for developer workflow.', verify: ['exit_0', 'jsonl_event:end'] },
    { prompt: 'Identify the highest-risk file for production bugs and explain why.', verify: ['exit_0', 'jsonl_event:end'] },
    { prompt: 'List all exported symbols from the main service or route module.', verify: ['exit_0', 'jsonl_event:end'] },
    { prompt: 'Explain which Mitii skills apply to this codebase and when to use them.', verify: ['exit_0', 'jsonl_event:end', 'skills_installed:5'] },
    { prompt: 'Draft a verification checklist before making any code changes.', verify: ['exit_0', 'jsonl_event:end'] },
    { prompt: 'Compare this project structure to common best practices for its stack.', verify: ['exit_0', 'jsonl_event:end'] },
    { prompt: 'Find duplicate logic across files and suggest consolidation targets.', verify: ['exit_0', 'jsonl_event:end'] },
    { prompt: 'Outline safe read-only inspection steps before editing any file.', verify: ['exit_0', 'jsonl_event:end'] },
    { prompt: 'Summarize environment variables or config this app would need in production.', verify: ['exit_0', 'jsonl_event:end'] },
    { prompt: 'Identify missing error handling and rank by severity.', verify: ['exit_0', 'jsonl_event:end'] },
    { prompt: 'List files that should never be auto-edited by an agent and why.', verify: ['exit_0', 'jsonl_event:end'] },
  ];

  const nodeExpressFix = {
    id: 'eval-agent-node-express-fix-users',
    tier: 'eval',
    category: 'fixture-agent-node',
    mode: 'agent',
    fixture: 'node-express',
    prompt: 'Fix the bug in src/routes/users.js where GET /users returns the wrong status message. Apply the fix.',
    verify: ['exit_0', 'jsonl_event:end', 'file_contains:src/routes/users.js:success'],
  };
  addTask(nodeExpressFix);

  for (const [fixture, meta] of Object.entries(fixtures)) {
    for (let i = 0; i < agentTasks.length; i++) {
      addTask({
        id: `eval-agent-${fixture}-a${i}`,
        tier: 'eval',
        category: `fixture-agent-${meta.category}`,
        mode: 'agent',
        fixture,
        prompt: agentTasks[i].prompt,
        verify: agentTasks[i].verify,
      });
    }
  }
}

function generateRetrieval() {
  const queries = [
    'Find the file that defines the main HTTP server bootstrap.',
    'Locate the primary UI component rendered on the home view.',
    'Where is the root NestJS module declared?',
    'Find the Next.js root layout component.',
    'Which file handles the /users route?',
    'Where are React component props typed?',
    'Find the NestJS controller class.',
    'Locate package.json and summarize its name field.',
    'Find test files in this repository.',
    'Which source file has the most imports?',
    'Locate the Express app mount point for routers.',
    'Find TypeScript configuration if present.',
    'Where is the main page metadata defined?',
    'Find service layer business logic.',
    'Locate entry point for the build tool configuration.',
  ];

  for (const [fixture, meta] of Object.entries(fixtures)) {
    for (let i = 0; i < queries.length; i++) {
      addTask({
        id: `eval-retrieval-${fixture}-q${i}`,
        tier: 'eval',
        category: `retrieval-${meta.category}`,
        mode: 'ask',
        fixture,
        prompt: queries[i],
        verify: ['exit_0', 'stdout_not_empty'],
      });
    }
  }
}

function generateCodingJs() {
  const problems = [
    { id: 'two-sum', prompt: 'Implement twoSum(nums, target) returning indices. Explain approach briefly.', expect: 'map' },
    { id: 'reverse-string', prompt: 'Write a function reverseString(s) for a string array in-place. Explain complexity.', expect: 'O(n)' },
    { id: 'valid-parens', prompt: 'Write isValid(s) for bracket matching. What edge cases matter?', expect: 'stack' },
    { id: 'merge-sorted', prompt: 'Merge two sorted arrays into one sorted array. Describe algorithm.', expect: 'merge' },
    { id: 'fibonacci', prompt: 'Implement fib(n) iteratively. What is time and space complexity?', expect: 'O(n)' },
    { id: 'binary-search', prompt: 'Implement binary search on a sorted array. When does it fail?', expect: 'mid' },
    { id: 'palindrome', prompt: 'Check if a string is a palindrome ignoring case and non-alphanumeric.', expect: 'palindrome' },
    { id: 'max-subarray', prompt: "Explain Kadane's algorithm for maximum subarray sum.", expect: 'subarray' },
    { id: 'anagram', prompt: 'Determine if two strings are anagrams. Compare sorting vs counting.', expect: 'anagram' },
    { id: 'fizzbuzz', prompt: 'Describe FizzBuzz implementation for 1..n. Mention extensibility.', expect: 'FizzBuzz' },
    { id: 'debounce', prompt: 'Implement a debounce(fn, wait) utility in JavaScript.', expect: 'debounce' },
    { id: 'throttle', prompt: 'Implement throttle(fn, limit) and contrast with debounce.', expect: 'throttle' },
    { id: 'deep-clone', prompt: 'Outline a deepClone for plain objects (no cycles). Mention limitations.', expect: 'clone' },
    { id: 'promise-all', prompt: 'Implement promiseAll(iterable) like Promise.all.', expect: 'Promise' },
    { id: 'flatten', prompt: 'Flatten a nested array to arbitrary depth.', expect: 'flat' },
    { id: 'curry', prompt: 'Implement curry for a function with fixed arity.', expect: 'curry' },
    { id: 'memoize', prompt: 'Add memoization to an expensive pure function.', expect: 'cache' },
    { id: 'lru-cache', prompt: 'Design an LRU cache API (get/put). Describe data structures.', expect: 'LRU' },
    { id: 'event-emitter', prompt: 'Sketch EventEmitter with on, off, emit.', expect: 'emit' },
    { id: 'json-parse-safe', prompt: 'Write safeJsonParse that never throws.', expect: 'JSON' },
  ];

  const variants = ['', ' Use TypeScript types in the explanation.', ' Include unit test cases.', ' Mention Big-O.', ' Show edge case handling.'];

  for (const problem of problems) {
    for (let v = 0; v < variants.length; v++) {
      addTask({
        id: `eval-coding-${problem.id}-v${v}`,
        tier: 'eval',
        category: 'coding-js',
        mode: 'ask',
        prompt: `${problem.prompt}${variants[v]}`,
        verify: ['exit_0', 'stdout_not_empty', `stdout_contains:${problem.expect}`],
      });
    }
  }

  // Expand with numeric variants for volume
  const algoKinds = ['second largest', 'missing number', 'duplicate', 'pair with sum k', 'longest increasing subsequence length'];
  for (let n = 1; n <= 110; n++) {
    addTask({
      id: `eval-coding-algo-${n}`,
      tier: 'eval',
      category: 'coding-js',
      mode: 'ask',
      prompt: `Solve: Given an array of integers, problem #${n} — find the ${algoKinds[n % algoKinds.length]}. Explain approach and complexity.`,
      verify: ['exit_0', 'stdout_not_empty'],
    });
  }
}

function generateReasoning() {
  const topics = [
    'If a CI pipeline fails only on Windows, what hypotheses do you test first?',
    'Compare monorepo vs polyrepo for a 10-engineer team shipping JS libraries.',
    'When should an agent ask for approval before editing package.json?',
    'How do you verify an LLM-generated patch without running full e2e?',
    'What signals indicate index staleness in a coding agent?',
    'Explain tradeoffs: stub runtime vs real runtime in benchmark harnesses.',
    'How would you shard 1000 eval tasks across 8 workers fairly?',
    'When is retrieval-augmented ask mode preferable to agent mode?',
    'Describe a safe rollback strategy after a bad agent edit.',
    'How do session JSONL logs help post-hoc eval scoring?',
  ];

  for (let i = 0; i < topics.length; i++) {
    for (let v = 0; v < 5; v++) {
      addTask({
        id: `eval-reasoning-${i}-v${v}`,
        tier: 'eval',
        category: 'reasoning',
        mode: 'ask',
        prompt: `${topics[i]} (variant ${v + 1}: be concise and structured).`,
        verify: ['exit_0', 'stdout_not_empty'],
      });
    }
  }

  for (let n = 1; n <= 40; n++) {
    addTask({
      id: `eval-reasoning-math-${n}`,
      tier: 'eval',
      category: 'reasoning',
      mode: 'ask',
      prompt: `Without using tools: explain step-by-step how to verify the answer to problem ${n} where you sum integers from 1 to ${n + 10}.`,
      verify: ['exit_0', 'stdout_not_empty'],
    });
  }
}

function generateToolCalling() {
  const tools = [
    { name: 'read_file', args: '{ "path": "src/index.js" }', expect: 'read_file' },
    { name: 'write_file', args: '{ "path": "src/foo.js", "content": "..." }', expect: 'write' },
    { name: 'run_terminal', args: '{ "command": "npm test" }', expect: 'npm test' },
    { name: 'search_codebase', args: '{ "query": "router.get" }', expect: 'search' },
    { name: 'list_directory', args: '{ "path": "src" }', expect: 'directory' },
    { name: 'git_status', args: '{}', expect: 'git' },
    { name: 'create_plan', args: '{ "steps": [] }', expect: 'plan' },
    { name: 'browser_navigate', args: '{ "url": "http://localhost:3000" }', expect: 'browser' },
  ];

  const phrasings = [
    (t) => `When should a coding agent call the ${t.name} tool? Give an example with args ${t.args}.`,
    (t) => `Describe correct JSON arguments for ${t.name}: ${t.args}`,
    (t) => `What preconditions must be true before invoking ${t.name}?`,
    (t) => `What failure modes occur when ${t.name} is misused?`,
  ];

  for (const tool of tools) {
    for (let p = 0; p < phrasings.length; p++) {
      for (let v = 0; v < 5; v++) {
        addTask({
          id: `eval-tool-${tool.name}-p${p}-v${v}`,
          tier: 'eval',
          category: 'tool-calling',
          mode: 'ask',
          prompt: phrasings[p](tool),
          verify: ['exit_0', 'stdout_not_empty'],
        });
      }
    }
  }
}

function generateGaiaStyle() {
  const gaiaTasks = [
    { prompt: 'What is the capital of France? Answer with one word.', expect: 'Paris' },
    { prompt: 'How many days are in a leap year? Answer with a number only.', expect: '366' },
    { prompt: 'What year did the first Node.js release occur? Answer with the year.', expect: '2009' },
    { prompt: 'What does HTTP stand for? Give the expansion.', expect: 'Hypertext' },
    { prompt: 'What is 17 * 23? Show the result.', expect: '391' },
    { prompt: 'Name the default package manager for Node.js.', expect: 'npm' },
    { prompt: 'What file extension does TypeScript use?', expect: 'ts' },
    { prompt: 'What command lists git commits?', expect: 'git log' },
    { prompt: 'What port does Ollama default API use?', expect: '11434' },
    { prompt: 'What is JSON short for?', expect: 'JavaScript' },
  ];

  const multiStep = [
    'Find package.json in a Node project and explain how to run tests — describe steps without executing.',
    'Outline how to verify a React component renders using browser devtools.',
    'Describe how to add a health endpoint to an Express app and verify with curl.',
    'Plan reading CHANGELOG, package.json, and src/ to assess release readiness.',
    'Explain how to use session logs in .mitii/logs for debugging agent runs.',
  ];

  for (let i = 0; i < gaiaTasks.length; i++) {
    for (let v = 0; v < 4; v++) {
      addTask({
        id: `eval-gaia-fact-${i}-v${v}`,
        tier: 'eval',
        category: 'gaia',
        mode: 'ask',
        prompt: gaiaTasks[i].prompt,
        verify: ['exit_0', 'stdout_not_empty', `stdout_contains:${gaiaTasks[i].expect}`],
      });
    }
  }

  for (let i = 0; i < multiStep.length; i++) {
    for (let v = 0; v < 8; v++) {
      addTask({
        id: `eval-gaia-multistep-${i}-v${v}`,
        tier: 'eval',
        category: 'gaia',
        mode: 'plan',
        prompt: `${multiStep[i]} (variant ${v + 1})`,
        verify: ['exit_0', 'json_path:steps'],
      });
    }
  }

  for (let n = 1; n <= 50; n++) {
    addTask({
      id: `eval-gaia-research-${n}`,
      tier: 'eval',
      category: 'gaia',
      mode: 'ask',
      prompt: `Research-style question #${n}: Compare two strategies for eval harness design (subprocess CLI vs in-process host).`,
      verify: ['exit_0', 'stdout_not_empty'],
    });
  }
}

function includeBaseBenchmark() {
  if (!profileConfig.includeBaseBenchmark) return;
  const indexPath = join(benchmarkDir, 'tasks/enterprise/index.json');
  if (!existsSync(indexPath)) return;
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  const baseDir = dirname(indexPath);
  const files = Array.isArray(index.includes) ? index.includes : [];
  for (const file of files) {
    const baseTasks = JSON.parse(readFileSync(resolve(baseDir, file), 'utf8'));
    for (const task of baseTasks) {
      addTask({
        ...task,
        id: `base-${task.id}`,
        category: task.category ?? 'benchmark',
        sourceTier: task.tier,
      });
    }
  }
}

// --- Run generators ---
if (profile === 'smoke') {
  includeBaseBenchmark();
  const smokeOnly = tasks.filter((t) => t.sourceTier === 'smoke' || t.id.startsWith('base-'));
  tasks.length = 0;
  seenIds.clear();
  for (const t of smokeOnly.slice(0, targetCount)) addTask(t);
} else {
  if (profileConfig.categories) {
    includeBaseBenchmark();
    // Category-filtered profiles: generators run below; filter at end
  } else {
    includeBaseBenchmark();
  }
  generateFixtureAsk();
  generateFixturePlan();
  generateFixtureAgent();
  generateRetrieval();
  generateCodingJs();
  generateReasoning();
  generateToolCalling();
  generateGaiaStyle();
}

// Trim or pad to target count (deterministic: sort by id, slice)
tasks.sort((a, b) => a.id.localeCompare(b.id));
const selected = tasks.slice(0, targetCount);

if (selected.length < Math.min(targetCount, 500)) {
  console.error(`Generator produced only ${selected.length} tasks (target ${targetCount}). Add more templates.`);
  process.exit(1);
}

// Write sharded output
mkdirSync(outputDir, { recursive: true });
const shards = [];
for (let i = 0; i < selected.length; i += shardSize) {
  const shard = selected.slice(i, i + shardSize);
  const shardName = `shard-${String(Math.floor(i / shardSize)).padStart(3, '0')}.json`;
  const shardPath = join(outputDir, shardName);
  writeFileSync(shardPath, `${JSON.stringify(shard, null, 2)}\n`, 'utf8');
  shards.push(shardName);
}

const manifest = {
  generatedAt: new Date().toISOString(),
  profile,
  targetCount,
  actualCount: selected.length,
  shardSize,
  shards,
  categories: summarizeCategories(selected),
  outputDir,
  note: 'External eval tasks — not packaged in VSIX extension',
};

writeFileSync(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
writeFileSync(
  join(outputDir, 'index.json'),
  `${JSON.stringify({ includes: shards.map((s) => s) }, null, 2)}\n`,
  'utf8'
);

console.log(`Generated ${selected.length} eval tasks in ${shards.length} shards → ${outputDir}`);
console.log('Categories:', JSON.stringify(manifest.categories));

function summarizeCategories(taskList) {
  const counts = {};
  for (const t of taskList) {
    const cat = t.category ?? 'unknown';
    counts[cat] = (counts[cat] ?? 0) + 1;
  }
  return counts;
}

function valueOf(argv, name) {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
}
