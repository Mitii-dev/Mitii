import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function buildReport(results, config, startedAt, finishedAt) {
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
  for (const result of results) {
    byCapability[result.capability] ??= [];
    byCapability[result.capability].push(result);
  }
  for (const key of Object.keys(byCapability)) byCapability[key] = summarize(byCapability[key]);

  const gateResults = {
    easy: difficulties.easy.total ? difficulties.easy.familyScore >= config.gates.easy : null,
    medium: difficulties.medium.total ? difficulties.medium.familyScore >= config.gates.medium : null,
    hard: difficulties.hard.total ? difficulties.hard.familyScore >= config.gates.hard : null,
    overall: results.length === 1500 ? overall.familyScore >= config.gates.overall : null,
  };
  const selectedDifficulties = ['easy', 'medium', 'hard'].filter(
    (difficulty) => difficulties[difficulty].total > 0
  );
  const completeSelection =
    selectedDifficulties.length > 0 &&
    selectedDifficulties.every((difficulty) => difficulties[difficulty].total === 500);
  const applicableGates = selectedDifficulties.map((difficulty) => gateResults[difficulty]);
  if (gateResults.overall !== null) applicableGates.push(gateResults.overall);
  const signal = completeSelection
    ? (applicableGates.every(Boolean) ? 'GO' : 'NO-GO')
    : 'PARTIAL';

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    signal,
    completeSelection,
    gates: config.gates,
    gateResults,
    overall,
    difficulties,
    byMode,
    byCapability,
    results,
  };
}

export function writeReport(report, path) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  const markdownPath = path.replace(/\.json$/i, '.md');
  const rows = ['easy', 'medium', 'hard'].map((difficulty) => {
    const item = report.difficulties[difficulty];
    const gate = report.gateResults[difficulty] === null ? 'N/A' : report.gateResults[difficulty] ? 'PASS' : 'FAIL';
    return `| ${difficulty} | ${item.passed}/${item.total} | ${(item.caseScore * 100).toFixed(1)}% | ${(item.familyScore * 100).toFixed(1)}% | ${gate} |`;
  });
  const markdown = `# Benchmark Result\n\n## Signal: ${report.signal}\n\n| Difficulty | Passed | Case score | Family-weighted score | Gate |\n|---|---:|---:|---:|---:|\n${rows.join('\n')}\n\nOverall family-weighted score: **${(report.overall.familyScore * 100).toFixed(1)}%**.\n`;
  writeFileSync(markdownPath, markdown);
  return { json: path, markdown: markdownPath };
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
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    families: families.size,
    caseScore: results.length ? passed / results.length : 0,
    familyScore: familyRates.length ? familyRates.reduce((a, b) => a + b, 0) / familyRates.length : 0,
  };
}
