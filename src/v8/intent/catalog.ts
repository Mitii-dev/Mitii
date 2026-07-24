import { IntentDefinition, TaskIntent } from "./types";

/**
 * Canonical definitions for top-level AI coding agent task routing.
 * Verified against standard SWE benchmark task classifications.
 */
export const INTENT_CATALOG = {
  bugfix: {
    id: 'bugfix',
    description:
      'Find and correct a concrete defect, failing test, build failure, regression, or broken behavior.',
    includes: [
      'Fixing incorrect runtime behavior or regressions',
      'Repairing compilation or build failures',
      'Fixing failing tests when expected behavior is known',
      'Diagnosing and implementing a fix in the same request',
    ],
    excludes: [
      'Adding behavior that did not previously exist',
      'Improving working code without correcting a defect',
      'Fixing security vulnerabilities (routes to security)',
    ],
    confusedWith: ['diagnose', 'test', 'feature', 'security'],
    examples: [
      'Find why the build is failing and fix it.',
      'The API crashes when the email field is missing. Resolve it.',
    ],
  },

  feature: {
    id: 'feature',
    description:
      'Implement a new user-visible or system capability that does not currently exist.',
    includes: [
      'Adding new application behavior',
      'Creating a new endpoint, command, or workflow',
      'Extending an existing capability with new requirements',
    ],
    excludes: [
      'Restoring behavior that is supposed to already work',
      'Restructuring code without changing behavior',
      'Creating boilerplate for a brand new project (routes to scaffold)',
    ],
    confusedWith: ['bugfix', 'refactor', 'scaffold'],
    examples: [
      'Add passwordless login using email links.',
      'Create an endpoint that exports reports as CSV.',
    ],
  },

  refactor: {
    id: 'refactor',
    description:
      'Restructure, rename, simplify, or reorganize code while preserving its intended external behavior.',
    includes: [
      'Extracting shared functions or components',
      'Moving code between files or modules',
      'Reducing duplication or cyclomatic complexity',
    ],
    excludes: [
      'Fixing a concrete broken behavior as the primary goal',
      'Improving performance when performance is the primary outcome',
      'Porting code to a new language (routes to migrate)',
    ],
    confusedWith: ['bugfix', 'feature', 'optimize', 'migrate'],
    examples: [
      'Extract the validation logic into a reusable module.',
      'Convert these classes to use dependency injection.',
    ],
  },

  optimize: {
    id: 'optimize',
    description:
      'Improve performance metrics such as execution speed, memory usage, bundle size, or network latency.',
    includes: [
      'Implementing caching or memoization',
      'Reducing Big O time or space complexity',
      'Lazy loading modules or code splitting',
      'Optimizing database queries for speed',
    ],
    excludes: [
      'Fixing a bug that causes a complete crash (routes to bugfix)',
      'Cleaning up messy code without performance gains (routes to refactor)',
    ],
    confusedWith: ['refactor', 'bugfix'],
    examples: [
      'Reduce the bundle size of this React application.',
      'Optimize this SQL query so it runs faster on large tables.',
    ],
  },

  diagnose: {
    id: 'diagnose',
    description:
      'Investigate and explain the root cause of a problem without an explicit request to modify the implementation.',
    includes: [
      'Finding why a build, test, or runtime operation fails',
      'Tracing unexpected application behavior',
      'Examining code to determine a specific failure cause',
    ],
    excludes: [
      'Implementing a fix as part of the same request',
      'General questions unrelated to a concrete problem',
      'Reading raw server logs (routes to trace)',
    ],
    confusedWith: ['bugfix', 'question', 'trace'],
    examples: [
      'Why does this request return a 500 response?',
      'Investigate why memory usage continues increasing, but do not change code.',
    ],
  },

  test: {
    id: 'test',
    description:
      'Create, update, improve, or run tests when validating behavior is the primary requested outcome.',
    includes: [
      'Adding unit, integration, or end-to-end tests',
      'Increasing meaningful test coverage',
      'Updating tests after an intentional behavior change',
    ],
    excludes: [
      'Fixing application code so existing tests pass (routes to bugfix)',
      'Generating mock data sets without testing assertions (routes to mock)',
    ],
    confusedWith: ['bugfix', 'diagnose', 'mock'],
    examples: [
      'Add unit tests for the intent classifier.',
      'Write integration tests covering the payment gateway.',
    ],
  },

  audit: {
    id: 'audit',
    description:
      'Systematically inspect code or repository state for quality, correctness, maintainability, or dead code.',
    includes: [
      'Finding unused dependencies, files, or dead code',
      'Producing prioritized findings and recommendations',
      'Inspecting architecture for risks or anti-patterns',
    ],
    excludes: [
      'Reviewing a specific PR diff (routes to review)',
      'Auditing for explicit security vulnerabilities (routes to security)',
    ],
    confusedWith: ['diagnose', 'review', 'security'],
    examples: [
      'Audit this package for dead code and unused exports.',
      'Analyze this module and list architectural maintainability issues.',
    ],
  },

  review: {
    id: 'review',
    description:
      'Critique a specific diff, patch, or pull request to provide human-like peer review feedback.',
    includes: [
      'Reviewing staged changes before a commit',
      'Finding logic errors or missing edge cases in a diff',
      'Generating pull request summaries based on changes',
    ],
    excludes: [
      'General static analysis of the whole repo (routes to audit)',
      'Automatically merging the PR',
    ],
    confusedWith: ['audit', 'docs', 'diagnose'],
    examples: [
      'Review these staged changes for any edge cases I missed.',
      'Generate a PR review summary for this patch file.',
    ],
  },

  security: {
    id: 'security',
    description:
      'Identify, exploit, or mitigate security vulnerabilities, CVEs, or insecure cryptographic practices.',
    includes: [
      'Sanitizing inputs to prevent XSS or SQL Injection',
      'Auditing authorization or authentication logic',
      'Updating dependencies specifically to patch CVEs',
    ],
    excludes: [
      'General bug fixes not related to an exploit (routes to bugfix)',
      'Configuring network firewalls (routes to config)',
    ],
    confusedWith: ['bugfix', 'audit', 'dependency'],
    examples: [
      'Ensure this input field is safe from SQL injection.',
      'Audit this JWT implementation for security flaws.',
    ],
  },

  trace: {
    id: 'trace',
    description:
      'Analyze structured application logs, agent traces, error stack traces, or session data to evaluate execution behavior.',
    includes: [
      'Parsing JSON/JSONL server or agent logs',
      'Reconstructing execution timelines from trace data',
      'Identifying where a system looped or failed based on logs',
    ],
    excludes: [
      'Reading source code to find a bug (routes to diagnose)',
      'Optimizing slow code (routes to optimize)',
    ],
    confusedWith: ['diagnose', 'audit'],
    examples: [
      'Analyze this JSONL application log and explain where the pipeline failed.',
      'Why did the AI agent consume so many tokens in this execution trace?',
    ],
  },

  scaffold: {
    id: 'scaffold',
    description:
      'Generate boilerplate code, folder structures, and initial setup for a new project, component, or service.',
    includes: [
      'Bootstrapping a new React component or API route',
      'Creating baseline file structures',
      'Writing foundational templates before business logic is added',
    ],
    excludes: [
      'Implementing deep business logic (routes to feature)',
      'Modifying existing complex components',
    ],
    confusedWith: ['feature', 'config'],
    examples: [
      'Scaffold a new Express router for a user profiles service.',
      'Generate the boilerplate for a Redux slice including actions and reducers.',
    ],
  },

  migrate: {
    id: 'migrate',
    description:
      'Port existing code across languages, frameworks, or major version updates.',
    includes: [
      'Converting JavaScript to TypeScript',
      'Porting a Python script to Go',
      'Upgrading code to support React 18/19 or Next.js App Router',
    ],
    excludes: [
      'Updating package.json without changing code (routes to dependency)',
      'Internal refactoring within the same paradigm (routes to refactor)',
    ],
    confusedWith: ['refactor', 'dependency', 'feature'],
    examples: [
      'Convert this React class component into a functional component with hooks.',
      'Migrate this Express API to use Fastify.',
    ],
  },

  schema: {
    id: 'schema',
    description:
      'Design, alter, or optimize database schemas, ORM models, or migration scripts.',
    includes: [
      'Writing SQL CREATE or ALTER statements',
      'Creating Prisma, Drizzle, or Mongoose models',
      'Generating database migration files',
    ],
    excludes: [
      'Optimizing a specific SQL query (routes to optimize)',
      'Writing application logic that consumes the DB (routes to feature)',
    ],
    confusedWith: ['scaffold', 'feature'],
    examples: [
      'Create a Prisma schema for a blog with Authors, Posts, and Comments.',
      'Write a SQL migration script to add a user_role column.',
    ],
  },

  mock: {
    id: 'mock',
    description:
      'Generate synthetic mock data, fixtures, or stub functions for testing or development.',
    includes: [
      'Creating JSON files populated with fake user data',
      'Writing database seed scripts',
      'Stubbing API responses for local development',
    ],
    excludes: [
      'Writing the actual unit test assertions (routes to test)',
      'Scaffolding the actual application code (routes to scaffold)',
    ],
    confusedWith: ['test', 'scaffold'],
    examples: [
      'Generate a JSON array of 50 realistic fake user profiles.',
      'Write a seed script to populate the products table with sample data.',
    ],
  },

  config: {
    id: 'config',
    description:
      'Manage CI/CD pipelines, Dockerfiles, environment variables, bundlers, and infrastructure as code.',
    includes: [
      'Writing GitHub Actions, GitLab CI, or Jenkins pipelines',
      'Configuring Webpack, Vite, or Babel',
      'Writing Terraform, Docker, or Kubernetes manifests',
    ],
    excludes: [
      'Managing package dependencies (routes to dependency)',
      'Writing application logic',
    ],
    confusedWith: ['dependency', 'scaffold'],
    examples: [
      'Create a Dockerfile and docker-compose setup for this Node app.',
      'Write a GitHub Action to run my tests on every PR.',
    ],
  },

  dependency: {
    id: 'dependency',
    description:
      'Manage package manager files, resolve version conflicts, or install new libraries.',
    includes: [
      'Updating packages in package.json, requirements.txt, or Cargo.toml',
      'Resolving peer dependency conflicts',
      'Switching between npm, yarn, and pnpm',
    ],
    excludes: [
      'Rewriting application code to match a new major version (routes to migrate)',
      'Configuring the build tool itself (routes to config)',
    ],
    confusedWith: ['config', 'migrate', 'security'],
    examples: [
      'Update all React-related packages to their latest versions.',
      'Resolve the peer dependency conflict preventing npm install from working.',
    ],
  },

  docs: {
    id: 'docs',
    description:
      'Create, correct, or update documentation, examples, comments, READMEs, or changelogs.',
    includes: [
      'Writing or updating README content and architecture docs',
      'Updating code comments, JSDoc, or docstrings',
      'Writing tutorials or API specifications (OpenAPI/Swagger)',
    ],
    excludes: [
      'Changing runtime behavior',
      'Explaining something only in the conversational response (routes to question)',
    ],
    confusedWith: ['question', 'feature'],
    examples: [
      'Update the README with local development setup instructions.',
      'Generate OpenAPI documentation for these Express routes.',
    ],
  },

  style: {
    id: 'style',
    description:
      'Implement or modify UI/UX designs, CSS styling, animations, or responsive layouts.',
    includes: [
      'Writing Tailwind CSS classes or styled-components',
      'Making a component responsive for mobile devices',
      'Creating CSS or Framer Motion animations',
    ],
    excludes: [
      'Adding core business logic or data fetching (routes to feature)',
      'Refactoring React state without visual changes (routes to refactor)',
    ],
    confusedWith: ['feature', 'format'],
    examples: [
      'Style this button to have a hover effect and dark mode support.',
      'Make this CSS Grid layout responsive on mobile screens.',
    ],
  },

  format: {
    id: 'format',
    description:
      'Apply linting rules, code formatting, or syntactic conventions without changing logic or architecture.',
    includes: [
      'Fixing Prettier or ESLint errors',
      'Converting single quotes to double quotes',
      'Reordering imports or sorting object keys',
    ],
    excludes: [
      'Extracting functions or deeply refactoring logic (routes to refactor)',
      'Changing UI styling (routes to style)',
    ],
    confusedWith: ['refactor', 'style', 'config'],
    examples: [
      'Fix all the ESLint warnings in this file.',
      'Format this code strictly according to the Prettier config.',
    ],
  },

  question: {
    id: 'question',
    description:
      'Answer, explain, compare, locate, or investigate information without modifying the workspace.',
    includes: [
      'Explaining how existing code works',
      'Comparing technologies or implementation approaches',
      'Locating files, symbols, or configuration',
    ],
    excludes: [
      'Fixing a concrete problem (routes to bugfix)',
      'Investigating a specific malfunction as the primary goal (routes to diagnose)',
    ],
    confusedWith: ['diagnose', 'docs', 'trace'],
    examples: [
      'How does the intent classifier work?',
      'Compare VPC peering with a transit gateway.',
    ],
  },
} as const satisfies Record<TaskIntent, IntentDefinition>;