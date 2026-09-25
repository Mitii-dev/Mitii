import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type UIEvent,
} from 'react';

import { highlightCode } from '../codeHighlight.js';

interface CodeEditorProps {
  path: string;
  value: string;
  readOnly?: boolean;
  onChange: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}

export function CodeEditor(props: CodeEditorProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);

  const lineCount = useMemo(
    () => Math.max(1, props.value.split('\n').length),
    [props.value],
  );

  const gutterDigits = Math.max(2, String(lineCount).length);

  const html = useMemo(
    () => highlightCode(props.value, props.path),
    [props.value, props.path],
  );

  // Keep trailing newline visible in the highlight layer (textarea shows it).
  const highlightHtml = html.endsWith('\n') ? `${html}\n` : html || ' ';

  const syncScroll = (e: UIEvent<HTMLTextAreaElement>) => {
    const top = e.currentTarget.scrollTop;
    const left = e.currentTarget.scrollLeft;
    if (gutterRef.current) gutterRef.current.scrollTop = top;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = top;
      highlightRef.current.scrollLeft = left;
    }
  };

  useEffect(() => {
    // Reset scroll alignment when switching files.
    if (inputRef.current) {
      inputRef.current.scrollTop = 0;
      inputRef.current.scrollLeft = 0;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = 0;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = 0;
      highlightRef.current.scrollLeft = 0;
    }
  }, [props.path]);

  return (
    <div
      className="code-editor"
      style={
        {
          '--code-gutter-ch': String(gutterDigits),
        } as CSSProperties
      }
    >
      <div className="code-editor__gutter" ref={gutterRef} aria-hidden>
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} className="code-editor__line-no">
            {i + 1}
          </div>
        ))}
      </div>
      <div className="code-editor__stack">
        <pre
          ref={highlightRef}
          className="code-editor__highlight hljs"
          aria-hidden
          dangerouslySetInnerHTML={{ __html: highlightHtml }}
        />
        <textarea
          ref={inputRef}
          className="code-editor__input"
          spellCheck={false}
          value={props.value}
          readOnly={props.readOnly}
          onScroll={syncScroll}
          onChange={(e) => props.onChange(e.target.value)}
          onKeyDown={props.onKeyDown}
        />
      </div>
    </div>
  );
}
