/** Scrolling chat feed: hero, messages and streaming activity. */

import { modeAccent } from './ComposerControls.js';
import { type DesktopAgentMode } from '../../shared/protocol.js';
import { type CSSProperties } from 'react';
import { ActivityTimeline } from './ActivityTimeline.js';
import { mcpAppsFromActivity, McpAppCard } from '../mcp/McpAppCard.js';
import { MarkdownBody } from './MarkdownBody.js';
import { FileChangesCard } from './FileChangesCard.js';
import type { AppModel } from '../app/useAppModel.js';

export function ChatFeed({ m }: { m: AppModel }) {
  const {
    feedRef,
    messages,
    setLayout,
    setWorkspaceSide,
    setOpenPathRequest,
    chatLayout,
    setPinnedPaths,
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
        messages.map((m) => (
          <div
            key={m.id}
            className={`turn turn--${m.role} turn--mode-${m.mode ?? 'ask'}`}
            style={
              m.role === 'assistant'
                ? ({
                    '--turn-accent': modeAccent(
                      (m.mode as DesktopAgentMode) || 'ask',
                    ),
                  } as CSSProperties)
                : undefined
            }
          >
            <div className="turn__role">
              {m.role === 'user' ? 'You' : 'Mitii'}
            </div>
            {m.role === 'assistant' ? (
              <>
                <ActivityTimeline
                  items={(m.activity ?? []).filter(
                    (item) => item.kind !== 'mcp_app',
                  )}
                  streaming={Boolean(m.streaming)}
                  endAt={
                    m.streaming
                      ? undefined
                      : (m.activity ?? [])
                          .filter((item) => item.kind !== 'thinking')
                          .at(-1)?.at
                  }
                />
                {mcpAppsFromActivity(m.activity).map((app, index) => (
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
                {m.text ? (
                  <MarkdownBody
                    text={m.text}
                    streaming={Boolean(m.streaming)}
                    onOpenFile={(path) => {
                      setLayout('code');
                      setWorkspaceSide('explorer');
                      setOpenPathRequest({ path, view: 'file' });
                    }}
                  />
                ) : null}
                {chatLayout === 'chat' &&
                m.fileChanges &&
                m.fileChanges.files.length > 0 ? (
                  <FileChangesCard
                    changes={m.fileChanges}
                    onOpenFile={(path) => {
                      setLayout('code');
                      setWorkspaceSide('git');
                      setOpenPathRequest({ path, view: 'diff' });
                      setPinnedPaths((prev) =>
                        prev.includes(path)
                          ? prev
                          : [...prev, path].slice(0, 32),
                      );
                    }}
                  />
                ) : null}
              </>
            ) : (
              <div className="turn__user">{m.text}</div>
            )}
          </div>
        ))
      )}
      <div ref={feedEndRef} className="feed-end" aria-hidden />
    </div>
  );
}
