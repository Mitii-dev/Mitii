#!/usr/bin/env node
// Regenerates the tests/benchmark/fixtures/type-cascade-large fixture: a ~50-file
// TypeScript project where Order.total has already been widened from `number` to
// `{ amount: number; currency: string }` in src/types/domain.ts, and every feature
// module still treats it as a plain number, so `tsc --noEmit` fails across the tree.
// Re-run after editing this script to regenerate the fixture from scratch.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', 'fixtures', 'type-cascade-large');

// [featureName, touchesTotal] — 8 features do real arithmetic/formatting on
// order.total (and so break when the type widens); 3 only pass Order through
// untouched, mirroring how a real cascade never breaks every single file.
const FEATURES = [
  ['orders', true],
  ['invoices', true],
  ['refunds', true],
  ['payments', true],
  ['reports', true],
  ['ledger', true],
  ['exports', true],
  ['subscriptions', true],
  ['shipments', false],
  ['notifications', false],
  ['customers', false],
];

function pascal(name) {
  return name[0].toUpperCase() + name.slice(1, -1) + (name.endsWith('s') ? name[name.length - 1] : '');
}

function repositoryFile(feature, touchesTotal) {
  const Feature = pascal(feature);
  if (!touchesTotal) {
    return `import type { Order } from '../../types/domain.js';

const ${feature}Log = new Map<string, Order>();

export function record${Feature}Event(orderId: string, order: Order): void {
  ${feature}Log.set(orderId, order);
}

export function get${Feature}Event(orderId: string): Order | undefined {
  return ${feature}Log.get(orderId);
}
`;
  }
  return `import type { Order } from '../../types/domain.js';

const ${feature}Store = new Map<string, Order>();

export function save${Feature}Record(id: string, customerId: string, total: number): Order {
  const order: Order = { id, customerId, total, createdAt: new Date().toISOString() };
  ${feature}Store.set(id, order);
  return order;
}

export function list${Feature}Records(): Order[] {
  return [...${feature}Store.values()];
}
`;
}

function serviceFile(feature, touchesTotal) {
  const Feature = pascal(feature);
  if (!touchesTotal) {
    return `import type { Order } from '../../types/domain.js';
import { record${Feature}Event } from './repository.js';

export function process${Feature}(order: Order): void {
  record${Feature}Event(order.id, order);
}
`;
  }
  return `import type { Order } from '../../types/domain.js';
import { formatCurrency } from '../../utils/currency.js';
import { save${Feature}Record, list${Feature}Records } from './repository.js';

export function create${Feature}Entry(customerId: string, total: number): Order {
  const id = \`${feature}-\${Date.now()}\`;
  return save${Feature}Record(id, customerId, total);
}

export function total${Feature}Amount(): number {
  return list${Feature}Records().reduce((sum, order) => sum + order.total, 0);
}

export function describe${Feature}(order: Order): string {
  return \`\${order.id}: \${formatCurrency(order.total)}\`;
}
`;
}

function dtoFile(feature, touchesTotal) {
  const Feature = pascal(feature);
  if (!touchesTotal) {
    return `import type { Order } from '../../types/domain.js';

export interface ${Feature}EventDto {
  orderId: string;
  customerId: string;
}

export function to${Feature}EventDto(order: Order): ${Feature}EventDto {
  return { orderId: order.id, customerId: order.customerId };
}
`;
  }
  return `import type { Order } from '../../types/domain.js';

export interface ${Feature}ResponseDto {
  id: string;
  total: number;
}

export function to${Feature}ResponseDto(order: Order): ${Feature}ResponseDto {
  return { id: order.id, total: order.total };
}
`;
}

function controllerFile(feature, touchesTotal) {
  const Feature = pascal(feature);
  if (!touchesTotal) {
    return `import type { Order } from '../../types/domain.js';
import { process${Feature} } from './service.js';
import { to${Feature}EventDto, type ${Feature}EventDto } from './dto.js';

export function handle${Feature}Event(order: Order): ${Feature}EventDto {
  process${Feature}(order);
  return to${Feature}EventDto(order);
}
`;
  }
  return `import { create${Feature}Entry } from './service.js';
import { to${Feature}ResponseDto, type ${Feature}ResponseDto } from './dto.js';

export function handleCreate${Feature}(customerId: string, total: number): ${Feature}ResponseDto {
  const order = create${Feature}Entry(customerId, total);
  return to${Feature}ResponseDto(order);
}
`;
}

function main() {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'src', 'types'), { recursive: true });
  mkdirSync(join(root, 'src', 'utils'), { recursive: true });
  mkdirSync(join(root, 'test'), { recursive: true });

  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'benchmark-type-cascade-large',
        version: '1.0.0',
        private: true,
        scripts: {
          build: 'tsc -p tsconfig.json',
          typecheck: 'tsc --noEmit',
          test: 'npm run build && node --test "dist/test/**/*.test.js"',
        },
        devDependencies: {
          typescript: '^5.5.2',
          '@types/node': '^20.14.2',
        },
      },
      null,
      2
    ) + '\n'
  );

  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          module: 'commonjs',
          target: 'ES2020',
          outDir: 'dist',
          rootDir: '.',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
        },
        include: ['src/**/*', 'test/**/*'],
      },
      null,
      2
    ) + '\n'
  );

  writeFileSync(
    join(root, 'src', 'types', 'domain.ts'),
    `export interface Order {
  id: string;
  customerId: string;
  total: { amount: number; currency: string };
  createdAt: string;
}
`
  );

  writeFileSync(
    join(root, 'src', 'utils', 'currency.ts'),
    `export function formatCurrency(amount: number): string {
  return \`$\${amount.toFixed(2)}\`;
}
`
  );

  const exportLines = [];
  for (const [feature, touchesTotal] of FEATURES) {
    const dir = join(root, 'src', 'features', feature);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'repository.ts'), repositoryFile(feature, touchesTotal));
    writeFileSync(join(dir, 'service.ts'), serviceFile(feature, touchesTotal));
    writeFileSync(join(dir, 'dto.ts'), dtoFile(feature, touchesTotal));
    writeFileSync(join(dir, 'controller.ts'), controllerFile(feature, touchesTotal));
    const Feature = pascal(feature);
    exportLines.push(
      touchesTotal
        ? `export { handleCreate${Feature} } from './features/${feature}/controller.js';`
        : `export { handle${Feature}Event } from './features/${feature}/controller.js';`
    );
  }
  writeFileSync(join(root, 'src', 'index.ts'), exportLines.join('\n') + '\n');

  // A handful of real runtime tests against the features that touch total, so
  // `npm test` is a genuine second signal beyond `tsc --noEmit`.
  const testedFeatures = FEATURES.filter(([, touchesTotal]) => touchesTotal).slice(0, 4);
  for (const [feature] of testedFeatures) {
    const Feature = pascal(feature);
    writeFileSync(
      join(root, 'test', `${feature}.test.ts`),
      `import test from 'node:test';
import assert from 'node:assert/strict';
import { create${Feature}Entry, total${Feature}Amount } from '../src/features/${feature}/service.js';
import { to${Feature}ResponseDto } from '../src/features/${feature}/dto.js';

// After the Order.total migration this asserts against the flat DTO
// projection (order.total.amount), not the raw internal Order record.
test('create${Feature}Entry and total${Feature}Amount track order totals', () => {
  const order = create${Feature}Entry('cust-1', 100);
  assert.equal(order.customerId, 'cust-1');
  assert.equal(to${Feature}ResponseDto(order).total, 100);
  assert.ok(total${Feature}Amount() >= 100);
});
`
    );
  }

  writeFileSync(
    join(root, '.gitignore'),
    'node_modules/\ndist/\n.mitii/\n'
  );
  writeFileSync(
    join(root, '.mitiiignore'),
    'node_modules/\ndist/\nbuild/\ncoverage/\n*.lock\n*.map\n'
  );
  writeFileSync(
    join(root, 'README.md'),
    `# type-cascade-large

Generated by \`scripts/generate-type-cascade-large.mjs\` — do not hand-edit files under
\`src/\`/\`test/\`, re-run the generator instead. ~${FEATURES.length * 4 + testedFeatures.length + 3} files across
${FEATURES.length} feature modules (repository/service/dto/controller each), all importing the
shared \`Order\` type from \`src/types/domain.ts\`.

\`Order.total\` has **already** been widened from \`number\` to
\`{ amount: number; currency: string }\` in the committed baseline. ${FEATURES.filter(([, t]) => t).length} of the
${FEATURES.length} feature modules do real arithmetic/formatting on \`order.total\` and break under
\`tsc --noEmit\`; the rest only pass \`Order\` through untouched and stay clean — a
realistic partial cascade, not every file breaking uniformly.

Used for the hard-tier case in \`backend/cases/type-cascade.jsonl\`: trace and fix every
broken consumer (no \`any\`/\`@ts-ignore\`) so the project typechecks and tests pass again.
`
  );

  console.log(`Generated ${root}`);
}

main();
