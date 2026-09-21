import { useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownBodyProps {
  text: string;
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="md-copy-button"
      title={copied ? 'Copied' : label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1100);
        });
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

export function MarkdownBody({ text }: MarkdownBodyProps) {
  if (!text.trim()) return null;
  return (
    <div className="md">
      <div className="md-toolbar">
        <CopyButton text={text} label="Copy" />
      </div>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          code: ({ className, children, ...props }) => {
            const inline = !className;
            const codeText = String(children ?? '').replace(/\n$/, '');
            if (inline) {
              return (
                <code className="md-code-inline" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <figure className="md-code-card">
                <figcaption className="md-code-toolbar">
                  <span className="md-code-lang">
                    {className?.replace(/^language-/, '') || 'code'}
                  </span>
                  <CopyButton text={codeText} />
                </figcaption>
                <pre className="md-pre">
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              </figure>
            );
          },
          table: ({ children }: { children?: ReactNode }) => (
            <div className="md-table-wrap">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
