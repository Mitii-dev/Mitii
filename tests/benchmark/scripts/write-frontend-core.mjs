#!/usr/bin/env node
/**
 * Writes the frontend-core agent suite (70 cases) and removes legacy JSONL.
 * Run: node scripts/write-frontend-core.mjs
 */
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const casesDir = join(root, 'suites/frontend/cases');

const baseAgent = [
  { type: 'agent_exit', equals: 0 },
  { type: 'output_not_empty' },
  { type: 'jsonl_event', event: 'end' },
];

function stripOuterQuotes(value) {
  let s = String(value);
  // Only unwrap matching outer pairs. Never strip a trailing " from
  // HTML/JSX needles like lang="en" or data-testid="app-root".
  while (
    s.length >= 2 &&
    ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"')))
  ) {
    s = s.slice(1, -1);
  }
  return s;
}

/** Paths never contain quotes — strip stray leading/trailing quotes from generators. */
function stripPathQuotes(value) {
  return stripOuterQuotes(value).replace(/^['"]+/, '').replace(/['"]+$/, '');
}

/** Build a shell-safe grade command from flag/value tokens or "flag value" strings. */
function gradeCommand(...parts) {
  const tokens = [];
  for (const part of parts) {
    const cleaned = stripOuterQuotes(part);
    if (cleaned.startsWith('--') && cleaned.includes(' ') && !cleaned.startsWith('--json')) {
      const idx = cleaned.indexOf(' ');
      tokens.push(cleaned.slice(0, idx), stripOuterQuotes(cleaned.slice(idx + 1)));
    } else {
      tokens.push(cleaned);
    }
  }
  const assertions = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const flag = tokens[i];
    const value = tokens[i + 1];
    if (!flag || value == null) continue;
    if (flag === '--exists') assertions.push({ op: 'exists', path: stripPathQuotes(value) });
    else if (flag === '--not-exists') assertions.push({ op: 'notExists', path: stripPathQuotes(value) });
    else if (flag === '--contains' || flag === '--not-contains' || flag === '--matches') {
      const index = value.indexOf('::');
      if (index === -1) continue;
      const path = stripPathQuotes(value.slice(0, index));
      // Values may legitimately include quotes (lang="en"); only unwrap paired wrappers.
      const needle = stripOuterQuotes(value.slice(index + 2));
      assertions.push({
        op: flag === '--contains' ? 'contains' : flag === '--not-contains' ? 'notContains' : 'matches',
        path,
        value: needle,
      });
    }
  }
  return {
    type: 'command',
    command: `node __bench__/grade.mjs --json ${JSON.stringify(JSON.stringify(assertions))}`,
    timeoutMs: 30000,
  };
}

function buildCommand(fixture) {
  if (fixture === 'frontend-app') {
    return { type: 'command', command: 'npm run typecheck', timeoutMs: 180000 };
  }
  return { type: 'command', command: 'npm run build', timeoutMs: 180000 };
}

function lintCommand() {
  return { type: 'command', command: 'npm run lint', timeoutMs: 60000 };
}

function caseObj({
  id,
  familyId,
  difficulty,
  capability,
  fixture,
  category,
  prompt,
  rationale,
  preconditions = [],
  checks,
}) {
  return {
    id,
    familyId,
    variant: 1,
    suite: 'frontend',
    category,
    difficulty,
    mode: 'agent',
    capability,
    fixture,
    prompt,
    rationale,
    preconditions,
    checks,
  };
}

function feature(n, fields) {
  return caseObj({
    id: `fe-feature-${String(n).padStart(3, '0')}-${fields.slug}-v1`,
    familyId: `fe-feature-${fields.slug}`,
    difficulty: 'medium',
    capability: 'feature',
    ...fields,
  });
}

function bugfix(n, fields) {
  return caseObj({
    id: `fe-bugfix-${String(n).padStart(3, '0')}-${fields.slug}-v1`,
    familyId: `fe-bugfix-${fields.slug}`,
    difficulty: 'hard',
    capability: 'bugfix',
    ...fields,
  });
}

function docs(n, fields) {
  return caseObj({
    id: `fe-docs-${String(n).padStart(3, '0')}-${fields.slug}-v1`,
    familyId: `fe-docs-${fields.slug}`,
    difficulty: 'easy',
    capability: 'docs',
    ...fields,
  });
}

function retrieval(n, fields) {
  return caseObj({
    id: `fe-retrieval-${String(n).padStart(3, '0')}-${fields.slug}-v1`,
    familyId: `fe-retrieval-${fields.slug}`,
    difficulty: 'easy',
    capability: 'retrieval',
    ...fields,
  });
}

function testing(n, fields) {
  return caseObj({
    id: `fe-testing-${String(n).padStart(3, '0')}-${fields.slug}-v1`,
    familyId: `fe-testing-${fields.slug}`,
    difficulty: 'hard',
    capability: 'testing',
    ...fields,
  });
}

const features = [
  feature(1, {
    slug: 'about-page',
    fixture: 'next-app',
    category: 'routing',
    prompt:
      'Add a new /about route with a static page that renders the exact text "About this benchmark app".',
    rationale: 'App Router page addition graded by filesystem grader + build.',
    preconditions: [{ type: 'file_not_exists', path: 'app/about/page.tsx' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      { type: 'file_exists', path: 'app/about/page.tsx' },
      gradeCommand('--exists', 'app/about/page.tsx', '--contains', 'app/about/page.tsx::About this benchmark app'),
      buildCommand('next-app'),
    ],
  }),
  feature(2, {
    slug: 'open-graph-metadata',
    fixture: 'next-app',
    category: 'seo',
    prompt: "Add an openGraph title and description to app/layout.tsx's metadata export.",
    rationale: 'Metadata extension graded by grader + build.',
    preconditions: [{ type: 'file_not_contains', path: 'app/layout.tsx', value: 'openGraph' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      { type: 'file_contains', path: 'app/layout.tsx', value: 'openGraph' },
      gradeCommand('--contains', 'app/layout.tsx::openGraph'),
      buildCommand('next-app'),
    ],
  }),
  feature(3, {
    slug: 'error-boundary',
    fixture: 'next-app',
    category: 'routing',
    prompt: 'Add app/error.tsx for the home route following Next.js App Router conventions.',
    rationale: 'Convention file addition.',
    preconditions: [{ type: 'file_not_exists', path: 'app/error.tsx' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      { type: 'file_exists', path: 'app/error.tsx' },
      gradeCommand('--exists', 'app/error.tsx', '--matches', 'app/error.tsx::export default'),
      buildCommand('next-app'),
    ],
  }),
  feature(4, {
    slug: 'home-about-link',
    fixture: 'next-app',
    category: 'routing',
    prompt: 'Add a link on the home page that points to /about (href="/about").',
    rationale: 'Small link addition on existing page.',
    preconditions: [{ type: 'file_not_contains', path: 'app/page.tsx', value: '/about' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand('--contains', 'app/page.tsx::/about'),
      buildCommand('next-app'),
    ],
  }),
  feature(5, {
    slug: 'favicon-icons-metadata',
    fixture: 'next-app',
    category: 'seo',
    prompt: "Add an icons entry to app/layout.tsx metadata for a favicon at /favicon.ico.",
    rationale: 'Icons metadata addition.',
    preconditions: [{ type: 'file_not_contains', path: 'app/layout.tsx', value: 'icons' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand('--contains app/layout.tsx::icons', '--contains app/layout.tsx::favicon.ico'),
      buildCommand('next-app'),
    ],
  }),
  feature(6, {
    slug: 'loading-spinner-green',
    fixture: 'next-app',
    category: 'styling',
    prompt: 'Change the loading spinner border color class from blue-500 to green-500 in app/loading.tsx.',
    rationale: 'Trivial class rename with grader proof.',
    preconditions: [{ type: 'file_contains', path: 'app/loading.tsx', value: 'blue-500' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand('--contains app/loading.tsx::green-500', '--not-contains app/loading.tsx::blue-500'),
      buildCommand('next-app'),
    ],
  }),
  feature(7, {
    slug: 'not-found-page',
    fixture: 'next-app',
    category: 'routing',
    prompt: 'Add app/not-found.tsx that renders "Page not found".',
    rationale: 'App Router not-found convention.',
    preconditions: [{ type: 'file_not_exists', path: 'app/not-found.tsx' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand('--exists app/not-found.tsx', '--contains \'app/not-found.tsx::Page not found\''),
      buildCommand('next-app'),
    ],
  }),
  feature(8, {
    slug: 'contact-page',
    fixture: 'next-app',
    category: 'routing',
    prompt: 'Add a /contact route that renders a heading "Contact" and a paragraph "Reach the Mitii team".',
    rationale: 'Second static route addition.',
    preconditions: [{ type: 'file_not_exists', path: 'app/contact/page.tsx' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand(
        '--exists app/contact/page.tsx',
        '--contains app/contact/page.tsx::Contact',
        '--contains \'app/contact/page.tsx::Reach the Mitii team\''
      ),
      buildCommand('next-app'),
    ],
  }),
  feature(9, {
    slug: 'robots-metadata',
    fixture: 'next-app',
    category: 'seo',
    prompt: "Add a robots entry to app/layout.tsx metadata with index: true and follow: true.",
    rationale: 'Robots metadata object.',
    preconditions: [{ type: 'file_not_contains', path: 'app/layout.tsx', value: 'robots' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand('--contains app/layout.tsx::robots', '--contains app/layout.tsx::index'),
      buildCommand('next-app'),
    ],
  }),
  feature(10, {
    slug: 'html-lang-attribute',
    fixture: 'next-app',
    category: 'a11y',
    prompt: 'Ensure the root <html> element in app/layout.tsx keeps lang="en" and add a data-fixture="next-app" attribute on <body>.',
    rationale: 'Small layout attribute addition.',
    preconditions: [{ type: 'file_not_contains', path: 'app/layout.tsx', value: 'data-fixture' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand('--contains \'app/layout.tsx::lang="en"\'', '--contains \'app/layout.tsx::data-fixture="next-app"\''),
      buildCommand('next-app'),
    ],
  }),
  feature(11, {
    slug: 'button-danger-variant',
    fixture: 'react-vite',
    category: 'components',
    prompt:
      "Extend Button's variant union with 'danger', style it via btn-danger, and render one danger Button in App.tsx with label \"Delete\".",
    rationale: 'Union + usage across two files.',
    preconditions: [
      { type: 'file_not_contains', path: 'src/components/Button.tsx', value: "'danger'" },
      { type: 'file_not_contains', path: 'src/App.tsx', value: 'Delete' },
    ],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand(
        '--contains src/components/Button.tsx::danger',
        '--contains src/App.tsx::Delete',
        '--contains src/App.tsx::danger'
      ),
      buildCommand('react-vite'),
    ],
  }),
  feature(12, {
    slug: 'button-onclick-prop',
    fixture: 'react-vite',
    category: 'components',
    prompt: 'Add an optional onClick prop to Button and wire it to the underlying <button> element.',
    rationale: 'Prop plumbing on existing component.',
    preconditions: [{ type: 'file_not_contains', path: 'src/components/Button.tsx', value: 'onClick' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand('--contains src/components/Button.tsx::onClick'),
      buildCommand('react-vite'),
    ],
  }),
  feature(13, {
    slug: 'app-heading-rename',
    fixture: 'react-vite',
    category: 'ui',
    prompt: 'Change the h1 text in src/App.tsx to exactly "Mitii Benchmark React App".',
    rationale: 'Exact copy change.',
    preconditions: [
      { type: 'file_not_contains', path: 'src/App.tsx', value: 'Mitii Benchmark React App' },
    ],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand('--contains \'src/App.tsx::Mitii Benchmark React App\''),
      buildCommand('react-vite'),
    ],
  }),
  feature(14, {
    slug: 'footer-component',
    fixture: 'react-vite',
    category: 'components',
    prompt:
      'Create src/components/Footer.tsx that renders <footer>Mitii Benchmark</footer> and include it in App.tsx.',
    rationale: 'New component + wiring.',
    preconditions: [{ type: 'file_not_exists', path: 'src/components/Footer.tsx' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand(
        '--exists src/components/Footer.tsx',
        '--contains \'src/components/Footer.tsx::Mitii Benchmark\'',
        '--contains src/App.tsx::Footer'
      ),
      buildCommand('react-vite'),
    ],
  }),
  feature(15, {
    slug: 'badge-component',
    fixture: 'react-vite',
    category: 'components',
    prompt:
      'Add src/components/Badge.tsx exporting a Badge component that accepts a text prop and renders it inside a <span className="badge">.',
    rationale: 'New presentational component.',
    preconditions: [{ type: 'file_not_exists', path: 'src/components/Badge.tsx' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand(
        '--exists src/components/Badge.tsx',
        '--contains \'src/components/Badge.tsx::className="badge"\'',
        '--contains src/components/Badge.tsx::text'
      ),
      buildCommand('react-vite'),
    ],
  }),
  feature(16, {
    slug: 'card-component',
    fixture: 'react-vite',
    category: 'components',
    prompt:
      'Add src/components/Card.tsx with props title and children. Render a <section className="card"> with an <h2> for the title and the children below.',
    rationale: 'Composite presentational component.',
    preconditions: [{ type: 'file_not_exists', path: 'src/components/Card.tsx' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand(
        '--exists src/components/Card.tsx',
        '--contains \'src/components/Card.tsx::className="card"\'',
        '--contains src/components/Card.tsx::title',
        '--contains src/components/Card.tsx::children'
      ),
      buildCommand('react-vite'),
    ],
  }),
  feature(17, {
    slug: 'ghost-variant',
    fixture: 'react-vite',
    category: 'components',
    prompt:
      "Add a 'ghost' variant to Button's variant union and render a ghost Button in App.tsx labeled \"Ghost\".",
    rationale: 'Second variant extension path.',
    preconditions: [{ type: 'file_not_contains', path: 'src/components/Button.tsx', value: 'ghost' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand('--contains src/components/Button.tsx::ghost', '--contains src/App.tsx::Ghost'),
      buildCommand('react-vite'),
    ],
  }),
  feature(18, {
    slug: 'disabled-prop',
    fixture: 'react-vite',
    category: 'components',
    prompt: 'Add an optional disabled boolean prop to Button and pass it through to the <button> element.',
    rationale: 'Boolean prop plumbing.',
    preconditions: [{ type: 'file_not_contains', path: 'src/components/Button.tsx', value: 'disabled' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand('--contains src/components/Button.tsx::disabled'),
      buildCommand('react-vite'),
    ],
  }),
  feature(19, {
    slug: 'app-data-testid',
    fixture: 'react-vite',
    category: 'testing-hooks',
    prompt: 'Add data-testid="app-root" to the <main> element in App.tsx.',
    rationale: 'Testability attribute.',
    preconditions: [{ type: 'file_not_contains', path: 'src/App.tsx', value: 'data-testid' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand('--contains \'src/App.tsx::data-testid="app-root"\''),
      buildCommand('react-vite'),
    ],
  }),
  feature(20, {
    slug: 'skip-link',
    fixture: 'react-vite',
    category: 'a11y',
    prompt:
      'Add a skip link as the first child inside <main> in App.tsx: <a href="#main-content">Skip to content</a>, and set id="main-content" on the heading.',
    rationale: 'Basic a11y skip link.',
    preconditions: [{ type: 'file_not_contains', path: 'src/App.tsx', value: 'Skip to content' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand(
        '--contains \'src/App.tsx::Skip to content\'',
        '--contains \'src/App.tsx::id="main-content"\''
      ),
      buildCommand('react-vite'),
    ],
  }),
];

const bugfixes = [
  bugfix(1, {
    slug: 'secondary-label-typo',
    fixture: 'react-vite',
    category: 'ui',
    prompt: 'The secondary Button label is misspelled as "Secondry". Fix it to "Secondary".',
    rationale: 'Seeded typo in App.tsx.',
    preconditions: [{ type: 'file_contains', path: 'src/App.tsx', value: 'Secondry' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand('--contains src/App.tsx::Secondary', '--not-contains src/App.tsx::Secondry'),
      buildCommand('react-vite'),
    ],
  }),
  bugfix(2, {
    slug: 'greet-typo',
    fixture: 'react-vite',
    category: 'utils',
    prompt: 'src/utils/text.ts greet() returns "Helllo". Fix it so it returns "Hello, {name}".',
    rationale: 'Seeded string bug in utility.',
    preconditions: [{ type: 'file_contains', path: 'src/utils/text.ts', value: 'Helllo' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand('--contains \'src/utils/text.ts::Hello, ${name}\'', '--not-contains src/utils/text.ts::Helllo'),
      buildCommand('react-vite'),
    ],
  }),
  bugfix(3, {
    slug: 'max-label-off-by-one',
    fixture: 'react-vite',
    category: 'utils',
    prompt:
      'maxLabelLength in src/utils/text.ts is off-by-one (subtracts 1). Fix it to return the true maximum label length.',
    rationale: 'Seeded off-by-one.',
    preconditions: [{ type: 'file_contains', path: 'src/utils/text.ts', value: ') - 1' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand('--not-contains \'src/utils/text.ts::) - 1\'', '--contains src/utils/text.ts::label.length'),
      buildCommand('react-vite'),
    ],
  }),
  bugfix(4, {
    slug: 'alert-role',
    fixture: 'react-vite',
    category: 'a11y',
    prompt: 'Alert uses role="status". Change it to role="alert".',
    rationale: 'Seeded a11y role bug.',
    preconditions: [{ type: 'file_contains', path: 'src/components/Alert.tsx', value: 'role="status"' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand(
        '--contains \'src/components/Alert.tsx::role="alert"\'',
        '--not-contains \'src/components/Alert.tsx::role="status"\''
      ),
      buildCommand('react-vite'),
    ],
  }),
  bugfix(5, {
    slug: 'counter-increment',
    fixture: 'react-vite',
    category: 'components',
    prompt: 'Counter increments by 2. Fix the Increment button so it adds 1.',
    rationale: 'Seeded counter bug.',
    preconditions: [{ type: 'file_contains', path: 'src/components/Counter.tsx', value: 'current + 2' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand(
        '--contains \'src/components/Counter.tsx::current + 1\'',
        '--not-contains \'src/components/Counter.tsx::current + 2\''
      ),
      buildCommand('react-vite'),
    ],
  }),
  bugfix(6, {
    slug: 'button-type-attribute',
    fixture: 'react-vite',
    category: 'components',
    prompt: 'Button renders a <button> without type. Add type="button" to avoid accidental submit behavior.',
    rationale: 'Missing button type.',
    preconditions: [{ type: 'file_not_contains', path: 'src/components/Button.tsx', value: 'type="button"' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand('--contains \'src/components/Button.tsx::type="button"\''),
      buildCommand('react-vite'),
    ],
  }),
  bugfix(7, {
    slug: 'fixture-typo-home',
    fixture: 'next-app',
    category: 'copy',
    prompt: 'Home page copy says "Fixtuer". Fix the typo to "Fixture".',
    rationale: 'Seeded typo in page.tsx.',
    preconditions: [{ type: 'file_contains', path: 'app/page.tsx', value: 'Fixtuer' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand('--contains app/page.tsx::Fixture', '--not-contains app/page.tsx::Fixtuer'),
      buildCommand('next-app'),
    ],
  }),
  bugfix(8, {
    slug: 'loading-typo',
    fixture: 'next-app',
    category: 'copy',
    prompt: 'Loading UI shows "Lodding...". Fix it to "Loading...".',
    rationale: 'Seeded typo in loading.tsx.',
    preconditions: [{ type: 'file_contains', path: 'app/loading.tsx', value: 'Lodding' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand('--contains app/loading.tsx::Loading...', '--not-contains app/loading.tsx::Lodding'),
      buildCommand('next-app'),
    ],
  }),
  bugfix(9, {
    slug: 'metadata-description-typo',
    fixture: 'next-app',
    category: 'seo',
    prompt: 'metadata.description says "benchmak". Fix it to "benchmark".',
    rationale: 'Seeded typo in layout metadata.',
    preconditions: [{ type: 'file_contains', path: 'app/layout.tsx', value: 'benchmak' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand('--contains app/layout.tsx::benchmark', '--not-contains app/layout.tsx::benchmak'),
      buildCommand('next-app'),
    ],
  }),
  bugfix(10, {
    slug: 'loading-docs-color',
    fixture: 'next-app',
    category: 'docs',
    prompt:
      'docs/loading-indicator.md claims the spinner uses border-blue-500. Update that doc line to say border-green-500 instead (docs-only fix; do not change loading.tsx unless required).',
    rationale: 'Doc/source drift fix focused on docs file.',
    preconditions: [
      { type: 'file_contains', path: 'docs/loading-indicator.md', value: 'border-blue-500' },
    ],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand(
        '--contains docs/loading-indicator.md::border-green-500',
        '--not-contains docs/loading-indicator.md::border-blue-500'
      ),
      buildCommand('next-app'),
    ],
  }),
  bugfix(11, {
    slug: 'frontend-app-heading-typo',
    fixture: 'frontend-app',
    category: 'copy',
    prompt: 'The App heading says "Benchmrk". Fix it to "Benchmark".',
    rationale: 'Seeded typo in frontend-app App.tsx.',
    preconditions: [{ type: 'file_contains', path: 'src/App.tsx', value: 'Benchmrk' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand('--contains src/App.tsx::Benchmark', '--not-contains src/App.tsx::Benchmrk'),
      buildCommand('frontend-app'),
    ],
  }),
  bugfix(12, {
    slug: 'stepper-decrement',
    fixture: 'frontend-app',
    category: 'hooks',
    prompt: 'useStepper decrement subtracts 2. Fix it to subtract 1.',
    rationale: 'Seeded hook bug.',
    preconditions: [
      { type: 'file_contains', path: 'src/hooks/useStepper.ts', value: 'current - 2' },
    ],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand(
        '--contains \'src/hooks/useStepper.ts::current - 1\'',
        '--not-contains \'src/hooks/useStepper.ts::current - 2\''
      ),
      buildCommand('frontend-app'),
    ],
  }),
  bugfix(13, {
    slug: 'button-aria-busy-default',
    fixture: 'react-vite',
    category: 'components',
    prompt: 'Add optional aria-busy?: boolean to ButtonProps and pass aria-busy={ariaBusy} through to the button element (default undefined/omitted).',
    rationale: 'A11y prop plumbing.',
    preconditions: [{ type: 'file_not_contains', path: 'src/components/Button.tsx', value: 'aria-busy' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      { type: 'file_contains', path: 'src/components/Button.tsx', value: 'aria-busy' },
      gradeCommand('--contains src/components/Button.tsx::aria-busy'),
      buildCommand('react-vite'),
    ],
  }),
  bugfix(14, {
    slug: 'css-focus-outline',
    fixture: 'react-vite',
    category: 'styling',
    prompt: 'In src/index.css add a rule `.btn:focus { outline: 2px solid #005fcc; }` for keyboard focus visibility.',
    rationale: 'Focus style addition.',
    preconditions: [{ type: 'file_not_contains', path: 'src/index.css', value: '.btn:focus' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      { type: 'file_contains', path: 'src/index.css', value: '.btn:focus' },
      gradeCommand('--contains src/index.css::.btn:focus', '--contains src/index.css::#005fcc'),
      buildCommand('react-vite'),
    ],
  }),
  bugfix(15, {
    slug: 'alert-default-tone-docs',
    fixture: 'react-vite',
    category: 'components',
    prompt:
      'In src/components/Alert.tsx add a one-line comment above the component: // Default tone is info.',
    rationale: 'Small documentation comment addition on Alert.',
    preconditions: [
      { type: 'file_not_contains', path: 'src/components/Alert.tsx', value: 'Default tone is info' },
    ],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      { type: 'file_contains', path: 'src/components/Alert.tsx', value: 'Default tone is info' },
      gradeCommand('--contains src/components/Alert.tsx::Default tone is info'),
      buildCommand('react-vite'),
    ],
  }),
  bugfix(16, {
    slug: 'counter-aria-label',
    fixture: 'react-vite',
    category: 'a11y',
    prompt: 'Add aria-label="Increment counter" to the Increment button in Counter.tsx.',
    rationale: 'Missing accessible name on control.',
    preconditions: [
      { type: 'file_not_contains', path: 'src/components/Counter.tsx', value: 'aria-label' },
    ],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      { type: 'file_contains', path: 'src/components/Counter.tsx', value: 'aria-label="Increment counter"' },
      gradeCommand('--contains src/components/Counter.tsx::aria-label="Increment counter"'),
      buildCommand('react-vite'),
    ],
  }),
  bugfix(17, {
    slug: 'next-body-class',
    fixture: 'next-app',
    category: 'styling',
    prompt: 'Add className="mitii-root" to the <body> element in app/layout.tsx.',
    rationale: 'Root class hook for styling.',
    preconditions: [{ type: 'file_not_contains', path: 'app/layout.tsx', value: 'mitii-root' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      { type: 'file_contains', path: 'app/layout.tsx', value: 'mitii-root' },
      gradeCommand('--contains app/layout.tsx::mitii-root'),
      buildCommand('next-app'),
    ],
  }),
  bugfix(18, {
    slug: 'home-main-id',
    fixture: 'next-app',
    category: 'a11y',
    prompt: 'Add id="home-main" to the <main> element in app/page.tsx.',
    rationale: 'Landmark id for skip targets.',
    preconditions: [{ type: 'file_not_contains', path: 'app/page.tsx', value: 'home-main' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      { type: 'file_contains', path: 'app/page.tsx', value: 'id="home-main"' },
      gradeCommand('--contains app/page.tsx::id="home-main"'),
      buildCommand('next-app'),
    ],
  }),
  bugfix(19, {
    slug: 'readme-add-lint-bullet',
    fixture: 'react-vite',
    category: 'docs',
    prompt: 'In README.md Scripts section, add a bullet: `npm run lint` — lint placeholder.',
    rationale: 'Docs accuracy addition.',
    preconditions: [{ type: 'file_not_contains', path: 'README.md', value: 'npm run lint' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      { type: 'file_contains', path: 'README.md', value: 'npm run lint' },
      gradeCommand('--contains README.md::npm run lint'),
      buildCommand('react-vite'),
    ],
  }),
  bugfix(20, {
    slug: 'components-readme-alert',
    fixture: 'react-vite',
    category: 'docs',
    prompt:
      'In src/components/README.md, append a line: Alert.tsx is available for tone-based messages.',
    rationale: 'Document Alert component presence.',
    preconditions: [
      { type: 'file_not_contains', path: 'src/components/README.md', value: 'Alert.tsx is available' },
    ],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      { type: 'file_contains', path: 'src/components/README.md', value: 'Alert.tsx is available' },
      gradeCommand('--contains src/components/README.md::Alert.tsx is available'),
      buildCommand('react-vite'),
    ],
  }),
];

const docsCases = [
  docs(1, {
    slug: 'react-running-locally',
    fixture: 'react-vite',
    category: 'docs',
    prompt:
      'Add a "## Running locally" section to README.md that mentions npm install, npm run dev, and npm run build.',
    rationale: 'Docs section addition.',
    preconditions: [{ type: 'file_not_contains', path: 'README.md', value: 'Running locally' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand(
        '--contains \'README.md::Running locally\'',
        '--contains README.md::npm install',
        '--contains \'README.md::npm run dev\'',
        '--contains \'README.md::npm run build\''
      ),
      lintCommand(),
    ],
  }),
  docs(2, {
    slug: 'react-project-structure',
    fixture: 'react-vite',
    category: 'docs',
    prompt:
      'Add a "## Project structure" section to README.md listing src/App.tsx, src/components/Button.tsx, and src/index.css.',
    rationale: 'Structure documentation.',
    preconditions: [{ type: 'file_not_contains', path: 'README.md', value: 'Project structure' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand(
        '--contains \'README.md::Project structure\'',
        '--contains README.md::src/App.tsx',
        '--contains README.md::Button.tsx'
      ),
      lintCommand(),
    ],
  }),
  docs(3, {
    slug: 'button-usage-docs',
    fixture: 'react-vite',
    category: 'docs',
    prompt:
      'Append a "## Button" section to src/components/README.md documenting that variants are primary and secondary.',
    rationale: 'Component docs.',
    preconditions: [{ type: 'file_not_contains', path: 'src/components/README.md', value: '## Button' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand(
        '--contains \'src/components/README.md::## Button\'',
        '--contains src/components/README.md::primary',
        '--contains src/components/README.md::secondary'
      ),
      lintCommand(),
    ],
  }),
  docs(4, {
    slug: 'next-contributing',
    fixture: 'next-app',
    category: 'docs',
    prompt: 'Add a "## Contributing" section to README.md with a sentence about keeping changes scoped.',
    rationale: 'Top-level docs addition on next-app.',
    preconditions: [{ type: 'file_not_contains', path: 'README.md', value: '## Contributing' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand('--contains \'README.md::## Contributing\'', '--contains README.md::scoped'),
      lintCommand(),
    ],
  }),
  docs(5, {
    slug: 'next-env-docs',
    fixture: 'next-app',
    category: 'docs',
    prompt: 'Create docs/environment.md describing that PORT defaults to 3000 for `npm run dev`.',
    rationale: 'New docs file.',
    preconditions: [{ type: 'file_not_exists', path: 'docs/environment.md' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand('--exists docs/environment.md', '--contains docs/environment.md::3000'),
      lintCommand(),
    ],
  }),
  docs(6, {
    slug: 'next-routing-docs',
    fixture: 'next-app',
    category: 'docs',
    prompt: 'Create docs/routing.md explaining that routes live under the app/ directory (App Router).',
    rationale: 'Routing docs file.',
    preconditions: [{ type: 'file_not_exists', path: 'docs/routing.md' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand('--exists docs/routing.md', '--contains docs/routing.md::app/', '--contains docs/routing.md::App Router'),
      lintCommand(),
    ],
  }),
  docs(7, {
    slug: 'loading-docs-notes',
    fixture: 'next-app',
    category: 'docs',
    prompt: 'In docs/loading-indicator.md, add a "## Verification notes" section with one sentence about checking the spinner in the browser.',
    rationale: 'Section addition to existing docs.',
    preconditions: [
      { type: 'file_not_contains', path: 'docs/loading-indicator.md', value: '## Verification notes' },
    ],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand('--contains docs/loading-indicator.md::## Verification notes'),
      lintCommand(),
    ],
  }),
  docs(8, {
    slug: 'frontend-app-testing-docs',
    fixture: 'frontend-app',
    category: 'docs',
    prompt: 'Add a "## Testing" section to README.md mentioning `npm test` runs Vitest.',
    rationale: 'Testing docs on frontend-app.',
    preconditions: [{ type: 'file_not_contains', path: 'README.md', value: '## Testing' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand('--contains \'README.md::## Testing\'', '--contains README.md::Vitest'),
      lintCommand(),
    ],
  }),
  docs(9, {
    slug: 'frontend-app-architecture',
    fixture: 'frontend-app',
    category: 'docs',
    prompt: 'Create docs/architecture.md stating the UI is React + Vite + TypeScript.',
    rationale: 'Architecture doc.',
    preconditions: [{ type: 'file_not_exists', path: 'docs/architecture.md' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand(
        '--exists docs/architecture.md',
        '--contains docs/architecture.md::React',
        '--contains docs/architecture.md::Vite',
        '--contains docs/architecture.md::TypeScript'
      ),
      lintCommand(),
    ],
  }),
  docs(10, {
    slug: 'react-changelog',
    fixture: 'react-vite',
    category: 'docs',
    prompt: 'Create CHANGELOG.md with an "## Unreleased" section containing "- Benchmark fixture baseline".',
    rationale: 'Changelog file creation.',
    preconditions: [{ type: 'file_not_exists', path: 'CHANGELOG.md' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand(
        '--exists CHANGELOG.md',
        '--contains \'CHANGELOG.md::## Unreleased\'',
        '--contains \'CHANGELOG.md::Benchmark fixture baseline\''
      ),
      lintCommand(),
    ],
  }),
];

const retrievalCases = [
  retrieval(1, {
    slug: 'button-variants',
    fixture: 'react-vite',
    category: 'retrieval',
    prompt: 'What variant values does Button accept? Answer from src/components/Button.tsx only.',
    rationale: 'Read union type from Button.',
    checks: [
      ...baseAgent,
      { type: 'output_contains', value: 'primary' },
      { type: 'output_contains', value: 'secondary' },
      { type: 'workspace_unchanged' },
      lintCommand(),
    ],
  }),
  retrieval(2, {
    slug: 'app-button-labels',
    fixture: 'react-vite',
    category: 'retrieval',
    prompt: 'Which Button labels are rendered in App.tsx? Quote them exactly.',
    rationale: 'Includes seeded Secondry typo — must report actual source.',
    checks: [
      ...baseAgent,
      { type: 'output_contains', value: 'Primary' },
      { type: 'output_contains', value: 'Secondry' },
      { type: 'workspace_unchanged' },
      lintCommand(),
    ],
  }),
  retrieval(3, {
    slug: 'greet-current-return',
    fixture: 'react-vite',
    category: 'retrieval',
    prompt: 'What exact string template does greet() currently return in src/utils/text.ts?',
    rationale: 'Must observe Helllo bug without fixing.',
    checks: [
      ...baseAgent,
      { type: 'output_contains', value: 'Helllo' },
      { type: 'workspace_unchanged' },
      lintCommand(),
    ],
  }),
  retrieval(4, {
    slug: 'counter-increment-amount',
    fixture: 'react-vite',
    category: 'retrieval',
    prompt: 'By how much does Counter currently increment on click? Answer with the numeric delta from source.',
    rationale: 'Read seeded +2 bug.',
    checks: [
      ...baseAgent,
      { type: 'output_regex', pattern: '\\b2\\b' },
      { type: 'workspace_unchanged' },
      lintCommand(),
    ],
  }),
  retrieval(5, {
    slug: 'alert-role-current',
    fixture: 'react-vite',
    category: 'retrieval',
    prompt: 'What role attribute does Alert currently set?',
    rationale: 'Read seeded status role.',
    checks: [
      ...baseAgent,
      { type: 'output_contains', value: 'status' },
      { type: 'workspace_unchanged' },
      lintCommand(),
    ],
  }),
  retrieval(6, {
    slug: 'next-metadata-title',
    fixture: 'next-app',
    category: 'retrieval',
    prompt: 'What is metadata.title in app/layout.tsx?',
    rationale: 'Exact metadata read.',
    checks: [
      ...baseAgent,
      { type: 'output_contains', value: 'Benchmark Next App' },
      { type: 'workspace_unchanged' },
      lintCommand(),
    ],
  }),
  retrieval(7, {
    slug: 'next-loading-file',
    fixture: 'next-app',
    category: 'retrieval',
    prompt: 'Which file implements the App Router loading UI for this project?',
    rationale: 'Path retrieval.',
    checks: [
      ...baseAgent,
      { type: 'output_contains', value: 'loading.tsx' },
      { type: 'workspace_unchanged' },
      lintCommand(),
    ],
  }),
  retrieval(8, {
    slug: 'next-home-heading',
    fixture: 'next-app',
    category: 'retrieval',
    prompt: 'What is the home page h1 text?',
    rationale: 'Copy retrieval.',
    checks: [
      ...baseAgent,
      { type: 'output_contains', value: 'Next.js Benchmark Home' },
      { type: 'workspace_unchanged' },
      lintCommand(),
    ],
  }),
  retrieval(9, {
    slug: 'frontend-app-test-runner',
    fixture: 'frontend-app',
    category: 'retrieval',
    prompt: 'Which test runner does package.json script "test" invoke?',
    rationale: 'package.json script retrieval.',
    checks: [
      ...baseAgent,
      { type: 'output_contains', value: 'vitest' },
      { type: 'workspace_unchanged' },
      lintCommand(),
    ],
  }),
  retrieval(10, {
    slug: 'frontend-app-entry',
    fixture: 'frontend-app',
    category: 'retrieval',
    prompt: 'What is the React entry file under src/ for this Vite app?',
    rationale: 'Entry file retrieval.',
    checks: [
      ...baseAgent,
      { type: 'output_contains', value: 'main.tsx' },
      { type: 'workspace_unchanged' },
      lintCommand(),
    ],
  }),
];

const testingCases = [
  testing(1, {
    slug: 'button-renders-label',
    fixture: 'frontend-app',
    category: 'testing',
    prompt:
      'Add src/components/Button.label.test.tsx with a Vitest test that imports Button and asserts typeof Button === "function".',
    rationale: 'Agent authors a minimal Vitest file.',
    preconditions: [{ type: 'file_not_exists', path: 'src/components/Button.label.test.tsx' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      { type: 'file_exists', path: 'src/components/Button.label.test.tsx' },
      gradeCommand('--exists src/components/Button.label.test.tsx', '--contains src/components/Button.label.test.tsx::Button'),
      { type: 'command', command: 'npm test -- src/components/Button.label.test.tsx', timeoutMs: 120000 },
    ],
  }),
  testing(2, {
    slug: 'button-primary-mention',
    fixture: 'frontend-app',
    category: 'testing',
    prompt:
      'Create src/components/Button.primary.test.tsx that mentions variant primary in a Vitest it() block and asserts typeof Button === "function".',
    rationale: 'Test file must mention primary and pass vitest.',
    preconditions: [{ type: 'file_not_exists', path: 'src/components/Button.primary.test.tsx' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand(
        '--exists src/components/Button.primary.test.tsx',
        '--contains src/components/Button.primary.test.tsx::primary'
      ),
      { type: 'command', command: 'npm test -- src/components/Button.primary.test.tsx', timeoutMs: 120000 },
    ],
  }),
  testing(3, {
    slug: 'app-smoke-test',
    fixture: 'frontend-app',
    category: 'testing',
    prompt:
      'Add src/App.smoke.test.tsx importing App and asserting typeof App === "function" with Vitest.',
    rationale: 'App smoke test.',
    preconditions: [{ type: 'file_not_exists', path: 'src/App.smoke.test.tsx' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand('--exists src/App.smoke.test.tsx', '--contains src/App.smoke.test.tsx::App'),
      { type: 'command', command: 'npm test -- src/App.smoke.test.tsx', timeoutMs: 120000 },
    ],
  }),
  testing(4, {
    slug: 'stepper-hook-test',
    fixture: 'frontend-app',
    category: 'testing',
    prompt:
      'Add src/hooks/useStepper.test.ts that imports useStepper and asserts typeof useStepper === "function".',
    rationale: 'Hook unit smoke test.',
    preconditions: [{ type: 'file_not_exists', path: 'src/hooks/useStepper.test.ts' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand('--exists src/hooks/useStepper.test.ts', '--contains src/hooks/useStepper.test.ts::useStepper'),
      { type: 'command', command: 'npm test -- src/hooks/useStepper.test.ts', timeoutMs: 120000 },
    ],
  }),
  testing(5, {
    slug: 'button-secondary-test',
    fixture: 'frontend-app',
    category: 'testing',
    prompt:
      'Add src/components/Button.secondary.test.tsx mentioning secondary and asserting typeof Button === "function".',
    rationale: 'Secondary variant mention in tests.',
    preconditions: [{ type: 'file_not_exists', path: 'src/components/Button.secondary.test.tsx' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand(
        '--exists src/components/Button.secondary.test.tsx',
        '--contains src/components/Button.secondary.test.tsx::secondary'
      ),
      { type: 'command', command: 'npm test -- src/components/Button.secondary.test.tsx', timeoutMs: 120000 },
    ],
  }),
  testing(6, {
    slug: 'package-test-script',
    fixture: 'frontend-app',
    category: 'testing',
    prompt: 'Ensure package.json keeps "test": "vitest run". Do not remove Vitest.',
    rationale: 'Preserve test script.',
    preconditions: [{ type: 'file_contains', path: 'package.json', value: 'vitest run' }],
    checks: [
      ...baseAgent,
      { type: 'file_contains', path: 'package.json', value: 'vitest run' },
      gradeCommand('--contains \'package.json::vitest run\''),
      { type: 'command', command: 'npm test -- src/components/Button.test.tsx', timeoutMs: 120000 },
    ],
  }),
  testing(7, {
    slug: 'baseline-button-test-keep',
    fixture: 'frontend-app',
    category: 'testing',
    prompt: 'Keep src/components/Button.test.tsx passing. You may improve it but npm test for that file must succeed.',
    rationale: 'Do not break baseline tests.',
    preconditions: [{ type: 'file_exists', path: 'src/components/Button.test.tsx' }],
    checks: [
      ...baseAgent,
      { type: 'file_exists', path: 'src/components/Button.test.tsx' },
      gradeCommand('--exists src/components/Button.test.tsx'),
      { type: 'command', command: 'npm test -- src/components/Button.test.tsx', timeoutMs: 120000 },
    ],
  }),
  testing(8, {
    slug: 'vitest-describe-block',
    fixture: 'frontend-app',
    category: 'testing',
    prompt:
      'Create src/components/Button.describe.test.tsx with a describe("Button") block and one it() asserting typeof Button === "function".',
    rationale: 'describe/it structure.',
    preconditions: [{ type: 'file_not_exists', path: 'src/components/Button.describe.test.tsx' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand(
        '--exists src/components/Button.describe.test.tsx',
        '--contains \'src/components/Button.describe.test.tsx::describe(\'',
        '--contains \'src/components/Button.describe.test.tsx::it(\''
      ),
      { type: 'command', command: 'npm test -- src/components/Button.describe.test.tsx', timeoutMs: 120000 },
    ],
  }),
  testing(9, {
    slug: 'expect-true-test',
    fixture: 'frontend-app',
    category: 'testing',
    prompt:
      'Add src/sanity.test.ts with Vitest that expects true to be true (expect(true).toBe(true)).',
    rationale: 'Sanity vitest file.',
    preconditions: [{ type: 'file_not_exists', path: 'src/sanity.test.ts' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand('--exists src/sanity.test.ts', '--contains \'src/sanity.test.ts::toBe(true)\''),
      { type: 'command', command: 'npm test -- src/sanity.test.ts', timeoutMs: 120000 },
    ],
  }),
  testing(10, {
    slug: 'hooks-folder-test',
    fixture: 'frontend-app',
    category: 'testing',
    prompt:
      'Add src/hooks/smoke.test.ts exporting nothing but a Vitest it("hooks smoke") that expects 1+1 to be 2.',
    rationale: 'Hooks folder test without importing buggy hook behavior.',
    preconditions: [{ type: 'file_not_exists', path: 'src/hooks/smoke.test.ts' }],
    checks: [
      ...baseAgent,
      { type: 'workspace_changed' },
      gradeCommand('--exists src/hooks/smoke.test.ts', '--contains \'src/hooks/smoke.test.ts::hooks smoke\''),
      { type: 'command', command: 'npm test -- src/hooks/smoke.test.ts', timeoutMs: 120000 },
    ],
  }),
];

function writeJsonl(fileName, rows) {
  const path = join(casesDir, fileName);
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  return rows.length;
}

mkdirSync(casesDir, { recursive: true });
for (const legacy of ['easy.jsonl', 'medium.jsonl', 'hard.jsonl']) {
  const path = join(casesDir, legacy);
  if (existsSync(path)) rmSync(path);
}

const counts = {
  feature: writeJsonl('feature.jsonl', features),
  bugfix: writeJsonl('bugfix.jsonl', bugfixes),
  docs: writeJsonl('docs.jsonl', docsCases),
  retrieval: writeJsonl('retrieval.jsonl', retrievalCases),
  testing: writeJsonl('testing.jsonl', testingCases),
};

const all = [...features, ...bugfixes, ...docsCases, ...retrievalCases, ...testingCases];
const byDiff = { easy: 0, medium: 0, hard: 0 };
for (const item of all) byDiff[item.difficulty] += 1;

const suite = {
  id: 'frontend',
  name: 'Frontend Agent Benchmark',
  description:
    'Agent-only frontend core: 20 feature, 20 bugfix, 10 docs, 10 retrieval, 10 testing. Graded with __bench__/grade.mjs and build/test commands.',
  caseFiles: ['feature.jsonl', 'bugfix.jsonl', 'docs.jsonl', 'retrieval.jsonl', 'testing.jsonl'],
  expectedCounts: {
    easy: byDiff.easy,
    medium: byDiff.medium,
    hard: byDiff.hard,
    total: all.length,
  },
  gates: {
    easy: 0.85,
    medium: 0.8,
    hard: 0.7,
    overall: 0.8,
  },
};

writeFileSync(join(root, 'suites/frontend/suite.json'), `${JSON.stringify(suite, null, 2)}\n`);

console.log('Wrote frontend core cases:', counts);
console.log('Difficulty counts:', byDiff);
console.log('Total:', all.length);
