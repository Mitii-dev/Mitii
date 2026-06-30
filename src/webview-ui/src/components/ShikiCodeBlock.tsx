import { useEffect, useState } from 'react';
import { highlightCode } from '../utils/shikiHighlighter';

const LANG_ALIASES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  py: 'python',
  rb: 'ruby',
  sh: 'bash',
  yml: 'yaml',
  md: 'markdown',
};

function normalizeLanguage(language: string): string {
  const trimmed = language.trim().toLowerCase();
  if (!trimmed || trimmed === 'code') return 'text';
  return LANG_ALIASES[trimmed] ?? trimmed;
}

interface ShikiCodeBlockProps {
  language: string;
  path?: string;
  value: string;
  streaming?: boolean;
}

export function ShikiCodeBlock({ language, path, value, streaming }: ShikiCodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null);
  const label = path ? path : language;

  useEffect(() => {
    if (streaming || !value.trim()) {
      setHtml(null);
      return;
    }

    let cancelled = false;
    const lang = normalizeLanguage(language);

    highlightCode(value, lang)
      .then((highlighted) => {
        if (!cancelled) setHtml(highlighted);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });

    return () => {
      cancelled = true;
    };
  }, [language, value, streaming]);

  return (
    <div className={`code-block${streaming ? ' code-block--streaming' : ''}`}>
      <div className="code-block__header">
        <span className="code-block__label">{label}</span>
        {streaming && <span className="code-block__status">Generating…</span>}
      </div>
      {html ? (
        <div className="code-block__shiki" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre><code>{value || ' '}</code></pre>
      )}
    </div>
  );
}
