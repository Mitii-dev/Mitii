import { useMemo } from 'react';
import { useStreamReveal } from '../hooks/useStreamReveal';

interface ThinkingRowProps {
  content: string;
  streaming?: boolean;
  maxChars?: number;
  visible?: boolean;
}

export function ThinkingRow({ content, streaming = false, maxChars = 8000, visible = true }: ThinkingRowProps) {
  const trimmed = content.trim();
  const revealed = useStreamReveal(trimmed, streaming);
  const display = useMemo(() => {
    if (maxChars <= 0 || revealed.length <= maxChars) return revealed;
    return revealed.slice(0, maxChars);
  }, [maxChars, revealed]);
  if (!visible || !trimmed) return null;

  const lines = compactReasoningLines(display);

  return (
    <section className="thinking-block" aria-label="Understanding">
      <div className="thinking-block__header">
        <span>Understanding..</span>
        {streaming && <span className="thinking-block__status">streaming</span>}
      </div>
      <ol className="thinking-block__list">
        {lines.map((line, index) => (
          <li key={`${index}-${line.slice(0, 16)}`}>{line}</li>
        ))}
      </ol>
    </section>
  );
}

function compactReasoningLines(content: string): string[] {
  const cleaned = content
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim())
    .filter(Boolean);
  const chunks = cleaned.length > 1 ? cleaned : splitSentences(content);
  return chunks.slice(0, 6).map((line) => summarize(line, 150));
}

function splitSentences(content: string): string[] {
  return content
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function summarize(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 3).trimEnd()}...`;
}
