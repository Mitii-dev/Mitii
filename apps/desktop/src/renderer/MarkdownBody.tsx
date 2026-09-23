import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import {
  elementsToSvg,
  isExcalidrawSource,
  parseExcalidrawDocument,
} from '../shared/excalidrawSvg.js';

interface MarkdownBodyProps {
  text: string;
  streaming?: boolean;
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

function normalizeLanguage(language?: string): string {
  return (language ?? 'text').trim().toLowerCase();
}

function isMermaidSource(language: string, text: string): boolean {
  if (language === 'mermaid' || language === 'mmd') return true;
  return /^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|mindmap|timeline|journey)\b/im.test(
    text,
  );
}

function CodeBlock({
  language,
  text,
}: {
  language?: string;
  text: string;
}) {
  const lang = normalizeLanguage(language);
  return (
    <figure className="md-code-card">
      <figcaption className="md-code-toolbar">
        <span className="md-code-lang">{lang}</span>
        <CopyButton text={text} />
      </figcaption>
      <pre className="md-pre">
        <code className={`language-${lang}`}>{text}</code>
      </pre>
    </figure>
  );
}

function ExcalidrawBlock({ text }: { text: string }) {
  const [showSource, setShowSource] = useState(false);
  const parsed = useMemo(() => parseExcalidrawDocument(text), [text]);

  if (!parsed) {
    return (
      <figure className="md-diagram-card md-diagram-card--error">
        <figcaption className="md-code-toolbar md-diagram-toolbar">
          <span className="md-diagram-title">Excalidraw</span>
          <span className="md-code-lang">parse error</span>
          <CopyButton text={text} label="Source" />
        </figcaption>
        <p className="md-diagram-error">
          Could not parse Excalidraw JSON (incomplete or invalid).
        </p>
        <CodeBlock language="json" text={text} />
      </figure>
    );
  }

  const title = parsed.title ?? 'Architecture diagram';
  const svg = elementsToSvg(parsed.elements, title);
  const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  return (
    <figure className="md-diagram-card mcp-app-card">
      <figcaption className="md-code-toolbar md-diagram-toolbar">
        <span className="md-diagram-title">{title}</span>
        <span className="md-code-lang">excalidraw</span>
        <div className="md-diagram-actions">
          <button
            type="button"
            className="md-copy-button"
            onClick={() => setShowSource((v) => !v)}
          >
            {showSource ? 'Hide source' : 'Source'}
          </button>
          <CopyButton text={text} label="Copy" />
        </div>
      </figcaption>
      <div className="md-diagram-stage">
        <img className="mcp-app-card__svg" src={svgDataUrl} alt={title} />
      </div>
      {showSource ? <CodeBlock language="excalidraw" text={text} /> : null}
    </figure>
  );
}

function MermaidBlock({ text }: { text: string }) {
  const reactId = useId().replace(/:/g, '');
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(null);

    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'neutral',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        });
        const id = `mermaid-${reactId}-${Math.random().toString(36).slice(2, 8)}`;
        const result = await mermaid.render(id, text);
        if (!cancelled) setSvg(result.svg);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reactId, text]);

  if (error) {
    return (
      <figure className="md-diagram-card md-diagram-card--error">
        <figcaption className="md-code-toolbar md-diagram-toolbar">
          <span className="md-diagram-title">Mermaid</span>
          <span className="md-code-lang">render error</span>
          <CopyButton text={text} label="Source" />
        </figcaption>
        <p className="md-diagram-error">{error}</p>
        <CodeBlock language="mermaid" text={text} />
      </figure>
    );
  }

  return (
    <figure className="md-diagram-card">
      <figcaption className="md-code-toolbar md-diagram-toolbar">
        <span className="md-diagram-title">Diagram</span>
        <span className="md-code-lang">mermaid</span>
        <div className="md-diagram-actions">
          <button
            type="button"
            className="md-copy-button"
            onClick={() => setShowSource((v) => !v)}
          >
            {showSource ? 'Hide source' : 'Source'}
          </button>
          <CopyButton text={text} label="Copy" />
        </div>
      </figcaption>
      <div className="md-diagram-stage">
        {svg ? (
          <div
            className="md-mermaid"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div className="md-diagram-loading">Rendering diagram…</div>
        )}
      </div>
      {showSource ? <CodeBlock language="mermaid" text={text} /> : null}
    </figure>
  );
}

export function MarkdownBody({ text, streaming }: MarkdownBodyProps) {
  if (!text.trim()) {
    return streaming ? <p className="md-pending">Working…</p> : null;
  }
  return (
    <div className={`md${streaming ? ' md--streaming' : ''}`}>
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
            const language = normalizeLanguage(
              className?.replace(/^language-/, ''),
            );
            if (isExcalidrawSource(language, codeText)) {
              return <ExcalidrawBlock text={codeText} />;
            }
            if (isMermaidSource(language, codeText)) {
              return <MermaidBlock text={codeText} />;
            }
            return <CodeBlock language={language} text={codeText} />;
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
