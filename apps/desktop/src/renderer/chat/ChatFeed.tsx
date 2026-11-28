/** Scrolling chat feed: hero, messages and streaming activity. */

import { composerModeColor } from '@mitii/ui-react';
import { type DesktopAgentMode } from '../../shared/protocol.js';
import { type CSSProperties } from 'react';
import { ActivityTimeline } from './ActivityTimeline.js';
import { mcpAppsFromActivity, McpAppCard } from '../mcp/McpAppCard.js';
import { MarkdownBody } from './MarkdownBody.js';
import type { AppModel } from '../app/useAppModel.js';

export function ChatFeed({ m }: { m: AppModel }) {
  const {
    feedRef,
    messages,
    setLayout,
    setWorkspaceSide,
    setOpenPathRequest,
    feedEndRef,
  } = m;

  return (
    <div className="feed" ref={feedRef}>
      {messages.length === 0 ? (
        <div className="hero">
          <h1>Mitii</h1>
          <p>Ask · Plan · Agent — local-first coding agent.</p>
        </div>
      ) : (
        messages.map((msg) => (
            <div
              key={msg.id}
              className={`turn turn--${msg.role} turn--mode-${msg.mode ?? 'ask'}`}
              style={
                msg.role === 'assistant'
                  ? ({
                      '--turn-accent': composerModeColor(
                        (msg.mode as DesktopAgentMode) || 'ask',
                      ),
                    } as CSSProperties)
                  : undefined
              }
            >
              <div className="turn__role">
                {msg.role === 'user' ? 'You' : 'Mitii'}
              </div>
              {msg.role === 'assistant' ? (
                <>
                  <ActivityTimeline
                    items={(msg.activity ?? []).filter(
                      (item) => item.kind !== 'mcp_app',
                    )}
                    streaming={Boolean(msg.streaming)}
                    endAt={
                      msg.streaming
                        ? undefined
                        : (msg.activity ?? [])
                            .filter((item) => item.kind !== 'thinking')
                            .at(-1)?.at
                    }
                  />
                  {mcpAppsFromActivity(msg.activity).map((app, index) => (
                    <McpAppCard
                      key={`${app.title}-${app.paths.svg ?? app.paths.md ?? index}`}
                      app={app}
                      onOpenPath={(path) => {
                        setLayout('code');
                        setWorkspaceSide('explorer');
                        setOpenPathRequest({ path, view: 'file' });
                      }}
                    />
                  ))}
                  {msg.text ? (
                    <MarkdownBody
                      text={msg.text}
                      streaming={Boolean(msg.streaming)}
                      onOpenFile={(path) => {
                        setLayout('code');
                        setWorkspaceSide('explorer');
                        setOpenPathRequest({ path, view: 'file' });
                      }}
                    />
                  ) : null}
                </>
              ) : (
                <div className="turn__user">{msg.text}</div>
              )}
            </div>
          ))
      )}
      <div ref={feedEndRef} className="feed-end" aria-hidden />
    </div>
  );
}
