import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { basename, join, relative, resolve } from 'path';

export interface DocumentationSiteProfile {
  /** Workspace-relative package root (e.g. apps/docs, docs, packages/website). */
  packageRoot: string;
  packageName?: string;
  framework: 'docusaurus' | 'unknown';
  configPaths: string[];
  suggestedVerifyCommands: string[];
  installHint: string;
}

const DOC_CONFIG_NAMES = [
  'docusaurus.config.ts',
  'docusaurus.config.js',
  'docusaurus.config.mjs',
];

const SKIP_DIRS = new Set(['node_modules', '.git', '.mitii', 'dist', 'build', 'coverage', '.next', '.docusaurus']);

/** Discover documentation site packages under a workspace root. */
export function discoverDocumentationSites(workspace: string): DocumentationSiteProfile[] {
  const root = resolve(workspace);
  const sites: DocumentationSiteProfile[] = [];
  const seen = new Set<string>();

  for (const packageDir of collectPackageDirs(root, 3)) {
    const rel = workspaceRelative(root, packageDir);
    if (!rel || seen.has(rel)) continue;

    const pkg = readPackageJson(packageDir);
    const configPaths = DOC_CONFIG_NAMES
      .map((name) => join(packageDir, name))
      .filter((path) => existsSync(path))
      .map((path) => workspaceRelative(root, path));

    const deps = {
      ...asRecord(pkg?.dependencies),
      ...asRecord(pkg?.devDependencies),
    };
    const hasDocusaurus =
      configPaths.length > 0 ||
      'docusaurus' in deps ||
      '@docusaurus/core' in deps;

    if (!hasDocusaurus && !looksLikeDocsPackage(pkg, rel)) continue;

    seen.add(rel);
    const pm = detectPackageManager(root);
    sites.push({
      packageRoot: rel,
      packageName: typeof pkg?.name === 'string' ? pkg.name : undefined,
      framework: hasDocusaurus ? 'docusaurus' : 'unknown',
      configPaths,
      suggestedVerifyCommands: buildVerifyCommands(root, packageDir, pm),
      installHint: `${pm.installCommand} (from workspace root)`,
    });
  }

  return sites.sort((a, b) => a.packageRoot.localeCompare(b.packageRoot));
}

/** Suggest docs verification commands discovered from the workspace layout. */
export function suggestDocsVerifyCommands(workspace: string): string[] {
  const sites = discoverDocumentationSites(workspace);
  if (sites.length > 0) {
    const nestedSites = sites.filter((site) => site.packageRoot !== '.');
    const preferredSites = nestedSites.length > 0 ? nestedSites : sites;
    return [...new Set(preferredSites.flatMap((site) => site.suggestedVerifyCommands))];
  }

  const pm = detectPackageManager(resolve(workspace));
  return [
    `${pm.runPrefix} build`,
    `${pm.runPrefix} docs:build`,
  ];
}

export function resolveDocsSiteForFile(
  workspace: string,
  relativeFile: string
): DocumentationSiteProfile | undefined {
  const sites = discoverDocumentationSites(workspace);
  if (sites.length === 0) return undefined;

  const normalized = relativeFile.replace(/\\/g, '/');
  const direct = sites.find((site) => normalized.startsWith(`${site.packageRoot}/`) || normalized === site.packageRoot);
  if (direct) return direct;

  if (/(?:^|\/)docs(?:\/|$)/.test(normalized)) {
    return sites.find((site) => /(?:^|\/)docs(?:\/|$)/.test(site.packageRoot)) ?? sites[0];
  }

  return sites[0];
}

export function buildMdxRepairPromptGuidance(workspace?: string): string {
  const site = workspace ? discoverDocumentationSites(workspace)[0] : undefined;
  const docsPackage = site?.packageRoot ?? 'the docs package';
  const verifyExample = site?.suggestedVerifyCommands[0] ?? 'the docs build script from that package\'s package.json';
  const installHint = site?.installHint ?? 'install from the workspace root';

  return `
MDX / DOCUSAURUS BUILD REPAIRS:
- If the build output names an MDX/Markdown file, fix that exact file first.
- Before editing, read_file a working sibling doc in the same folder that already uses LiveCodeBlock successfully.
- If the error says "Unexpected character \`,\` in name" or "expected a name character", inspect Markdown table cells for raw TypeScript generics.
- Escape or code-span TypeScript generics in Markdown tables. Raw Record<string, any> is invalid MDX table text; use \`Record<string, any>\`. For function types, code-span the whole cell, e.g. \`(values: Record<string, any>) => void\`.
- If the error says "Could not parse expression with acorn" on a LiveCodeBlock line, fix the JSX attribute expression:
  - Correct: \`<LiveCodeBlock code={\` ... \`} componentName="Foo" />\`
  - Wrong: \`code={\` on one line and the opening backtick on the next line.
  - Wrong: closing the template with \`\` then jumping straight to componentName without \`}\`.
  - Wrong: putting \`render(<Foo />)\` inside the code string — live-demo adds render automatically.
- If the build says "Can't resolve 'package-name'", check ${docsPackage}/package.json for workspace:* deps, confirm the package exists under packages/, run ${installHint}, and build that package if dist/ is missing. This is part of the same failure — do NOT dismiss it as unrelated.
- MDX imports must be top-level: move component imports near the frontmatter/top of the file and remove duplicate imports inside the body.
- Before verify, read package.json scripts — do NOT assume npm run lint exists. Prefer: ${verifyExample}.
- After each edit, rerun the docs build. If it fails, fix only the next exact file from the build output.`;
}

export function buildMdxRepairGuidanceLines(workspace?: string): string[] {
  const site = workspace ? discoverDocumentationSites(workspace)[0] : undefined;
  const docsPackage = site?.packageRoot ?? 'the docs package';
  const verifyExample = site?.suggestedVerifyCommands[0] ?? 'the documented docs build script from package.json';

  return [
    'Follow the MDX repair loop:',
    '1. Read the exact MDX file named by the error.',
    '2. Read a working sibling doc in the same folder that already uses LiveCodeBlock successfully.',
    '3. For "Unexpected character `,` in name", code-span raw TypeScript generics in Markdown table cells.',
    '4. For "Could not parse expression with acorn", fix LiveCodeBlock syntax: use `code={` + backtick on the same line, close with `` `} ``, and do not include render() in the code string.',
    `5. For "Can't resolve", check workspace deps in ${docsPackage}/package.json and run ${site?.installHint ?? 'the workspace package manager install from the repo root'}.`,
    `6. Run the docs build (read package.json scripts first — do not assume npm run lint exists). Prefer: ${verifyExample}.`,
    '7. If the build fails, fix only the next exact file from the build output.',
  ];
}

export function buildMdxRepairBootstrapBlock(errorFile?: string, workspace?: string): string {
  const site = workspace ? resolveDocsSiteForFile(workspace, errorFile ?? '') ?? discoverDocumentationSites(workspace)[0] : undefined;
  const fileLine = errorFile
    ? `Target file from build output: **${errorFile}**`
    : 'Read the exact file path from the build error output first.';
  const docsPackage = site?.packageRoot ?? 'the docs package';
  const verifyExample = site?.suggestedVerifyCommands[0] ?? 'the docs build script from that package\'s package.json';

  return `## MANDATORY MDX REPAIR BOOTSTRAP (first tool round)

${fileLine}

Follow this order — do NOT guess fixes without reading the file and a working sibling example:

1. **read_file** the exact failing .md/.mdx file named in the build output.
2. **read_file** a sibling doc in the same folder that already uses LiveCodeBlock successfully.
3. Fix only what the build names:
   - **Unexpected character \`,\` in name** → raw TypeScript generics in Markdown table cells. Code-span the whole cell type: \`Record<string, any>\`, \`(values: Record<string, any>) => void\`.
   - **Could not parse expression with acorn** inside LiveCodeBlock → broken JSX attribute. Use \`code={\`\` on one line, close with \`\`}\` before componentName. Never split \`code={\` and the opening backtick across lines. Do NOT put \`render(<Component />)\` inside the code string — live-demo wrappers add render automatically.
   - **Can't resolve '@site/...' or another local component** → run **search** for every import of the missing module and nearby sibling module names. Do NOT rename, move, or overwrite a shared component until you know all existing imports. Prefer adding the missing compatibility file or updating only the failing import.
   - **Can't resolve 'pkg'** → check ${docsPackage}/package.json for \`workspace:*\` deps, confirm the package exists, run ${site?.installHint ?? 'install from the workspace root'}, and build that package if dist/ is missing. This is part of the same docs build failure — do NOT dismiss it as pre-existing.
4. **run_command** the docs build (read package.json scripts first; do NOT assume \`npm run lint\` exists). Prefer \`${verifyExample}\`.
5. If the build fails again, fix only the next exact file from the new build output.`;
}

function looksLikeDocsPackage(pkg: Record<string, unknown> | undefined, rel: string): boolean {
  if (!pkg) return false;
  const name = typeof pkg.name === 'string' ? pkg.name.toLowerCase() : '';
  return /(?:^|\/)docs(?:\/|$)/.test(rel) || name.includes('docs') || name.includes('website');
}

function buildVerifyCommands(workspaceRoot: string, packageDir: string, pm: PackageManagerHints): string[] {
  const pkg = readPackageJson(packageDir);
  const scripts = asRecord(pkg?.scripts);
  const rel = workspaceRelative(workspaceRoot, packageDir);
  const prefix = rel && rel !== '.' ? `cd ${rel} && ` : '';
  const commands: string[] = [];

  for (const script of ['build', 'docs:build', 'docs-build', 'docusaurus:build']) {
    if (typeof scripts[script] === 'string') {
      commands.push(`${prefix}${pm.runCommand} ${script}`);
    }
  }

  if (pm.kind === 'pnpm' && typeof pkg?.name === 'string' && typeof scripts.build === 'string') {
    commands.push(`pnpm --filter ${pkg.name} build`);
  }

  return [...new Set(commands)];
}

interface PackageManagerHints {
  kind: 'pnpm' | 'yarn' | 'npm' | 'bun';
  installCommand: string;
  runPrefix: string;
  runCommand: string;
}

function detectPackageManager(workspace: string): PackageManagerHints {
  if (existsSync(join(workspace, 'pnpm-lock.yaml'))) {
    return { kind: 'pnpm', installCommand: 'pnpm install', runPrefix: 'pnpm run ', runCommand: 'pnpm run' };
  }
  if (existsSync(join(workspace, 'yarn.lock'))) {
    return { kind: 'yarn', installCommand: 'yarn install', runPrefix: 'yarn run ', runCommand: 'yarn run' };
  }
  if (existsSync(join(workspace, 'bun.lockb')) || existsSync(join(workspace, 'bun.lock'))) {
    return { kind: 'bun', installCommand: 'bun install', runPrefix: 'bun run ', runCommand: 'bun run' };
  }
  return { kind: 'npm', installCommand: 'npm install', runPrefix: 'npm run ', runCommand: 'npm run' };
}

function collectPackageDirs(root: string, maxDepth: number): string[] {
  const dirs: string[] = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (existsSync(join(current.path, 'package.json'))) dirs.push(current.path);
    if (current.depth >= maxDepth) continue;
    for (const child of safeReadDirs(current.path)) {
      if (!SKIP_DIRS.has(basename(child))) {
        queue.push({ path: child, depth: current.depth + 1 });
      }
    }
  }
  return dirs;
}

function safeReadDirs(dir: string): string[] {
  try {
    return readdirSync(dir)
      .map((entry) => join(dir, entry))
      .filter((entry) => {
        try {
          return statSync(entry).isDirectory();
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

function readPackageJson(dir: string): Record<string, unknown> | undefined {
  try {
    const path = join(dir, 'package.json');
    if (!existsSync(path)) return undefined;
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function workspaceRelative(workspace: string, absolutePath: string): string {
  const rel = relative(workspace, absolutePath).replace(/\\/g, '/');
  return rel.startsWith('..') ? '' : rel || '.';
}

const GENERIC_DOCS_CONTEXT_TERMS = [
  'docusaurus.config.ts',
  'sidebars.ts',
  'sidebars.js',
  'package.json',
  'src/index.ts',
  'src/types/index.ts',
  'src/fields/index.ts',
  'exports',
  'docs plugin',
  'navbar',
  'routeBasePath',
  'sidebarPath',
  'docsPluginId',
  'installation',
  'configuration',
  'examples',
];

/** Workspace-aware path hints for documentation-related context retrieval. */
export function buildDocumentationContextHints(workspace?: string): string {
  const hints = new Set<string>(GENERIC_DOCS_CONTEXT_TERMS);
  if (!workspace) return [...hints].join(' ');

  const root = resolve(workspace);
  for (const site of discoverDocumentationSites(workspace)) {
    for (const configPath of site.configPaths) hints.add(configPath);
    const packageDir = join(root, site.packageRoot);
    for (const sidebar of findSidebarConfigPaths(packageDir, root)) hints.add(sidebar);
    for (const indexPath of findDocIndexPaths(packageDir, root, 40)) hints.add(indexPath);
  }

  return [...hints].join(' ');
}

function findSidebarConfigPaths(packageDir: string, workspaceRoot: string): string[] {
  const paths: string[] = [];
  for (const entry of safeReadDirNames(packageDir)) {
    if (/^sidebars(?:[A-Za-z0-9_-]*)?\.(?:ts|js|mjs|cjs)$/i.test(entry)) {
      const rel = workspaceRelative(workspaceRoot, join(packageDir, entry));
      if (rel) paths.push(rel);
    }
  }
  return paths;
}

function findDocIndexPaths(packageDir: string, workspaceRoot: string, limit: number): string[] {
  const docsRoots = ['docs', 'src/pages', 'website/docs']
    .map((segment) => join(packageDir, segment))
    .filter((dir) => existsSync(dir));
  const paths: string[] = [];
  for (const docsRoot of docsRoots) {
    collectIndexMarkdownPaths(docsRoot, workspaceRoot, paths, limit);
    if (paths.length >= limit) break;
  }
  return paths.slice(0, limit);
}

function collectIndexMarkdownPaths(
  dir: string,
  workspaceRoot: string,
  out: string[],
  limit: number,
  depth = 0
): void {
  if (out.length >= limit || depth > 4) return;
  for (const entry of safeReadDirNames(dir)) {
    if (out.length >= limit) return;
    const abs = join(dir, entry);
    let stat;
    try {
      stat = statSync(abs);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      collectIndexMarkdownPaths(abs, workspaceRoot, out, limit, depth + 1);
      continue;
    }
    if (!/^(?:index|README)\.(?:md|mdx)$/i.test(entry)) continue;
    const rel = workspaceRelative(workspaceRoot, abs);
    if (rel) out.push(rel);
  }
}

function safeReadDirNames(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
