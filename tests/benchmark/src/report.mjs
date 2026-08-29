import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function createRunReporter(options = {}) {
  const runId = options.runId ?? new Date().toISOString().replaceAll(/[:.]/g, '-');
  const runDir = options.runDir;
  const casesDir = join(runDir, 'cases');
  mkdirSync(casesDir, { recursive: true });
  const startedAt = options.startedAt ?? new Date();
  const collected = [];

  return {
    runId,
    runDir,
    casesDir,
    record(result, index, total) {
      collected[index] = result;
      const casePaths = writeCaseReport(result, casesDir, {
        index,
        total,
        runId,
      });
      const partial = buildReport(
        collected.filter(Boolean),
        options.config,
        startedAt,
        new Date(),
        {
          partial: collected.filter(Boolean).length < total,
          expectedTotal: options.expectedTotal ?? total,
          expectedByDifficulty: options.expectedByDifficulty,
          suite: options.suite,
        }
      );
      const summaryPaths = writeReport(partial, join(runDir, 'summary.json'), {
        live: true,
        completed: collected.filter(Boolean).length,
        total,
      });
      return { casePaths, summaryPaths, report: partial };
    },
    finalize(results) {
      const finishedAt = new Date();
      const report = buildReport(results, options.config, startedAt, finishedAt, {
        partial: false,
        expectedTotal: options.expectedTotal ?? results.length,
        expectedByDifficulty: options.expectedByDifficulty,
        suite: options.suite,
      });
      const summaryPaths = writeReport(report, join(runDir, 'summary.json'));
      if (options.latestPath) {
        writeReport(report, options.latestPath);
      }
      return { report, summaryPaths, runDir };
    },
  };
}

export function buildReport(results, config, startedAt, finishedAt, meta = {}) {
  const difficulties = {};
  for (const difficulty of ['easy', 'medium', 'hard']) {
    const selected = results.filter((result) => result.difficulty === difficulty);
    difficulties[difficulty] = summarize(selected);
  }
  const overall = summarize(results);
  const byMode = Object.fromEntries(
    ['ask', 'plan', 'agent'].map((mode) => [mode, summarize(results.filter((result) => result.mode === mode))])
  );
  const byCapability = {};
  const bySuite = {};
  const byCategory = {};
  for (const result of results) {
    byCapability[result.capability] ??= [];
    byCapability[result.capability].push(result);
    const suiteId = result.suite ?? 'unknown';
    bySuite[suiteId] ??= [];
    bySuite[suiteId].push(result);
    if (result.category) {
      byCategory[result.category] ??= [];
      byCategory[result.category].push(result);
    }
  }
  for (const key of Object.keys(byCapability)) byCapability[key] = summarize(byCapability[key]);
  for (const key of Object.keys(bySuite)) bySuite[key] = summarize(bySuite[key]);
  for (const key of Object.keys(byCategory)) byCategory[key] = summarize(byCategory[key]);

  const gates = config.gates ?? {};
  const gateResults = {
    easy: difficulties.easy.total && gates.easy != null ? difficulties.easy.familyScore >= gates.easy : null,
    medium:
      difficulties.medium.total && gates.medium != null ? difficulties.medium.familyScore >= gates.medium : null,
    hard: difficulties.hard.total && gates.hard != null ? difficulties.hard.familyScore >= gates.hard : null,
    overall:
      gates.overall != null && !meta.partial && results.length === (meta.expectedTotal ?? results.length)
        ? overall.familyScore >= gates.overall
        : null,
  };

  const selectedDifficulties = ['easy', 'medium', 'hard'].filter(
    (difficulty) => difficulties[difficulty].total > 0
  );
  const expectedByDifficulty = meta.expectedByDifficulty ?? null;
  const completeSelection =
    Boolean(expectedByDifficulty) &&
    selectedDifficulties.length > 0 &&
    selectedDifficulties.every(
      (difficulty) => difficulties[difficulty].total === expectedByDifficulty[difficulty]
    ) &&
    results.length === (meta.expectedTotal ?? results.length);

  let signal = 'PARTIAL';
  if (meta.partial) {
    signal = 'RUNNING';
  } else if (completeSelection) {
    const applicableGates = selectedDifficulties.map((difficulty) => gateResults[difficulty]);
    if (gateResults.overall !== null) applicableGates.push(gateResults.overall);
    signal = applicableGates.every(Boolean) ? 'GO' : 'NO-GO';
  } else if (!meta.partial && results.length > 0 && gateResults.overall !== null) {
    signal = gateResults.overall ? 'GO' : 'NO-GO';
  } else if (!meta.partial && results.length > 0) {
    signal = overall.failed === 0 ? 'GO' : 'NO-GO';
  }

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    suite: meta.suite ?? 'all',
    signal,
    completeSelection,
    partial: Boolean(meta.partial),
    expectedTotal: meta.expectedTotal ?? results.length,
    completed: results.length,
    gates,
    gateResults,
    overall,
    difficulties,
    byMode,
    byCapability,
    bySuite,
    byCategory,
    usageTotals: sumUsage(results),
    results,
  };
}

export function writeCaseReport(result, casesDir, meta = {}) {
  mkdirSync(casesDir, { recursive: true });
  const safeId = String(result.id).replaceAll(/[^\w.-]+/g, '_');
  const jsonPath = join(casesDir, `${safeId}.json`);
  const markdownPath = join(casesDir, `${safeId}.md`);
  const payload = {
    runId: meta.runId ?? null,
    index: meta.index ?? null,
    total: meta.total ?? null,
    status: result.passed ? 'PASS' : 'FAIL',
    ...result,
  };
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(markdownPath, renderCaseMarkdown(payload));
  return { json: jsonPath, markdown: markdownPath };
}

export function writeReport(report, path, liveMeta = null) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  const markdownPath = path.replace(/\.json$/i, '.md');
  writeFileSync(markdownPath, renderSummaryMarkdown(report, liveMeta));
  return { json: path, markdown: markdownPath };
}

function renderCaseMarkdown(result) {
  const usage = result.usage ?? {};
  const tokenParts = [];
  if (usage.inputTokens != null) tokenParts.push(`in=${usage.inputTokens}`);
  if (usage.outputTokens != null) tokenParts.push(`out=${usage.outputTokens}`);
  if (usage.modelCalls != null) tokenParts.push(`models=${usage.modelCalls}`);
  if (usage.toolCalls != null) tokenParts.push(`tools=${usage.toolCalls}`);
  if (usage.loopIterations != null) tokenParts.push(`loops=${usage.loopIterations}`);
  const lines = [
    `# Case ${result.id}`,
    '',
    `**Status:** ${result.status}`,
    `**Suite:** ${result.suite ?? 'n/a'}`,
    `**Mode:** ${result.mode}`,
    `**Fixture:** ${result.fixture}`,
    `**Capability:** ${result.capability}`,
    `**Duration:** ${result.durationMs ?? 0}ms`,
    `**Tokens / usage:** ${tokenParts.length ? tokenParts.join(' ') : 'n/a'}`,
    '',
    '## Checks',
    '',
  ];
  for (const check of result.checks ?? []) {
    lines.push(`- ${check.passed ? 'PASS' : 'FAIL'} \`${check.type}\`${check.details ? ` — ${escapeMd(check.details).slice(0, 200)}` : ''}`);
  }
  if (result.error) {
    lines.push('', `## Error`, '', escapeMd(result.error));
  }
  if (result.preconditions?.length) {
    lines.push('', '## Preconditions', '');
    for (const check of result.preconditions) {
      lines.push(`- ${check.passed ? 'PASS' : 'FAIL'} \`${check.type}\``);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function renderSummaryMarkdown(report, liveMeta) {
  const rows = ['easy', 'medium', 'hard'].map((difficulty) => {
    const item = report.difficulties[difficulty];
    const gate =
      report.gateResults[difficulty] === null ? 'N/A' : report.gateResults[difficulty] ? 'PASS' : 'FAIL';
    return `| ${difficulty} | ${item.passed}/${item.total} | ${(item.caseScore * 100).toFixed(1)}% | ${(item.familyScore * 100).toFixed(1)}% | ${gate} |`;
  });
  const live =
    liveMeta != null
      ? `\n_Live progress: ${liveMeta.completed}/${liveMeta.total} case reports written._\n`
      : '';
  const categoryRows = Object.entries(report.byCategory ?? {})
    .map(([name, item]) => `| ${name} | ${item.passed}/${item.total} | ${(item.caseScore * 100).toFixed(1)}% |`)
    .join('\n');
  const usage = report.usageTotals ?? {};
  const usageLine = [
    usage.inputTokens != null ? `inTokens=${usage.inputTokens}` : null,
    usage.outputTokens != null ? `outTokens=${usage.outputTokens}` : null,
    usage.avgDurationMs != null ? `avgDurationMs=${Math.round(usage.avgDurationMs)}` : null,
  ]
    .filter(Boolean)
    .join(' ');
  return `# Benchmark Result

## Signal: ${report.signal}
${live}
| Difficulty | Passed | Case score | Family-weighted score | Gate |
|---|---:|---:|---:|---:|
${rows.join('\n')}

Overall family-weighted score: **${(report.overall.familyScore * 100).toFixed(1)}%**.
${usageLine ? `\nRun usage: **${usageLine}**.\n` : ''}
${categoryRows ? `## Categories\n\n| Category | Passed | Case score |\n|---|---:|---:|\n${categoryRows}\n` : ''}
`;
}

function summarize(results) {
  const passed = results.filter((result) => result.passed).length;
  const families = new Map();
  for (const result of results) {
    const family = families.get(result.familyId) ?? [];
    family.push(result.passed ? 1 : 0);
    families.set(result.familyId, family);
  }
  const familyRates = [...families.values()].map((values) => values.reduce((a, b) => a + b, 0) / values.length);
  const durations = results.map((result) => result.durationMs).filter((value) => typeof value === 'number');
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    families: families.size,
    caseScore: results.length ? passed / results.length : 0,
    familyScore: familyRates.length ? familyRates.reduce((a, b) => a + b, 0) / familyRates.length : 0,
    avgDurationMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
  };
}

function sumUsage(results) {
  let inputTokens = 0;
  let outputTokens = 0;
  let seenTokens = false;
  const durations = [];
  for (const result of results) {
    if (typeof result.durationMs === 'number') durations.push(result.durationMs);
    const usage = result.usage ?? {};
    if (typeof usage.inputTokens === 'number') {
      inputTokens += usage.inputTokens;
      seenTokens = true;
    }
    if (typeof usage.outputTokens === 'number') {
      outputTokens += usage.outputTokens;
      seenTokens = true;
    }
  }
  return {
    inputTokens: seenTokens ? inputTokens : null,
    outputTokens: seenTokens ? outputTokens : null,
    avgDurationMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
  };
}

function escapeMd(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}
