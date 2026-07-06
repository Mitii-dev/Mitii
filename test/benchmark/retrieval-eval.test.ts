import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { HeadlessAgentHost } from '../../src/core/headless/HeadlessAgentHost';
import { defaultThunderConfig } from '../../src/core/config/defaults';
import { recallAtK, ndcgAtK, reciprocalRank, mean } from '../../tools/benchmark/scripts/retrievalMetrics';
import retrievalDataset from '../../tools/benchmark/datasets/retrieval-eval.json';

interface RetrievalQuery {
  id: string;
  fixture: string;
  query: string;
  expectedFiles: string[];
  expectedSymbols?: string[];
  sourceType: string;
}

interface QueryResult {
  id: string;
  fixture: string;
  query: string;
  sourceType: string;
  retrievedPaths: string[];
  recallAt5: number;
  recallAt10: number;
  ndcgAt10: number;
  reciprocalRank: number;
}

const dataset = retrievalDataset as RetrievalQuery[];
const REPO_ROOT = join(__dirname, '../..');
const REPORT_DIR = join(REPO_ROOT, '.mitii/benchmark');

function groupByFixture(queries: RetrievalQuery[]): Map<string, RetrievalQuery[]> {
  const groups = new Map<string, RetrievalQuery[]>();
  for (const q of queries) {
    const list = groups.get(q.fixture) ?? [];
    list.push(q);
    groups.set(q.fixture, list);
  }
  return groups;
}

function isAbiMismatch(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('NODE_MODULE_VERSION') || message.includes('better_sqlite3');
}

function writeReport(results: QueryResult[], skippedFixtures: string[]): void {
  mkdirSync(REPORT_DIR, { recursive: true });

  const fixtureNames = Array.from(new Set(results.map((r) => r.fixture)));
  const fixtureSummaries = fixtureNames.map((fixture) => {
    const rows = results.filter((r) => r.fixture === fixture);
    return {
      fixture,
      queryCount: rows.length,
      meanRecallAt5: mean(rows.map((r) => r.recallAt5)),
      meanRecallAt10: mean(rows.map((r) => r.recallAt10)),
      meanNdcgAt10: mean(rows.map((r) => r.ndcgAt10)),
      meanReciprocalRank: mean(rows.map((r) => r.reciprocalRank)),
    };
  });

  const overall = {
    queryCount: results.length,
    skippedFixtures,
    meanRecallAt5: mean(results.map((r) => r.recallAt5)),
    meanRecallAt10: mean(results.map((r) => r.recallAt10)),
    meanNdcgAt10: mean(results.map((r) => r.ndcgAt10)),
    meanReciprocalRank: mean(results.map((r) => r.reciprocalRank)),
  };

  const report = { generatedAt: new Date().toISOString(), overall, byFixture: fixtureSummaries, results };
  writeFileSync(join(REPORT_DIR, 'retrieval-report.json'), JSON.stringify(report, null, 2));

  const md = [
    '# Retrieval Eval Report (HybridRetriever baseline)',
    '',
    `Generated: ${report.generatedAt}`,
    skippedFixtures.length > 0 ? `Skipped fixtures (native module unavailable): ${skippedFixtures.join(', ')}` : '',
    '',
    '## Overall',
    '',
    '| Metric | Value |',
    '|---|---|',
    `| Queries | ${overall.queryCount} |`,
    `| Recall@5 | ${overall.meanRecallAt5.toFixed(3)} |`,
    `| Recall@10 | ${overall.meanRecallAt10.toFixed(3)} |`,
    `| nDCG@10 | ${overall.meanNdcgAt10.toFixed(3)} |`,
    `| MRR | ${overall.meanReciprocalRank.toFixed(3)} |`,
    '',
    '## By fixture',
    '',
    '| Fixture | Queries | Recall@5 | Recall@10 | nDCG@10 | MRR |',
    '|---|---|---|---|---|---|',
    ...fixtureSummaries.map(
      (f) =>
        `| ${f.fixture} | ${f.queryCount} | ${f.meanRecallAt5.toFixed(3)} | ${f.meanRecallAt10.toFixed(3)} | ${f.meanNdcgAt10.toFixed(3)} | ${f.meanReciprocalRank.toFixed(3)} |`
    ),
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');
  writeFileSync(join(REPORT_DIR, 'retrieval-report.md'), md + '\n');

  // eslint-disable-next-line no-console
  console.log(`\n${md}`);
}

// vitest buffers console.log per-test and only flushes it once the test finishes,
// which makes a multi-minute eval look hung. process.stdout.write bypasses that
// buffering so progress shows up live in the terminal.
function progress(line: string): void {
  process.stdout.write(`${line}\n`);
}

describe('Retrieval eval (HybridRetriever baseline recall/nDCG)', () => {
  it(
    'measures Recall@5, Recall@10, and nDCG@10 against the hand-labeled query set',
    async () => {
      const byFixture = groupByFixture(dataset);
      const results: QueryResult[] = [];
      const skippedFixtures: string[] = [];
      const totalQueries = dataset.length;
      let queriesDone = 0;

      progress(`\n▶ Retrieval eval: ${totalQueries} queries across ${byFixture.size} fixture(s)\n`);

      for (const [fixture, queries] of byFixture) {
        const cwd = join(REPO_ROOT, 'tools/benchmark/fixtures', fixture);
        progress(`▶ Indexing fixture "${fixture}" (${queries.length} queries)...`);
        const indexStarted = Date.now();
        const host = new HeadlessAgentHost({
          cwd,
          packageRoot: REPO_ROOT,
          runtime: 'real',
          providerType: 'echo',
          approval: 'auto',
          indexWorkspace: true,
          configOverrides: { indexing: { ...defaultThunderConfig().indexing, vectorsEnabled: true } },
        });

        try {
          await host.initialize();
        } catch (error) {
          if (isAbiMismatch(error)) {
            skippedFixtures.push(fixture);
            progress(`  ⚠ skipped "${fixture}" — native module (better-sqlite3) unavailable for this Node ABI`);
            host.dispose();
            continue;
          }
          throw error;
        }
        progress(`  ✓ indexed "${fixture}" (${Date.now() - indexStarted}ms)`);

        for (const q of queries) {
          const started = Date.now();
          const items = await host.retrieveContext({ text: q.query, maxItems: 30 });
          const retrievedPaths = items.map((item) => item.relPath).filter((p): p is string => Boolean(p));

          const recallAt5 = recallAtK(retrievedPaths, q.expectedFiles, 5);
          const recallAt10 = recallAtK(retrievedPaths, q.expectedFiles, 10);
          const ndcgAt10 = ndcgAtK(retrievedPaths, q.expectedFiles, 10);

          results.push({
            id: q.id,
            fixture: q.fixture,
            query: q.query,
            sourceType: q.sourceType,
            retrievedPaths,
            recallAt5,
            recallAt10,
            ndcgAt10,
            reciprocalRank: reciprocalRank(retrievedPaths, q.expectedFiles),
          });

          queriesDone += 1;
          progress(
            `  [${queriesDone}/${totalQueries}] ${q.id} — recall@5=${recallAt5.toFixed(2)} recall@10=${recallAt10.toFixed(2)} ndcg@10=${ndcgAt10.toFixed(2)} (${Date.now() - started}ms)`
          );
        }

        host.dispose();
      }

      if (skippedFixtures.length === byFixture.size) {
        // better-sqlite3 isn't built for this Node ABI (run `pnpm run rebuild:node`) — nothing to report.
        return;
      }

      writeReport(results, skippedFixtures);

      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.recallAt5).toBeGreaterThanOrEqual(0);
        expect(r.recallAt5).toBeLessThanOrEqual(1);
        expect(r.ndcgAt10).toBeGreaterThanOrEqual(0);
        expect(r.ndcgAt10).toBeLessThanOrEqual(1);
      }
    },
    300_000
  );
});
