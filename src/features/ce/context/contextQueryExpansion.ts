import {
  buildDocumentationContextHints,
  discoverDocumentationSites,
} from '../skills/documentationProfile';

const DOCS_INTENT =
  /\b(docs?|documentation|docusaurus|mdx?|sidebar|navbar|routeBasePath|docsPluginId|installation|configuration|examples?)\b/i;

const BROAD_FEATURE_SCOPE =
  /\b(all|every|features?|components?|exports?|api|fields?|types?)\b/i;

const PACKAGE_LIKE_NAME = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/gi;

export function expandContextQuery(userMessage: string, workspace?: string): string {
  if (!DOCS_INTENT.test(userMessage) && !/\badd\b[\s\S]{0,80}\bfeatures?\b/i.test(userMessage)) {
    return userMessage;
  }

  const packageHints = extractPackageHints(userMessage, workspace);
  const scopeHints = BROAD_FEATURE_SCOPE.test(userMessage)
    ? 'all features all components all exports public API field types examples'
    : '';

  return [userMessage, buildDocumentationContextHints(workspace), packageHints, scopeHints]
    .filter(Boolean)
    .join('\n\nContext retrieval hints: ');
}

function extractPackageHints(text: string, workspace?: string): string {
  const names = [...new Set(text.match(PACKAGE_LIKE_NAME) ?? [])]
    .filter((name) => !['route-base', 'docs-plugin'].includes(name.toLowerCase()))
    .slice(0, 5);

  const docsRoots = workspace
    ? discoverDocumentationSites(workspace).map((site) => site.packageRoot)
    : [];
  const primaryDocsRoot = docsRoots[0] ?? 'docs';

  return names
    .flatMap((name) => [
      `packages/${name}/package.json`,
      `packages/${name}/src/index.ts`,
      `packages/${name}/src/types/index.ts`,
      `packages/${name}/src/fields/index.ts`,
      `packages/${name}/src/fields`,
      ...docsRoots.map((root) => `${root}/docs/${name}/index.md`),
      `${primaryDocsRoot}/docs/${name}/index.md`,
    ])
    .join(' ');
}
