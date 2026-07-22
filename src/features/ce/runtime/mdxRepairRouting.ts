/** Route MDX/Docusaurus build failures away from guess-and-check loops. */

import {
  buildMdxRepairBootstrapBlock as buildBootstrapFromProfile,
  suggestDocsVerifyCommands as suggestDocsFromProfile,
} from '../skills/documentationProfile';

const MDX_BUILD_FAILURE =
  /\b(mdx compilation failed|unexpected character|could not parse expression with acorn|micromark-extension-mdx)\b/i;

const DOCS_CONTEXT = /\b(mdx|docusaurus|livecodeblock)\b|\.mdx?\b/i;

const MODULE_RESOLUTION =
  /\b(can'?t resolve|module not found|error:\s*can'?t resolve)\b/i;

const COMPILED_WITH_PROBLEMS = /\bcompiled with problems\b/i;

/** True when the user pasted or described a Docusaurus/MDX build failure. */
export function isMdxRepairTask(text: string): boolean {
  if (MDX_BUILD_FAILURE.test(text) && DOCS_CONTEXT.test(text)) return true;
  if (COMPILED_WITH_PROBLEMS.test(text) && DOCS_CONTEXT.test(text)) return true;
  if (MDX_BUILD_FAILURE.test(text) && MODULE_RESOLUTION.test(text)) return true;
  return false;
}

/** Extract the failing MDX path from build output when present. */
export function extractMdxErrorFile(text: string): string | undefined {
  const mdxMatch = text.match(
    /(?:MDX compilation failed for file|Error in)\s+["']([^"']+\.mdx?)["']/i
  );
  if (mdxMatch?.[1]) return normalizeExtractedPath(mdxMatch[1]);

  const webpackMatch = text.match(/(?:\.\/)?(?:[\w.-]+\/)*docs\/[^\s:]+\.mdx?/i);
  if (webpackMatch?.[0]) return normalizeExtractedPath(webpackMatch[0]);

  const pathMatch = text.match(
    /(?:^|\s|['"`])((?:[\w.-]+\/)*docs\/[\w./-]+\.mdx?)\b/i
  );
  return pathMatch?.[1] ? normalizeExtractedPath(pathMatch[1]) : undefined;
}

/** Suggest docs verify commands from repository discovery (optional workspace root). */
export function suggestDocsVerifyCommands(workspace?: string): string[] {
  if (workspace) return suggestDocsFromProfile(workspace);
  return ['npm run build', 'npm run docs:build'];
}

/** Injected at session start for MDX/Docusaurus repair tasks in Agent mode. */
export function buildMdxRepairBootstrapBlock(errorFile?: string, workspace?: string): string {
  return buildBootstrapFromProfile(errorFile, workspace);
}

function normalizeExtractedPath(raw: string): string {
  return raw
    .replace(/^\/+/g, '')
    .replace(/^\.\//, '')
    .replace(/^.*?((?:apps\/)?docs\/[\w./-]+\.mdx?)$/i, '$1');
}
