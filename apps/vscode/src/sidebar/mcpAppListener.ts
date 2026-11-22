import { getSharedMcpManager } from '../mcp/manager.js';
import { persistExcalidrawFromToolResult } from '../excalidrawArtifacts.js';
import type { ActivityEventPayload } from '../protocol.js';
import type { SidebarContext } from './context.js';

/** Persist Excalidraw `create_view` results and surface them as MCP App cards. */
export function installMcpAppListener(ctx: SidebarContext): void {
  getSharedMcpManager().setToolResultListener(async (event) => {
    if (event.toolName !== 'create_view' || event.result.isError) {
      return;
    }
    const root = ctx.effectiveRoot();
    if (!root) return;

    const persisted = persistExcalidrawFromToolResult({
      workspaceRoot: root,
      event,
      threadId: ctx.session.activeThreadId,
    });
    if (!persisted) {
      ctx.channel.appendLine(
        '[mcp-app] create_view succeeded but no elements were available to persist',
      );
      return;
    }

    let html: string | undefined;
    if (event.resourceUri) {
      try {
        const resource = await getSharedMcpManager().readResource(
          event.serverId,
          event.resourceUri,
        );
        const first = resource.contents[0];
        if (first?.text) {
          html = first.text;
        } else if (first?.blob) {
          html = Buffer.from(first.blob, 'base64').toString('utf8');
        }
      } catch (error) {
        ctx.channel.appendLine(
          `[mcp-app] resources/read failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(
      persisted.svg,
      'utf8',
    ).toString('base64')}`;

    ctx.channel.appendLine(
      `[mcp-app] saved diagram → ${persisted.paths.relativeMd}${
        persisted.paths.relativeDocsMd
          ? ` + ${persisted.paths.relativeDocsMd}`
          : ''
      }`,
    );

    const activity: ActivityEventPayload = {
      id: `mcp-app-${Date.now()}`,
      at: Date.now(),
      kind: 'mcp_app',
      title: persisted.title,
      detail: `Saved ${persisted.paths.relativeMd}`,
      status: 'succeeded',
      mcpApp: {
        serverId: event.serverId,
        tool: event.toolName,
        title: persisted.title,
        ...(persisted.paths.checkpointId
          ? { checkpointId: persisted.paths.checkpointId }
          : {}),
        svgDataUrl,
        // Full AppBridge is not wired yet; keep HTML available for future
        // interactive host work but prefer SVG for a reliable visible diagram.
        ...(html ? { html } : {}),
        paths: {
          md: persisted.paths.relativeMd,
          ...(persisted.paths.relativeDocsMd
            ? { docsMd: persisted.paths.relativeDocsMd }
            : {}),
          excalidraw: persisted.paths.relativeExcalidraw,
          svg: persisted.paths.relativeSvg,
        },
      },
    };
    ctx.session.pendingMcpAppEvents.push(activity);
    ctx.post({ type: 'run.event', event: activity });
  });
}
