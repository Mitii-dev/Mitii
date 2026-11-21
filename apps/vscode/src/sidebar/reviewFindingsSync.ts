import type { SidebarContext } from './context.js';

export function postReviewFindings(ctx: SidebarContext): void {
  ctx.post({
    type: 'setReviewFindings',
    findings: ctx.host.reviewFindings.getFindings().map((f) => ({
      path: f.path,
      content: f.content,
      startLine: f.startLine,
      endLine: f.endLine,
      severity: f.severity,
      category: f.category,
      existingCode: f.existingCode,
      suggestionCode: f.suggestionCode,
      status: f.status === 'fixed' ? 'fixed' : 'open',
    })),
  });
}

export function resolvePendingFixFindings(
  ctx: SidebarContext,
  status: string,
): void {
  if (ctx.session.pendingFixFindingKeys.length === 0) return;
  const keys = ctx.session.pendingFixFindingKeys;
  ctx.session.pendingFixFindingKeys = [];
  if (status !== 'completed') return;
  const marked = ctx.host.reviewFindings.markFixedByKeys(keys);
  if (marked > 0) {
    postReviewFindings(ctx);
  }
}
