import {
  deriveLiveTokenBudgetPreview,
} from '@mitii/ui-core';

import type { ActivityEventPayload, PlanView } from '../protocol.js';
import { buildReviewDiff, buildReviewFileDiffs } from '../reviewDiff.js';
import { readTokenBudgetPolicyOverrides } from '../tokenBudgetSettings.js';
import { resolveContextWindow } from './configValues.js';
import type { SidebarContext } from './context.js';


/** Markdown carry block for MCP App / Excalidraw diagrams produced during a run. */
export function formatDiagramCarryMarkdown(
  events: ActivityEventPayload[],
): string {
  const blocks: string[] = [];
  for (const event of events) {
    const app = event.mcpApp;
    if (!app) continue;
    const title = app.title || 'Diagram';
    const svg = app.paths.svg;
    const md = app.paths.md;
    const docsMd = app.paths.docsMd;
    const excalidraw = app.paths.excalidraw;
    const lines = [`## ${title}`, ''];
    if (svg) {
      lines.push(`![${title}](${svg})`, '');
    }
    lines.push('Saved files:');
    if (md) lines.push(`- Markdown: \`${md}\``);
    if (docsMd) lines.push(`- Docs reference: \`${docsMd}\``);
    if (excalidraw) lines.push(`- Excalidraw: \`${excalidraw}\``);
    if (svg) lines.push(`- SVG: \`${svg}\``);
    lines.push(`- Latest pointer: \`.mitii/artifacts/excalidraw/LATEST.md\``);
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}


/** Companion markdown path for a saved plan JSON relative path. */
export function savedPlanMarkdownRelative(jsonRelativePath: string): string {
  return jsonRelativePath.replace(/\.json$/i, '.md');
}

/** Thorough code review of git working-tree changes (Code Review button). */
const REVIEW_CODE_HOST_PREFIX =
  'Perform a thorough code review of every selected file in the current git changes, including both staged and unstaged patches. Start by calling read_git_status with includeDiff=true. Assess correctness, readability, architecture, tests, and operational risk. You MUST call emit_review_finding at least once before finishing — once per high-signal issue with path, content, existingCode, severity, and category. If there are no material issues, emit a single low/info finding that says so. Prose-only analysis is not a valid review. Prefer high-signal findings over nits.';

/** Avoid stacking identical review instructions from UI + host. */
export function buildReviewLlmPrompt(userPrompt: string): string {
  const trimmed = userPrompt.trim();
  if (!trimmed) return REVIEW_CODE_HOST_PREFIX;
  if (
    trimmed.startsWith(
      'Perform a thorough code review of every selected file in the current git changes',
    )
  ) {
    return trimmed;
  }
  return `${REVIEW_CODE_HOST_PREFIX}\n\n${trimmed}`;
}

/**
 * Refresh the working-tree review diff in the webview and append SDK review
 * prep (selected files, risk hints) to the review prompt. Best-effort.
 */
export async function prepareReviewPrompt(
  ctx: SidebarContext,
  basePrompt: string,
): Promise<string> {
  let llmPrompt = basePrompt;
  const root = ctx.effectiveRoot();
  if (root) {
    const reviewBudget = deriveLiveTokenBudgetPreview({
      contextWindowTokens: resolveContextWindow(ctx.vs),
      policy: readTokenBudgetPolicyOverrides(
        ctx.vs.workspace.getConfiguration('mitii'),
      ),
    });
    const reviewLimits = {
      maxFileChars: reviewBudget.injectionReviewDiffFileChars,
      maxTotalChars: reviewBudget.injectionReviewDiffTotalChars,
      maxPatchPreviewChars: Math.min(
        4_000,
        reviewBudget.injectionReviewDiffFileChars,
      ),
    };
    const reviewDiff = await buildReviewDiff(root, reviewLimits);
    ctx.post({
      type: 'setReviewDiff',
      review: reviewDiff,
    });
    try {
      const { ReviewPipeline, formatReviewPrepForPrompt } = await import(
        '@mitii/sdk'
      );
      const files = await buildReviewFileDiffs(
        root,
        reviewDiff.files ?? [],
        reviewLimits,
      );
      const prep = new ReviewPipeline().prepare({
        schemaVersion: 1,
        mode: 'workspace',
        workspaceId: root,
        files,
      });
      if (prep.selectedCount > 0) {
        llmPrompt = `${llmPrompt}\n\n${formatReviewPrepForPrompt(prep)}`;
      }
    } catch {
      // Review prep is best-effort in the host UI.
    }
  }
  return llmPrompt;
}

export function planFromAnswer(
  mode: string | undefined,
  answer: string,
): PlanView | null {
  if (mode !== 'plan' || !answer.trim()) return null;
  const lines = answer
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*\d.]/.test(l))
    .slice(0, 12);
  if (!lines.length) {
    return {
      title: 'Plan',
      steps: [
        {
          id: 'step_1',
          title: 'See assistant reply for plan details',
          status: 'pending',
        },
      ],
    };
  }
  return {
    title: 'Plan',
    steps: lines.map((title, i) => ({
      id: `step_${i + 1}`,
      title: title.replace(/^[-*\d.)\s]+/, '').slice(0, 120),
      status: i === 0 ? 'active' : 'pending',
    })),
  };
}
