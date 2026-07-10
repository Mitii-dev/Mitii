import { useEffect, useRef, useState } from 'react';
import { highlightCode } from '../utils/shikiHighlighter';
import { IconCopy } from './Icons';

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
  const [copied, setCopied] = useState(false);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const label = path ? path : language;

  useEffect(() => {
    return () => clearTimeout(copyResetRef.current);
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      clearTimeout(copyResetRef.current);
      copyResetRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable; silently ignore
    }
  };

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
        {streaming ? (
          <span className="code-block__status">Generating…</span>
        ) : (
          <button
            type="button"
            className={`code-block__copy${copied ? ' code-block__copy--copied' : ''}`}
            onClick={handleCopy}
            aria-label="Copy code"
          >
            <IconCopy width={12} height={12} />
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
      {html ? (
        <div className="code-block__shiki" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre><code>{value || ' '}</code></pre>
      )}
    </div>
  );
}
