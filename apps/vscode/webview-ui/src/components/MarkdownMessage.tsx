import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownMessageProps {
  content: string;
  streaming?: boolean;
}

const components: Components = {
  code({ className, children, ...props }) {
    const text = String(children).replace(/\n$/, '');
    const language = /language-([\w+-]+)/.exec(className ?? '')?.[1];
    const isBlock = Boolean(language) || text.includes('\n');
    if (!isBlock) {
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
    const safe =
      href && /^(https?:|mailto:|#)/i.test(href) ? href : undefined;
    return safe ? (
      <a href={safe} title={safe}>
        {children}
      </a>
    ) : (
      <span>{children}</span>
    );
  },
};

export function MarkdownMessage({ content, streaming = false }: MarkdownMessageProps) {
  if (!content.trim() && streaming) {
    return <p className="md-pending">Working…</p>;
  }
  return (
    <div className={`markdown-message${streaming ? ' markdown-message--streaming' : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
