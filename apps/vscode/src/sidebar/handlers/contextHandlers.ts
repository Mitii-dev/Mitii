import { searchWorkspacePaths } from '../../pathSearch.js';
import { buildReviewDiff } from '../../reviewDiff.js';
import type { WebviewToHostMessage } from '../../protocol.js';
import type { SidebarContext } from '../context.js';

export async function handleCompleteOnboarding(
  ctx: SidebarContext,
): Promise<void> {
  await ctx.vs.workspace
    .getConfiguration('mitii')
    .update(
      'onboarding.completed',
      true,
      ctx.vs.ConfigurationTarget.Workspace,
    );
  ctx.post({ type: 'onboarding', required: false });
}

export async function handleToggleContextSource(
  ctx: SidebarContext,
  message: Extract<WebviewToHostMessage, { type: 'toggleContextSource' }>,
): Promise<void> {
  await ctx.vs.workspace
    .getConfiguration('mitii')
    .update(
      `ui.contextToggles.${message.source}`,
      message.enabled,
      ctx.vs.ConfigurationTarget.Workspace,
    );
  if (message.source === 'memory') {
    ctx.invalidateClient();
  }
  await ctx.sendBootstrap();
}

export async function handleRefreshReviewDiff(
  ctx: SidebarContext,
): Promise<void> {
  const root = ctx.effectiveRoot();
  if (!root) {
    ctx.post({
      type: 'setReviewDiff',
      review: { summary: 'No workspace', files: [] },
    });
    return;
  }
  ctx.post({
    type: 'setReviewDiff',
    review: await buildReviewDiff(root),
  });
}

export async function handlePickContextPath(
  ctx: SidebarContext,
): Promise<void> {
  const picked = await ctx.vs.window.showOpenDialog({
    canSelectMany: true,
    openLabel: 'Pin to Mitii context',
  });
  if (!picked?.length) return;
  const root = ctx.effectiveRoot();
  for (const uri of picked) {
    let rel = uri.fsPath;
    if (root && rel.startsWith(root)) {
      rel = rel.slice(root.length).replace(/^[\\/]/, '');
    }
    ctx.post({ type: 'editorPin', path: rel.replace(/\\/g, '/'), source: 'user' });
  }
}

export async function handleCopyLastResponse(
  ctx: SidebarContext,
): Promise<void> {
  if (ctx.session.lastAssistantText) {
    await ctx.vs.env.clipboard.writeText(ctx.session.lastAssistantText);
    void ctx.vs.window.showInformationMessage(
      'Mitii: Last response copied.',
    );
  }
}

export async function handleApproveAllPending(
  ctx: SidebarContext,
): Promise<void> {
  if (ctx.session.pendingResume) {
    // Webview should send explicit resume; this is a no-op hint
    void ctx.vs.window.showInformationMessage(
      'Use the approval card to approve or deny.',
    );
  }
}

export async function handlePathsSearch(
  ctx: SidebarContext,
  message: Extract<WebviewToHostMessage, { type: 'paths.search' }>,
): Promise<void> {
  const root = ctx.effectiveRoot();
  const suggestions = root
    ? await searchWorkspacePaths(root, message.query)
    : [];
  ctx.post({
    type: 'paths.results',
    requestId: message.requestId,
    suggestions,
  });
}
