#!/usr/bin/env node
/**
 * DEPRECATED: the frontend suite is now the 70-case agent core.
 * Use: node scripts/write-frontend-core.mjs
 *
 * This script previously generated the large fe-001… / easy-medium-hard suite.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

console.error(
  'generate-frontend-cases.mjs is retired. Use: node scripts/write-frontend-core.mjs'
);
process.exit(1);

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FIXTURE = 'frontend-app';
const BUILD = { type: 'command', command: 'npm run build', timeoutMs: 180000 };
const TYPECHECK = { type: 'command', command: 'npm run typecheck', timeoutMs: 120000 };
const TEST = { type: 'command', command: 'npm test', timeoutMs: 180000 };

function difficultyForNum(num) {
  if (num <= 10) return 'easy';
  if (num <= 70) return 'medium';
  return 'hard';
}

function domainForCase({ num, category, slug }) {
  if (category === 'testing-quality' || slug.includes('vitest') || slug.includes('coverage')) return 'testing';
  if (slug.includes('github-actions') || category === 'cicd') return 'cicd';
  return 'frontend';
}

function baseAgent() {
  return [
    { type: 'agent_exit', equals: 0 },
    { type: 'output_not_empty' },
    { type: 'jsonl_event', event: 'end' },
    { type: 'workspace_changed' },
  ];
}

function caseDef({
  num,
  slug,
  category,
  difficulty,
  prompt,
  rationale,
  preconditions = [{ type: 'file_exists', path: 'package.json' }],
  files = [],
  contains = [],
  commands = [BUILD],
  extra = [],
}) {
  const suite = domainForCase({ num, category, slug });
  const resolvedDifficulty = difficulty ?? difficultyForNum(num);
  const id = `fe-${String(num).padStart(3, '0')}-${slug}-v1`;
  const checks = [
    ...baseAgent(),
    ...files.map((path) => ({ type: 'file_exists', path })),
    ...contains.map(({ path, value }) => ({ type: 'file_contains', path, value })),
    ...extra,
    ...commands,
  ];
  return {
    id,
    familyId: `fe-${slug}`,
    variant: 1,
    suite,
    category,
    difficulty: resolvedDifficulty,
    mode: 'agent',
    capability: 'feature',
    fixture: FIXTURE,
    prompt,
    rationale,
    timeoutMs: 600000,
    preconditions,
    checks,
  };
}

const cases = [
  caseDef({
    num: 1,
    slug: 'init-vite-structure',
    category: 'project-setup',
    difficulty: 'easy',
    prompt:
      'Ensure this Vite + React + TypeScript project has a correct frontend structure: src/main.tsx entry, App.tsx, components folder, package.json scripts for dev/build/test, and a README with project instructions. Fix anything missing.',
    rationale: 'Depth: structure, package scripts, build, README.',
    files: ['src/main.tsx', 'src/App.tsx', 'src/components', 'README.md'],
    contains: [
      { path: 'package.json', value: '"dev"' },
      { path: 'package.json', value: '"build"' },
      { path: 'README.md', value: 'Mitii' },
    ],
    commands: [BUILD],
  }),
  caseDef({
    num: 2,
    slug: 'eslint-prettier',
    category: 'project-setup',
    prompt:
      'Configure ESLint and Prettier for this TypeScript React project. Add eslint.config.js (or .eslintrc.*) and .prettierrc, wire npm run lint and format:check to real tools, and ensure lint passes on the current source.',
    rationale: 'Depth: config files, lint script, lint command.',
    files: ['.prettierrc'],
    contains: [{ path: 'package.json', value: 'eslint' }],
    extra: [{ type: 'output_contains_any', values: ['eslint', 'prettier', 'lint'] }],
    commands: [{ type: 'command', command: 'npm run lint', timeoutMs: 180000 }, BUILD],
  }),
  caseDef({
    num: 3,
    slug: 'typescript-strict',
    category: 'project-setup',
    difficulty: 'easy',
    prompt:
      'Harden TypeScript: ensure tsconfig.json enables strict mode, all app sources are .ts/.tsx, path alias @/* works if configured, and npm run typecheck exits 0.',
    rationale: 'Depth: tsconfig, tsc --noEmit.',
    contains: [
      { path: 'tsconfig.json', value: '"strict": true' },
      { path: 'tsconfig.json', value: '"jsx"' },
    ],
    commands: [TYPECHECK, BUILD],
  }),
  caseDef({
    num: 4,
    slug: 'env-variables',
    category: 'project-setup',
    difficulty: 'easy',
    prompt:
      'Set up environment variables for Vite: create .env.example with VITE_API_URL, ensure .env is gitignored, and demonstrate reading import.meta.env.VITE_API_URL from a small src/config.ts module used by the app.',
    rationale: 'Depth: env files, gitignore, config module, build.',
    files: ['.env.example', 'src/config.ts'],
    contains: [
      { path: '.env.example', value: 'VITE_API_URL' },
      { path: '.gitignore', value: '.env' },
      { path: 'src/config.ts', value: 'import.meta.env' },
    ],
  }),
  caseDef({
    num: 5,
    slug: 'react-router',
    category: 'project-setup',
    prompt:
      'Add react-router-dom with BrowserRouter, at least Home (/) and About (/about) routes, and a NotFound route for unknown paths. Deep links must be defined as real route components under src/.',
    rationale: 'Depth: dependency, router wiring, routes, build.',
    contains: [
      { path: 'package.json', value: 'react-router-dom' },
      { path: 'src/App.tsx', value: 'BrowserRouter' },
      { path: 'src/App.tsx', value: '/about' },
    ],
    files: ['src/pages/About.tsx'],
  }),
  caseDef({
    num: 6,
    slug: 'tailwind-css',
    category: 'project-setup',
    prompt:
      'Configure Tailwind CSS for Vite. Add tailwind.config.js, postcss config, import Tailwind layers in CSS, and apply at least one utility class in App.tsx. Production build must succeed.',
    rationale: 'Depth: Tailwind install/config, utility usage, build.',
    files: ['tailwind.config.js'],
    contains: [
      { path: 'package.json', value: 'tailwindcss' },
      { path: 'src/index.css', value: '@tailwind' },
      { path: 'src/App.tsx', value: 'className=' },
    ],
  }),
  caseDef({
    num: 7,
    slug: 'redux-toolkit',
    category: 'project-setup',
    prompt:
      'Set up Redux Toolkit: create src/store.ts with a sample counter slice, wrap the app with Provider in main.tsx, and use the store from App.tsx.',
    rationale: 'Depth: RTK deps, store, Provider, build.',
    files: ['src/store.ts'],
    contains: [
      { path: 'package.json', value: '@reduxjs/toolkit' },
      { path: 'src/main.tsx', value: 'Provider' },
      { path: 'src/store.ts', value: 'configureStore' },
    ],
  }),
  caseDef({
    num: 8,
    slug: 'axios-client',
    category: 'project-setup',
    prompt:
      'Create an Axios API client in src/api/client.ts with a baseURL from import.meta.env.VITE_API_URL (fallback http://localhost:3000), and add a response error interceptor. Export the client for reuse.',
    rationale: 'Depth: axios dep, client module, interceptor, build.',
    files: ['src/api/client.ts'],
    contains: [
      { path: 'package.json', value: 'axios' },
      { path: 'src/api/client.ts', value: 'axios.create' },
      { path: 'src/api/client.ts', value: 'interceptors' },
    ],
  }),
  caseDef({
    num: 9,
    slug: 'vitest-rtl-setup',
    category: 'project-setup',
    prompt:
      'Set up Vitest + React Testing Library. Add a working Button unit test under src/components/Button.test.tsx that renders without crashing, and ensure npm test passes.',
    rationale: 'Depth: test deps/scripts, sample test, npm test.',
    files: ['src/components/Button.test.tsx'],
    contains: [
      { path: 'package.json', value: 'vitest' },
      { path: 'src/components/Button.test.tsx', value: 'Button' },
    ],
    commands: [TEST, BUILD],
  }),
  caseDef({
    num: 10,
    slug: 'github-actions-ci',
    category: 'project-setup',
    prompt:
      'Add a GitHub Actions workflow at .github/workflows/ci.yml that installs dependencies, runs lint/typecheck/test/build on pull requests.',
    rationale: 'Depth: workflow file content for install/test/build.',
    files: ['.github/workflows/ci.yml'],
    contains: [
      { path: '.github/workflows/ci.yml', value: 'npm' },
      { path: '.github/workflows/ci.yml', value: 'build' },
    ],
  }),
  caseDef({
    num: 11,
    slug: 'login-page-ui',
    category: 'authentication',
    prompt:
      'Implement a Login page UI at src/pages/Login.tsx with email and password fields (password masked), client-side validation for empty/invalid email, optional show-password toggle, and error message display. Route /login to it.',
    rationale: 'Depth: form fields, validation, password type, build.',
    files: ['src/pages/Login.tsx'],
    contains: [
      { path: 'src/pages/Login.tsx', value: 'type="password"' },
      { path: 'src/pages/Login.tsx', value: 'email' },
    ],
  }),
  caseDef({
    num: 12,
    slug: 'signup-form',
    category: 'authentication',
    prompt:
      'Implement Signup at src/pages/Signup.tsx with email, password, confirm password, password-strength checks, terms checkbox, and submission handler that validates mismatches.',
    rationale: 'Depth: fields, strength/confirm validation, build.',
    files: ['src/pages/Signup.tsx'],
    contains: [
      { path: 'src/pages/Signup.tsx', value: 'confirm' },
      { path: 'src/pages/Signup.tsx', value: 'terms' },
    ],
  }),
  caseDef({
    num: 13,
    slug: 'jwt-storage',
    category: 'authentication',
    prompt:
      'Implement JWT token helpers in src/auth/token.ts: store/read/clear token in localStorage, attach Authorization Bearer header helper, and protect a /dashboard route that redirects to /login when missing token.',
    rationale: 'Depth: token module, protected route, build.',
    files: ['src/auth/token.ts'],
    contains: [
      { path: 'src/auth/token.ts', value: 'localStorage' },
      { path: 'src/auth/token.ts', value: 'Bearer' },
    ],
  }),
  caseDef({
    num: 14,
    slug: 'password-reset-flow',
    category: 'authentication',
    prompt:
      'Add Forgot Password and Reset Password pages under src/pages/ with email submit, token query handling, and new password validation messaging.',
    rationale: 'Depth: forgot/reset pages, validation messaging, build.',
    files: ['src/pages/ForgotPassword.tsx', 'src/pages/ResetPassword.tsx'],
    contains: [{ path: 'src/pages/ForgotPassword.tsx', value: 'email' }],
  }),
  caseDef({
    num: 15,
    slug: 'oauth-buttons',
    category: 'authentication',
    prompt:
      'Add OAuth login UI with Google and GitHub buttons on Login page (or src/components/OAuthButtons.tsx). Buttons must link/redirect to /auth/google and /auth/github callback placeholders and handle a denied query param error state.',
    rationale: 'Depth: OAuth UI + callback error handling (no live provider).',
    files: ['src/components/OAuthButtons.tsx'],
    contains: [
      { path: 'src/components/OAuthButtons.tsx', value: 'Google' },
      { path: 'src/components/OAuthButtons.tsx', value: 'GitHub' },
    ],
  }),
  caseDef({
    num: 16,
    slug: 'rbac',
    category: 'authentication',
    prompt:
      'Implement role-based access: define roles in src/auth/roles.ts, hide an AdminPanel component for non-admin users, and guard /admin so non-admins are blocked in the UI layer.',
    rationale: 'Depth: roles module, gated UI, build.',
    files: ['src/auth/roles.ts', 'src/components/AdminPanel.tsx'],
    contains: [
      { path: 'src/auth/roles.ts', value: 'admin' },
      { path: 'src/components/AdminPanel.tsx', value: 'role' },
    ],
  }),
  caseDef({
    num: 17,
    slug: 'session-timeout',
    category: 'authentication',
    prompt:
      'Implement idle session timeout in src/auth/sessionTimeout.ts with configurable timeout, warning callback, and logout callback. Wire a simple demo usage in App or a hook.',
    rationale: 'Depth: idle timer module + wiring, build.',
    files: ['src/auth/sessionTimeout.ts'],
    contains: [
      { path: 'src/auth/sessionTimeout.ts', value: 'setTimeout' },
      { path: 'src/auth/sessionTimeout.ts', value: 'logout' },
    ],
  }),
  caseDef({
    num: 18,
    slug: 'captcha-form',
    category: 'authentication',
    prompt:
      'Add a CAPTCHA placeholder widget component src/components/Captcha.tsx that must be completed before a Contact form can submit. Block submit when captcha token missing.',
    rationale: 'Depth: captcha component + gated form submit.',
    files: ['src/components/Captcha.tsx'],
    contains: [
      { path: 'src/components/Captcha.tsx', value: 'captcha' },
    ],
  }),
  caseDef({
    num: 19,
    slug: 'two-factor-setup',
    category: 'authentication',
    prompt:
      'Implement 2FA setup UI in src/pages/TwoFactorSetup.tsx with enable toggle, OTP input, backup codes list, and QR placeholder image/box.',
    rationale: 'Depth: 2FA UI elements, build.',
    files: ['src/pages/TwoFactorSetup.tsx'],
    contains: [
      { path: 'src/pages/TwoFactorSetup.tsx', value: 'OTP' },
      { path: 'src/pages/TwoFactorSetup.tsx', value: 'backup' },
    ],
  }),
  caseDef({
    num: 20,
    slug: 'secure-api-keys',
    category: 'authentication',
    difficulty: 'easy',
    prompt:
      'Audit and secure client config: ensure no hardcoded API secrets in src/, use VITE_ public env only in src/config.ts, and document in README that secrets must not ship to the browser.',
    rationale: 'Depth: env usage, README guidance, build.',
    files: ['src/config.ts'],
    contains: [
      { path: 'src/config.ts', value: 'import.meta.env' },
      { path: 'README.md', value: 'secret' },
    ],
    extra: [{ type: 'file_not_contains', path: 'src/config.ts', value: 'sk_live' }],
  }),
  // UI components 21-40
  ...uiComponents(),
  // Data 41-50
  ...dataFetching(),
  // Forms 51-60
  ...forms(),
  // Performance 61-70
  ...performance(),
  // A11y 71-80
  ...a11y(),
  // Responsive 81-90
  ...responsive(),
  // State 91-95
  ...stateMgmt(),
  // Testing 96-100
  ...testingQuality(),
];

function uiComponents() {
  const defs = [
    [21, 'responsive-navbar', 'Create src/components/Navbar.tsx with desktop links, mobile hamburger toggle, active link styling, and aria attributes. Include it in App.'],
    [22, 'modal-dialog', 'Create accessible Modal in src/components/Modal.tsx: open/close, ESC, overlay click, aria-modal, role=dialog, focus trap basics.'],
    [23, 'toast-system', 'Create ToastProvider + useToast in src/components/toast/ with success/error/info types, auto-dismiss, and manual dismiss.'],
    [24, 'dropdown-select', 'Build Dropdown/Select in src/components/Dropdown.tsx with keyboard support (arrow/enter/escape) and outside click close.'],
    [25, 'table-sort-pagination', 'Build DataTable in src/components/DataTable.tsx with sorting and pagination controls over sample rows.'],
    [26, 'form-validation', 'Create ValidatedForm in src/components/ValidatedForm.tsx with required/email validation, inline errors, submit + reset.'],
    [27, 'carousel-slider', 'Create Carousel in src/components/Carousel.tsx with next/prev, dots, and optional autoplay prop.'],
    [28, 'tabs-component', 'Create Tabs in src/components/Tabs.tsx with keyboard arrow navigation and aria-selected.'],
    [29, 'accordion', 'Create Accordion in src/components/Accordion.tsx with expand/collapse and optional single-open mode.'],
    [30, 'tooltip', 'Create Tooltip in src/components/Tooltip.tsx showing on hover/focus with positioning prop.'],
    [31, 'progress-bar', 'Create ProgressBar in src/components/ProgressBar.tsx supporting percent, variants, and aria-valuenow.'],
    [32, 'breadcrumb', 'Create Breadcrumb in src/components/Breadcrumb.tsx with items, last non-clickable, separators.'],
    [33, 'spinner-skeleton', 'Create Spinner and Skeleton components under src/components/loading/ with size variants.'],
    [34, 'date-picker', 'Create DatePicker in src/components/DatePicker.tsx with calendar UI, min/max props, and selected date state.'],
    [35, 'search-autocomplete', 'Create SearchAutocomplete in src/components/SearchAutocomplete.tsx with debounce and keyboard selection.'],
    [36, 'file-upload', 'Create FileUpload in src/components/FileUpload.tsx with drag-drop, type/size validation, and preview for images.'],
    [37, 'star-rating', 'Create StarRating in src/components/StarRating.tsx with hover, click, readOnly, and keyboard support.'],
    [38, 'stepper-wizard', 'Create Stepper in src/components/Stepper.tsx with ordered steps, next/back, and validation gate between steps.'],
    [39, 'avatar', 'Create Avatar in src/components/Avatar.tsx with image, initials fallback, sizes, and broken-image fallback.'],
    [40, 'badge-chip', 'Create Badge/Chip in src/components/Badge.tsx with variants, dismissible chip, and 99+ max count display.'],
  ];
  return defs.map(([num, slug, prompt]) =>
    caseDef({
      num,
      slug,
      category: 'ui-components',
      difficulty: num <= 25 ? 'medium' : 'medium',
      prompt: `${prompt} Keep TypeScript types exported. npm run build must pass.`,
      rationale: `UI component scenario ${num} with file + build verification.`,
      files: guessPrimaryFile(slug, num),
      contains: guessContains(slug, num),
    })
  );
}

function guessPrimaryFile(slug, num) {
  const map = {
    'responsive-navbar': ['src/components/Navbar.tsx'],
    'modal-dialog': ['src/components/Modal.tsx'],
    'toast-system': ['src/components/toast/ToastProvider.tsx'],
    'dropdown-select': ['src/components/Dropdown.tsx'],
    'table-sort-pagination': ['src/components/DataTable.tsx'],
    'form-validation': ['src/components/ValidatedForm.tsx'],
    'carousel-slider': ['src/components/Carousel.tsx'],
    'tabs-component': ['src/components/Tabs.tsx'],
    accordion: ['src/components/Accordion.tsx'],
    tooltip: ['src/components/Tooltip.tsx'],
    'progress-bar': ['src/components/ProgressBar.tsx'],
    breadcrumb: ['src/components/Breadcrumb.tsx'],
    'spinner-skeleton': ['src/components/loading/Spinner.tsx', 'src/components/loading/Skeleton.tsx'],
    'date-picker': ['src/components/DatePicker.tsx'],
    'search-autocomplete': ['src/components/SearchAutocomplete.tsx'],
    'file-upload': ['src/components/FileUpload.tsx'],
    'star-rating': ['src/components/StarRating.tsx'],
    'stepper-wizard': ['src/components/Stepper.tsx'],
    avatar: ['src/components/Avatar.tsx'],
    'badge-chip': ['src/components/Badge.tsx'],
  };
  return map[slug] ?? [`src/components/Component${num}.tsx`];
}

function guessContains(slug) {
  const map = {
    'responsive-navbar': [{ path: 'src/components/Navbar.tsx', value: 'aria-' }],
    'modal-dialog': [{ path: 'src/components/Modal.tsx', value: 'aria-modal' }],
    'toast-system': [{ path: 'src/components/toast/ToastProvider.tsx', value: 'success' }],
    'dropdown-select': [{ path: 'src/components/Dropdown.tsx', value: 'onKeyDown' }],
    'table-sort-pagination': [{ path: 'src/components/DataTable.tsx', value: 'sort' }],
    'form-validation': [{ path: 'src/components/ValidatedForm.tsx', value: 'error' }],
    'carousel-slider': [{ path: 'src/components/Carousel.tsx', value: 'next' }],
    'tabs-component': [{ path: 'src/components/Tabs.tsx', value: 'aria-selected' }],
    accordion: [{ path: 'src/components/Accordion.tsx', value: 'expanded' }],
    tooltip: [{ path: 'src/components/Tooltip.tsx', value: 'role' }],
    'progress-bar': [{ path: 'src/components/ProgressBar.tsx', value: 'aria-valuenow' }],
    breadcrumb: [{ path: 'src/components/Breadcrumb.tsx', value: 'nav' }],
    'spinner-skeleton': [{ path: 'src/components/loading/Spinner.tsx', value: 'Spinner' }],
    'date-picker': [{ path: 'src/components/DatePicker.tsx', value: 'Date' }],
    'search-autocomplete': [{ path: 'src/components/SearchAutocomplete.tsx', value: 'debounce' }],
    'file-upload': [{ path: 'src/components/FileUpload.tsx', value: 'drag' }],
    'star-rating': [{ path: 'src/components/StarRating.tsx', value: 'rating' }],
    'stepper-wizard': [{ path: 'src/components/Stepper.tsx', value: 'step' }],
    avatar: [{ path: 'src/components/Avatar.tsx', value: 'alt' }],
    'badge-chip': [{ path: 'src/components/Badge.tsx', value: '99' }],
  };
  return map[slug] ?? [];
}

function dataFetching() {
  return [
    caseDef({
      num: 41,
      slug: 'fetch-display-rest',
      category: 'data-fetching',
      prompt:
        'Create src/hooks/useUsers.ts and src/pages/UsersPage.tsx that fetch a list from a mockable URL, showing loading, error (with retry), empty, and success states.',
      files: ['src/hooks/useUsers.ts', 'src/pages/UsersPage.tsx'],
      contains: [
        { path: 'src/pages/UsersPage.tsx', value: 'loading' },
        { path: 'src/pages/UsersPage.tsx', value: 'error' },
      ],
    }),
    caseDef({
      num: 42,
      slug: 'infinite-scroll',
      category: 'data-fetching',
      prompt:
        'Implement infinite scroll list in src/components/InfiniteList.tsx that loads more on scroll near bottom, shows a bottom spinner, and an end message.',
      files: ['src/components/InfiniteList.tsx'],
      contains: [{ path: 'src/components/InfiniteList.tsx', value: 'scroll' }],
    }),
    caseDef({
      num: 43,
      slug: 'crud-ui',
      category: 'data-fetching',
      prompt:
        'Build a CRUD UI module under src/features/items/ with list, create form, edit, delete confirmation, and success/error notifications hooks or components.',
      files: ['src/features/items/ItemsPage.tsx'],
      contains: [
        { path: 'src/features/items/ItemsPage.tsx', value: 'delete' },
        { path: 'src/features/items/ItemsPage.tsx', value: 'create' },
      ],
    }),
    caseDef({
      num: 44,
      slug: 'react-query-cache',
      category: 'data-fetching',
      prompt:
        'Integrate TanStack React Query: QueryClientProvider in main.tsx, a useItemsQuery hook with staleTime, and a mutation that invalidates the items query.',
      files: ['src/hooks/useItemsQuery.ts'],
      contains: [
        { path: 'package.json', value: '@tanstack/react-query' },
        { path: 'src/main.tsx', value: 'QueryClientProvider' },
      ],
    }),
    caseDef({
      num: 45,
      slug: 'websocket-updates',
      category: 'data-fetching',
      prompt:
        'Implement useWebSocket hook in src/hooks/useWebSocket.ts with connect, message handler, reconnect backoff, and connection status string for the UI.',
      files: ['src/hooks/useWebSocket.ts'],
      contains: [
        { path: 'src/hooks/useWebSocket.ts', value: 'WebSocket' },
        { path: 'src/hooks/useWebSocket.ts', value: 'reconnect' },
      ],
    }),
    caseDef({
      num: 46,
      slug: 'file-download',
      category: 'data-fetching',
      prompt:
        'Create downloadFile helper in src/utils/download.ts supporting blob download with filename, plus a DownloadButton component that triggers it.',
      files: ['src/utils/download.ts', 'src/components/DownloadButton.tsx'],
      contains: [{ path: 'src/utils/download.ts', value: 'blob' }],
    }),
    caseDef({
      num: 47,
      slug: 'api-search-filter',
      category: 'data-fetching',
      prompt:
        'Create SearchFilterPage that debounces search input, calls a search function, updates URL query params, and shows loading/empty states.',
      files: ['src/pages/SearchFilterPage.tsx'],
      contains: [
        { path: 'src/pages/SearchFilterPage.tsx', value: 'debounce' },
        { path: 'src/pages/SearchFilterPage.tsx', value: 'searchParams' },
      ],
    }),
    caseDef({
      num: 48,
      slug: 'api-pagination',
      category: 'data-fetching',
      prompt:
        'Create PaginatedList in src/components/PaginatedList.tsx with page/size controls, total count display, and loading state between pages.',
      files: ['src/components/PaginatedList.tsx'],
      contains: [
        { path: 'src/components/PaginatedList.tsx', value: 'page' },
        { path: 'src/components/PaginatedList.tsx', value: 'total' },
      ],
    }),
    caseDef({
      num: 49,
      slug: 'rate-limit-handling',
      category: 'data-fetching',
      prompt:
        'Add rate-limit handling in src/api/rateLimit.ts: detect 429, exponential backoff retry helper, and user-facing message exporter.',
      files: ['src/api/rateLimit.ts'],
      contains: [
        { path: 'src/api/rateLimit.ts', value: '429' },
        { path: 'src/api/rateLimit.ts', value: 'backoff' },
      ],
    }),
    caseDef({
      num: 50,
      slug: 'graphql-client',
      category: 'data-fetching',
      prompt:
        'Add a minimal GraphQL client helper in src/api/graphql.ts (fetch-based is fine) supporting query variables and GraphQL error parsing. Include one example query module.',
      files: ['src/api/graphql.ts'],
      contains: [
        { path: 'src/api/graphql.ts', value: 'query' },
        { path: 'src/api/graphql.ts', value: 'errors' },
      ],
    }),
  ];
}

function forms() {
  return [
    caseDef({
      num: 51,
      slug: 'multi-step-form',
      category: 'forms',
      prompt: 'Build MultiStepForm in src/components/MultiStepForm.tsx with progress indicator, per-step validation, and persisted step data.',
      files: ['src/components/MultiStepForm.tsx'],
      contains: [{ path: 'src/components/MultiStepForm.tsx', value: 'step' }],
    }),
    caseDef({
      num: 52,
      slug: 'dynamic-fields',
      category: 'forms',
      prompt: 'Build DynamicFieldsForm allowing add/remove fields with max limit and validation for each dynamic field.',
      files: ['src/components/DynamicFieldsForm.tsx'],
      contains: [{ path: 'src/components/DynamicFieldsForm.tsx', value: 'add' }],
    }),
    caseDef({
      num: 53,
      slug: 'search-filter-panel',
      category: 'forms',
      prompt: 'Create FilterPanel with multiple filters, clear-all, active count badge, and URL-synced filter state.',
      files: ['src/components/FilterPanel.tsx'],
      contains: [{ path: 'src/components/FilterPanel.tsx', value: 'clear' }],
    }),
    caseDef({
      num: 54,
      slug: 'inline-edit',
      category: 'forms',
      prompt: 'Create InlineEdit field component with display/edit modes, save/cancel, Enter/Escape shortcuts, and validation.',
      files: ['src/components/InlineEdit.tsx'],
      contains: [{ path: 'src/components/InlineEdit.tsx', value: 'Escape' }],
    }),
    caseDef({
      num: 55,
      slug: 'drag-drop-list',
      category: 'forms',
      prompt: 'Create SortableList with HTML5 drag-and-drop reorder and persist order to localStorage.',
      files: ['src/components/SortableList.tsx'],
      contains: [
        { path: 'src/components/SortableList.tsx', value: 'drag' },
        { path: 'src/components/SortableList.tsx', value: 'localStorage' },
      ],
    }),
    caseDef({
      num: 56,
      slug: 'rich-text-editor',
      category: 'forms',
      prompt: 'Create a lightweight RichTextEditor with bold/italic/list toolbar using contentEditable or textarea markdown toggles; export getHTML/getMarkdown.',
      files: ['src/components/RichTextEditor.tsx'],
      contains: [{ path: 'src/components/RichTextEditor.tsx', value: 'bold' }],
    }),
    caseDef({
      num: 57,
      slug: 'checkbox-select-all',
      category: 'forms',
      prompt: 'Create CheckboxGroup with select-all, indeterminate state, and selected count display.',
      files: ['src/components/CheckboxGroup.tsx'],
      contains: [{ path: 'src/components/CheckboxGroup.tsx', value: 'indeterminate' }],
    }),
    caseDef({
      num: 58,
      slug: 'input-masking',
      category: 'forms',
      prompt: 'Create masked inputs helper/components for phone, credit-card, and date masks under src/components/masks/.',
      files: ['src/components/masks/PhoneInput.tsx'],
      contains: [{ path: 'src/components/masks/PhoneInput.tsx', value: 'mask' }],
    }),
    caseDef({
      num: 59,
      slug: 'survey-quiz',
      category: 'forms',
      prompt: 'Build SurveyForm supporting multiple question types (mcq/text/rating), required validation, and final result summary.',
      files: ['src/components/SurveyForm.tsx'],
      contains: [{ path: 'src/components/SurveyForm.tsx', value: 'question' }],
    }),
    caseDef({
      num: 60,
      slug: 'contact-form',
      category: 'forms',
      prompt: 'Create ContactForm that validates fields, calls an async sendEmail function prop, and shows success/error messages.',
      files: ['src/components/ContactForm.tsx'],
      contains: [
        { path: 'src/components/ContactForm.tsx', value: 'success' },
        { path: 'src/components/ContactForm.tsx', value: 'error' },
      ],
    }),
  ];
}

function performance() {
  return [
    caseDef({
      num: 61,
      slug: 'code-splitting',
      category: 'performance',
      prompt: 'Add React.lazy route-level code splitting for at least one page with a Suspense fallback spinner.',
      contains: [
        { path: 'src/App.tsx', value: 'lazy' },
        { path: 'src/App.tsx', value: 'Suspense' },
      ],
    }),
    caseDef({
      num: 62,
      slug: 'image-lazy-loading',
      category: 'performance',
      prompt: 'Create LazyImage component with loading=lazy, placeholder, and optional blur class while loading.',
      files: ['src/components/LazyImage.tsx'],
      contains: [{ path: 'src/components/LazyImage.tsx', value: 'loading="lazy"' }],
    }),
    caseDef({
      num: 63,
      slug: 'list-virtualization',
      category: 'performance',
      prompt: 'Implement a simple VirtualList in src/components/VirtualList.tsx that only renders visible window items for large arrays.',
      files: ['src/components/VirtualList.tsx'],
      contains: [{ path: 'src/components/VirtualList.tsx', value: 'scroll' }],
    }),
    caseDef({
      num: 64,
      slug: 'perf-monitoring',
      category: 'performance',
      prompt: 'Add src/perf/webVitals.ts that records FCP/LCP/CLS via PerformanceObserver or web-vitals-style stubs and logs/sends metrics.',
      files: ['src/perf/webVitals.ts'],
      contains: [{ path: 'src/perf/webVitals.ts', value: 'PerformanceObserver' }],
    }),
    caseDef({
      num: 65,
      slug: 'bundle-size-notes',
      category: 'performance',
      prompt:
        'Optimize imports for tree-shaking where obvious, ensure production build is minified via Vite defaults, and add docs/bundle-notes.md describing before/after approach.',
      files: ['docs/bundle-notes.md'],
      contains: [{ path: 'docs/bundle-notes.md', value: 'bundle' }],
    }),
    caseDef({
      num: 66,
      slug: 'pwa-manifest',
      category: 'performance',
      prompt: 'Add a PWA manifest.json and a service-worker.js skeleton that caches the app shell; register the SW from main.tsx.',
      files: ['public/manifest.json', 'public/service-worker.js'],
      contains: [
        { path: 'src/main.tsx', value: 'serviceWorker' },
        { path: 'public/manifest.json', value: 'name' },
      ],
    }),
    caseDef({
      num: 67,
      slug: 'optimize-api-calls',
      category: 'performance',
      prompt: 'Create src/api/optimize.ts helpers for debounce, throttle, and AbortController cancellation of in-flight requests.',
      files: ['src/api/optimize.ts'],
      contains: [
        { path: 'src/api/optimize.ts', value: 'AbortController' },
        { path: 'src/api/optimize.ts', value: 'debounce' },
      ],
    }),
    caseDef({
      num: 68,
      slug: 'memoization',
      category: 'performance',
      prompt: 'Refactor Button or a new ExpensiveList to use React.memo, useMemo, and useCallback appropriately without breaking updates. Document in a short comment why.',
      contains: [{ path: 'src/components/Button.tsx', value: 'memo' }],
      files: [],
      extra: [{ type: 'file_contains', path: 'src/components/Button.tsx', value: 'memo' }],
    }),
    caseDef({
      num: 69,
      slug: 'css-modules',
      category: 'performance',
      prompt: 'Convert Button styles to CSS Modules (Button.module.css) and ensure class names are applied from the module import.',
      files: ['src/components/Button.module.css'],
      contains: [{ path: 'src/components/Button.tsx', value: 'Button.module.css' }],
    }),
    caseDef({
      num: 70,
      slug: 'web-worker',
      category: 'performance',
      prompt: 'Add a Web Worker src/workers/heavy.worker.ts (or .js) and a wrapper that offloads a CPU-bound task; use it from a demo component.',
      files: ['src/workers/heavy.worker.ts'],
      contains: [{ path: 'src/workers/heavy.worker.ts', value: 'onmessage' }],
    }),
  ];
}

function a11y() {
  return [
    caseDef({
      num: 71,
      slug: 'aria-labels',
      category: 'accessibility',
      difficulty: 'easy',
      prompt: 'Add proper aria-labels/landmarks to App and Navbar/main content: nav, main, and labeled buttons/inputs.',
      contains: [
        { path: 'src/App.tsx', value: 'main' },
        { path: 'src/App.tsx', value: 'aria-' },
      ],
    }),
    caseDef({
      num: 72,
      slug: 'keyboard-navigation',
      category: 'accessibility',
      prompt: 'Add SkipToContent link and ensure focus-visible styles exist in CSS; document keyboard shortcuts in README.',
      contains: [
        { path: 'src/App.tsx', value: 'Skip' },
        { path: 'src/index.css', value: 'focus-visible' },
      ],
    }),
    caseDef({
      num: 73,
      slug: 'color-contrast',
      category: 'accessibility',
      prompt: 'Adjust CSS colors to WCAG AA contrast for text/buttons and document contrast choices in docs/a11y-contrast.md.',
      files: ['docs/a11y-contrast.md'],
      contains: [{ path: 'docs/a11y-contrast.md', value: 'WCAG' }],
    }),
    caseDef({
      num: 74,
      slug: 'focus-management',
      category: 'accessibility',
      prompt: 'Implement focus restore helpers in src/a11y/focus.ts used by Modal (or create Modal if missing) for open/close focus management.',
      files: ['src/a11y/focus.ts'],
      contains: [{ path: 'src/a11y/focus.ts', value: 'focus' }],
    }),
    caseDef({
      num: 75,
      slug: 'image-alt-text',
      category: 'accessibility',
      difficulty: 'easy',
      prompt: 'Create SafeImage component requiring alt text (empty alt allowed only when decorative flag is true).',
      files: ['src/components/SafeImage.tsx'],
      contains: [{ path: 'src/components/SafeImage.tsx', value: 'alt' }],
    }),
    caseDef({
      num: 76,
      slug: 'accessible-forms',
      category: 'accessibility',
      prompt: 'Upgrade ValidatedForm or create AccessibleForm with label associations, required indicators, and aria-describedby error messages.',
      files: ['src/components/AccessibleForm.tsx'],
      contains: [
        { path: 'src/components/AccessibleForm.tsx', value: 'aria-describedby' },
        { path: 'src/components/AccessibleForm.tsx', value: 'label' },
      ],
    }),
    caseDef({
      num: 77,
      slug: 'screen-reader-live',
      category: 'accessibility',
      prompt: 'Add an aria-live polite announcer utility/component src/a11y/LiveRegion.tsx for dynamic status messages.',
      files: ['src/a11y/LiveRegion.tsx'],
      contains: [{ path: 'src/a11y/LiveRegion.tsx', value: 'aria-live' }],
    }),
    caseDef({
      num: 78,
      slug: 'touch-targets',
      category: 'accessibility',
      prompt: 'Ensure interactive controls meet ~44px touch targets via CSS utility and apply to Button.',
      contains: [
        { path: 'src/index.css', value: '44px' },
        { path: 'src/components/Button.tsx', value: 'btn' },
      ],
    }),
    caseDef({
      num: 79,
      slug: 'reduced-motion',
      category: 'accessibility',
      prompt: 'Add prefers-reduced-motion media query in CSS that disables non-essential animations/transitions.',
      contains: [{ path: 'src/index.css', value: 'prefers-reduced-motion' }],
    }),
    caseDef({
      num: 80,
      slug: 'accessible-menu',
      category: 'accessibility',
      prompt: 'Create AccessibleMenu with Enter/Space open, arrow navigation, Escape close, and aria roles menu/menuitem.',
      files: ['src/components/AccessibleMenu.tsx'],
      contains: [
        { path: 'src/components/AccessibleMenu.tsx', value: 'menuitem' },
        { path: 'src/components/AccessibleMenu.tsx', value: 'Escape' },
      ],
    }),
  ];
}

function responsive() {
  return [
    caseDef({
      num: 81,
      slug: 'responsive-grid',
      category: 'responsive',
      prompt: 'Create ResponsiveGrid layout component/CSS with desktop/tablet/mobile breakpoints stacking columns on small screens.',
      files: ['src/components/ResponsiveGrid.tsx'],
      contains: [{ path: 'src/index.css', value: '@media' }],
    }),
    caseDef({
      num: 82,
      slug: 'mobile-first',
      category: 'responsive',
      prompt: 'Refactor base CSS to mobile-first min-width media queries and document breakpoints in docs/breakpoints.md.',
      files: ['docs/breakpoints.md'],
      contains: [
        { path: 'docs/breakpoints.md', value: '768' },
        { path: 'src/index.css', value: 'min-width' },
      ],
    }),
    caseDef({
      num: 83,
      slug: 'responsive-images',
      category: 'responsive',
      prompt: 'Create ResponsivePicture component using srcset/sizes or picture element for art direction.',
      files: ['src/components/ResponsivePicture.tsx'],
      contains: [{ path: 'src/components/ResponsivePicture.tsx', value: 'srcSet' }],
    }),
    caseDef({
      num: 84,
      slug: 'responsive-nav',
      category: 'responsive',
      prompt: 'Ensure Navbar supports desktop links + mobile off-canvas/hamburger drawer that closes on navigate.',
      files: ['src/components/Navbar.tsx'],
      contains: [{ path: 'src/components/Navbar.tsx', value: 'hamburger' }],
    }),
    caseDef({
      num: 85,
      slug: 'responsive-typography',
      category: 'responsive',
      prompt: 'Implement fluid typography with clamp() for headings and ensure form inputs use at least 16px font-size.',
      contains: [
        { path: 'src/index.css', value: 'clamp(' },
        { path: 'src/index.css', value: '16px' },
      ],
    }),
    caseDef({
      num: 86,
      slug: 'responsive-table',
      category: 'responsive',
      prompt: 'Make DataTable responsive: horizontal scroll on small screens and/or card layout alternative class.',
      files: ['src/components/DataTable.tsx'],
      contains: [{ path: 'src/components/DataTable.tsx', value: 'overflow' }],
    }),
    caseDef({
      num: 87,
      slug: 'responsive-forms',
      category: 'responsive',
      prompt: 'Create responsive form layout styles (single column on mobile) applied by ContactForm or AccessibleForm.',
      contains: [{ path: 'src/index.css', value: 'form' }],
    }),
    caseDef({
      num: 88,
      slug: 'responsive-modal',
      category: 'responsive',
      prompt: 'Update Modal to go near-fullscreen on mobile widths with safe padding and reachable close button.',
      files: ['src/components/Modal.tsx'],
      contains: [{ path: 'src/components/Modal.tsx', value: 'max-width' }],
    }),
    caseDef({
      num: 89,
      slug: 'responsive-dashboard',
      category: 'responsive',
      prompt: 'Create DashboardLayout with collapsible sidebar and responsive widget grid under src/layouts/DashboardLayout.tsx.',
      files: ['src/layouts/DashboardLayout.tsx'],
      contains: [{ path: 'src/layouts/DashboardLayout.tsx', value: 'sidebar' }],
    }),
    caseDef({
      num: 90,
      slug: 'cross-browser-notes',
      category: 'responsive',
      difficulty: 'easy',
      prompt:
        'Add docs/browsers.md listing supported browsers (Chrome/Firefox/Safari/Edge + mobile) and any polyfill notes; keep build green.',
      files: ['docs/browsers.md'],
      contains: [{ path: 'docs/browsers.md', value: 'Chrome' }],
    }),
  ];
}

function stateMgmt() {
  return [
    caseDef({
      num: 91,
      slug: 'context-api',
      category: 'state-management',
      prompt: 'Implement AppContext with provider/hook in src/state/AppContext.tsx and consume it in App without unnecessary re-render pitfalls (split state/dispatch if needed).',
      files: ['src/state/AppContext.tsx'],
      contains: [
        { path: 'src/state/AppContext.tsx', value: 'createContext' },
        { path: 'src/main.tsx', value: 'AppProvider' },
      ],
    }),
    caseDef({
      num: 92,
      slug: 'react-query-server-state',
      category: 'state-management',
      prompt: 'Demonstrate server state with React Query: list query + optimistic update mutation example in src/features/todos/.',
      files: ['src/features/todos/useTodos.ts'],
      contains: [
        { path: 'src/features/todos/useTodos.ts', value: 'useMutation' },
        { path: 'package.json', value: '@tanstack/react-query' },
      ],
    }),
    caseDef({
      num: 93,
      slug: 'undo-redo',
      category: 'state-management',
      prompt: 'Implement undo/redo history helper in src/state/history.ts with limit and Ctrl+Z / Ctrl+Y hook wiring.',
      files: ['src/state/history.ts'],
      contains: [
        { path: 'src/state/history.ts', value: 'undo' },
        { path: 'src/state/history.ts', value: 'redo' },
      ],
    }),
    caseDef({
      num: 94,
      slug: 'localstorage-sync',
      category: 'state-management',
      prompt: 'Create useLocalStorageState hook syncing JSON state to localStorage and listening to storage events for cross-tab sync.',
      files: ['src/hooks/useLocalStorageState.ts'],
      contains: [
        { path: 'src/hooks/useLocalStorageState.ts', value: 'localStorage' },
        { path: 'src/hooks/useLocalStorageState.ts', value: 'storage' },
      ],
    }),
    caseDef({
      num: 95,
      slug: 'redux-middleware',
      category: 'state-management',
      prompt: 'Add Redux store with custom logger middleware and an async thunk example in src/store/.',
      files: ['src/store/index.ts'],
      contains: [
        { path: 'src/store/index.ts', value: 'middleware' },
        { path: 'package.json', value: '@reduxjs/toolkit' },
      ],
    }),
  ];
}

function testingQuality() {
  return [
    caseDef({
      num: 96,
      slug: 'component-unit-tests',
      category: 'testing-quality',
      prompt: 'Write RTL unit tests for Button covering variants and click handler; npm test must pass.',
      files: ['src/components/Button.test.tsx'],
      contains: [{ path: 'src/components/Button.test.tsx', value: 'render' }],
      commands: [TEST, BUILD],
    }),
    caseDef({
      num: 97,
      slug: 'integration-tests',
      category: 'testing-quality',
      prompt: 'Add an integration test for Login form validation flow under src/pages/Login.test.tsx (create Login page if needed).',
      files: ['src/pages/Login.test.tsx'],
      contains: [{ path: 'src/pages/Login.test.tsx', value: 'validation' }],
      commands: [TEST, BUILD],
    }),
    caseDef({
      num: 98,
      slug: 'playwright-e2e-smoke',
      category: 'testing-quality',
      prompt:
        'Add Playwright config and a smoke e2e test that loads the app root. Include npm script test:e2e. (Test file may skip if browsers missing, but config and spec must exist.)',
      files: ['playwright.config.ts', 'e2e/smoke.spec.ts'],
      contains: [
        { path: 'package.json', value: 'test:e2e' },
        { path: 'e2e/smoke.spec.ts', value: 'test' },
      ],
    }),
    caseDef({
      num: 99,
      slug: 'visual-regression-setup',
      category: 'testing-quality',
      prompt:
        'Add a visual regression harness stub: docs/visual-regression.md plus e2e/visual.spec.ts that captures a screenshot of the home page with Playwright.',
      files: ['docs/visual-regression.md', 'e2e/visual.spec.ts'],
      contains: [{ path: 'e2e/visual.spec.ts', value: 'screenshot' }],
    }),
    caseDef({
      num: 100,
      slug: 'coverage-reporting',
      category: 'testing-quality',
      prompt:
        'Configure Vitest coverage (v8), add npm run test:coverage, set a thresholds block in vitest config, and ensure Button tests still pass.',
      contains: [
        { path: 'package.json', value: 'test:coverage' },
        { path: 'vite.config.ts', value: 'coverage' },
      ],
      commands: [TEST, BUILD],
    }),
  ];
}

// Ensure eslint case does not require a single config filename.
cases[1].checks = cases[1].checks.filter(
  (c) => !(c.type === 'file_exists' && String(c.path || '').includes('eslint.config'))
);

if (cases.length !== 100) {
  console.error(`Expected 100 cases, got ${cases.length}`);
  process.exit(1);
}

const DOMAINS = ['frontend', 'backend', 'cicd', 'testing'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const generatedIds = new Set(cases.map((c) => c.id));

for (const domain of DOMAINS) {
  const suiteDir = join(rootDir, 'suites', domain);
  const casesDir = join(suiteDir, 'cases');
  mkdirSync(casesDir, { recursive: true });
  const buckets = Object.fromEntries(DIFFICULTIES.map((d) => [d, []]));

  // Keep non-generated cases already in this domain.
  for (const difficulty of DIFFICULTIES) {
    const path = join(casesDir, `${difficulty}.jsonl`);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line);
      if (generatedIds.has(parsed.id)) continue;
      buckets[difficulty].push(parsed);
    }
  }

  // Add generated cases that belong here.
  for (const testCase of cases.filter((c) => c.suite === domain)) {
    buckets[testCase.difficulty].push(testCase);
  }

  const counts = {
    easy: buckets.easy.length,
    medium: buckets.medium.length,
    hard: buckets.hard.length,
  };
  const total = counts.easy + counts.medium + counts.hard;

  for (const difficulty of DIFFICULTIES) {
    const path = join(casesDir, `${difficulty}.jsonl`);
    const rows = buckets[difficulty];
    writeFileSync(path, rows.length ? `${rows.map((row) => JSON.stringify(row)).join('\n')}\n` : '');
    console.log(`${domain}/${difficulty}: ${rows.length}`);
  }

  const manifestPath = join(suiteDir, 'suite.json');
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8'))
    : { id: domain, name: domain, caseFiles: ['easy.jsonl', 'medium.jsonl', 'hard.jsonl'], gates: { easy: 0.9, medium: 0.8, hard: 0.7, overall: 0.8 } };
  manifest.expectedCounts = { ...counts, total };
  manifest.caseFiles = ['easy.jsonl', 'medium.jsonl', 'hard.jsonl'];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

console.log(`Merged ${cases.length} generated FE scenarios into domain difficulty files.`);
