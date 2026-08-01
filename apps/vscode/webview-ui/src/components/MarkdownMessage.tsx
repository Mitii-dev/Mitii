import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { inlineCodeAsFileRef, parseFileRef } from '../fileLinks';

interface MarkdownMessageProps {
  content: string;
  streaming?: boolean;
  onOpenFile?: (path: string, line?: number, column?: number) => void;
}

function createComponents(
  onOpenFile?: (path: string, line?: number, column?: number) => void,
): Components {
  return {
    code({ className, children, ...props }) {
      const text = String(children).replace(/\n$/, '');
      const language = /language-([\w+-]+)/.exec(className ?? '')?.[1];
      const isBlock = Boolean(language) || text.includes('\n');
      if (!isBlock) {
        const fileRef = onOpenFile ? inlineCodeAsFileRef(text) : null;
        if (fileRef) {
          return (
            <button
              type="button"
              className="md-file-link md-inline-code"
              title={`Open ${fileRef.path}`}
              onClick={() =>
                onOpenFile?.(fileRef.path, fileRef.line, fileRef.column)
              }
            >
              {text}
            </button>
          );
        }
        return (
          <code className="md-inline-code" {...props}>
            {children}
          </code>
        );
      }
      return (
        <pre className="md-code-block">
          {language ? <span className="md-code-lang">{language}</span> : null}
          <code className={className} {...props}>
            {text}
          </code>
        </pre>
      );
    },
    a({ href, children }) {
      const safeHttp =
        href && /^(https?:|mailto:|#)/i.test(href) ? href : undefined;
      if (safeHttp) {
        return (
          <a href={safeHttp} title={safeHttp}>
            {children}
          </a>
        );
      }
      const fileRef = href ? parseFileRef(href) : null;
      if (fileRef && onOpenFile) {
        return (
          <button
            type="button"
            className="md-file-link"
            title={`Open ${fileRef.path}`}
            onClick={() =>
              onOpenFile(fileRef.path, fileRef.line, fileRef.column)
            }
          >
            {children}
          </button>
        );
      }
      const textRef =
        typeof children === 'string' ? parseFileRef(children) : null;
      if (textRef && onOpenFile) {
        return (
          <button
            type="button"
            className="md-file-link"
            title={`Open ${textRef.path}`}
            onClick={() =>
              onOpenFile(textRef.path, textRef.line, textRef.column)
            }
          >
            {children}
          </button>
        );
      }
      return <span>{children}</span>;
    },
  };
}

export function MarkdownMessage({
  content,
  streaming = false,
  onOpenFile,
}: MarkdownMessageProps) {
  if (!content.trim() && streaming) {
    return <p className="md-pending">Working…</p>;
  }
  return (
    <div
      className={`markdown-message${streaming ? ' markdown-message--streaming' : ''}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={createComponents(onOpenFile)}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
