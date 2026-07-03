#!/usr/bin/env node
/**
 * Merge shard eval reports into a single potential-assessment summary.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const args = process.argv.slice(2);
const benchmarkDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inputDir = resolve(valueOf(args, '--input') ?? join(benchmarkDir, 'results'));
const outputPath = resolve(valueOf(args, '--output') ?? join(inputDir, 'aggregated-report.json'));

if (!existsSync(inputDir)) {
  console.error(`Input directory not found: ${inputDir}`);
  process.exit(1);
}

const reports = readdirSync(inputDir)
  .filter((f) => f.endsWith('.json') && f !== 'aggregated-report.json')
  .map((f) => JSON.parse(readFileSync(join(inputDir, f), 'utf8')));

if (!reports.length) {
  console.error('No report JSON files found');
  process.exit(1);
}

const allResults = reports.flatMap((r) => r.results ?? []);
const passed = allResults.filter((r) => r.passed).length;
const categoryBreakdown = {};

for (const r of allResults) {
  const cat = r.category ?? 'unknown';
  if (!categoryBreakdown[cat]) categoryBreakdown[cat] = { passed: 0, total: 0 };
  categoryBreakdown[cat].total += 1;
  if (r.passed) categoryBreakdown[cat].passed += 1;
}
for (const cat of Object.keys(categoryBreakdown)) {
  const { passed: p, total } = categoryBreakdown[cat];
  categoryBreakdown[cat].score = total ? Math.round((p / total) * 100) : 0;
}

const aggregated = {
  aggregatedAt: new Date().toISOString(),
  shardCount: reports.length,
  provider: reports[0]?.provider,
  runtime: reports[0]?.runtime,
  summary: {
    total: allResults.length,
    passed,
    failed: allResults.length - passed,
    score: allResults.length ? Math.round((passed / allResults.length) * 100) : 0,
    avgDurationMs: allResults.length
      ? Math.round(allResults.reduce((s, r) => s + (r.durationMs ?? 0), 0) / allResults.length)
      : 0,
  },
  categoryBreakdown,
  potentialAssessment: assessPotential(categoryBreakdown, allResults.length),
  shardSummaries: reports.map((r) => r.summary),
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(aggregated, null, 2)}\n`, 'utf8');
writeFileSync(outputPath.replace(/\.json$/, '.md'), toMarkdown(aggregated), 'utf8');
console.log(`Aggregated ${reports.length} shards → ${passed}/${allResults.length} (${aggregated.summary.score}%)`);
console.log('Potential:', aggregated.potentialAssessment.tier);

function assessPotential(categories, total) {
  const scores = Object.values(categories).map((c) => c.score);
  const overall = total ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length)) : 0;
  const agentCats = Object.entries(categories).filter(([k]) => k.includes('agent'));
  const agentScore = agentCats.length
    ? Math.round(agentCats.reduce((s, [, v]) => s + v.score, 0) / agentCats.length)
    : 0;

  let tier = 'developing';
  if (overall >= 85 && agentScore >= 70) tier = 'enterprise-ready';
  else if (overall >= 70) tier = 'production-capable';
  else if (overall >= 50) tier = 'promising';

  return {
    tier,
    overallScore: overall,
    agentScore,
    recommendation: tier === 'enterprise-ready'
      ? 'Strong across categories; run full 1000-task matrix with target model.'
      : tier === 'production-capable'
        ? 'Good baseline; focus agent-mode and fixture-agent categories.'
        : tier === 'promising'
          ? 'Partial capability; compare models via Ollama matrix and inspect failing categories.'
          : 'Early stage; verify runtime=real, model quality, and tool wiring.',
  };
}

function toMarkdown(report) {
  return [
    '# Mitii Agent Potential Assessment',
    '',
    `**Tier:** ${report.potentialAssessment.tier}`,
    `**Overall score:** ${report.summary.score}% (${report.summary.passed}/${report.summary.total})`,
    `**Agent score:** ${report.potentialAssessment.agentScore}%`,
    '',
    report.potentialAssessment.recommendation,
    '',
    '## Category scores',
    ...Object.entries(report.categoryBreakdown).map(
      ([cat, v]) => `- ${cat}: ${v.score}% (${v.passed}/${v.total})`
    ),
    '',
  ].join('\n');
}

function valueOf(argv, name) {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
}
