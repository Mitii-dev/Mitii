import type { Components } from 'react-markdown';
import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { IconCopy } from './Icons';
import { inlineCodeAsFileRef, parseFileRef } from '../fileLinks';

interface MarkdownMessageProps {
  content: string;
  streaming?: boolean;
  onOpenFile?: (path: string, line?: number, column?: number) => void;
}

interface DiagramNode {
  id: string;
  label: string;
  level: number;
  index: number;
}

interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

interface ParsedDiagram {
  direction: 'LR' | 'TB';
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

const DIAGRAM_LANGUAGES = new Set([
  'mermaid',
  'mmd',
  'flowchart',
  'graph',
  'dot',
  'graphviz',
]);

function normalizeLanguage(language?: string): string {
  return (language ?? 'text').trim().toLowerCase();
}

function isDiagramSource(language: string, text: string): boolean {
  if (DIAGRAM_LANGUAGES.has(language)) return true;
  return /^\s*(graph|flowchart)\s+(td|tb|bt|lr|rl)\b/im.test(text);
}

function cleanDiagramLabel(value: string): string {
  return value
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateDiagramLabel(value: string): string {
  return value.length > 22 ? `${value.slice(0, 19)}...` : value;
}

function ensureNode(
  map: Map<string, DiagramNode>,
  id: string,
  label?: string,
): void {
  const key = cleanDiagramLabel(id);
  if (!key) return;
  const existing = map.get(key);
  if (existing) {
    if (label?.trim()) existing.label = cleanDiagramLabel(label);
    return;
  }
  map.set(key, {
    id: key,
    label: cleanDiagramLabel(label || key),
    level: 0,
    index: 0,
  });
}

function readMermaidNode(raw: string): { id: string; label?: string } {
  const trimmed = raw.trim().replace(/;$/, '');
  const match = /^([A-Za-z0-9_.$:-]+)\s*(?:\[(.*?)\]|\((.*?)\)|\{(.*?)\})?$/.exec(
    trimmed,
  );
  if (!match) return { id: trimmed };
  return {
    id: match[1] ?? trimmed,
    label: match[2] ?? match[3] ?? match[4],
  };
}

function parseMermaidDiagram(text: string): ParsedDiagram | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('%%'));
  const header = lines.find((line) => /^(graph|flowchart)\s+/i.test(line));
  if (!header) return null;

  const direction = /\b(lr|rl)\b/i.test(header) ? 'LR' : 'TB';
  const nodes = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];

  for (const line of lines) {
    if (/^(graph|flowchart)\s+/i.test(line)) continue;
    const pipeEdge = /^(.+?)\s*(?:-->|---|==>)\s*\|(.+?)\|\s*(.+?)\s*;?$/.exec(
      line,
    );
    const edge =
      pipeEdge ??
      /^(.+?)\s*(?:--\s*([^->]+?)\s*-->|-->|---|==>)\s*(.+?)\s*;?$/.exec(
        line,
      );
    if (!edge) {
      const single = readMermaidNode(line);
      ensureNode(nodes, single.id, single.label);
      continue;
    }
    const from = readMermaidNode(edge[1] ?? '');
    const to = readMermaidNode(edge[3] ?? '');
    ensureNode(nodes, from.id, from.label);
    ensureNode(nodes, to.id, to.label);
    edges.push({
      from: cleanDiagramLabel(from.id),
      to: cleanDiagramLabel(to.id),
      label: edge[2] ? cleanDiagramLabel(edge[2]) : undefined,
    });
  }

  return buildDiagramLayout(direction, nodes, edges);
}

function parseDotDiagram(text: string): ParsedDiagram | null {
  const body = text.replace(/^\s*(di)?graph\s+[^{]*\{/i, '').replace(/\}\s*$/m, '');
  const nodes = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];
  for (const part of body.split(';')) {
    const line = part.trim();
    if (!line) continue;
    const edge = /^("?[\w.$:-]+"?)\s*(?:->|--)\s*("?[\w.$:-]+"?)(?:\s*\[label="?([^"\]]+)"?\])?/.exec(
      line,
    );
    if (!edge) continue;
    const from = cleanDiagramLabel(edge[1] ?? '');
    const to = cleanDiagramLabel(edge[2] ?? '');
    ensureNode(nodes, from);
    ensureNode(nodes, to);
    edges.push({ from, to, label: edge[3] ? cleanDiagramLabel(edge[3]) : undefined });
  }
  return buildDiagramLayout('LR', nodes, edges);
}

function buildDiagramLayout(
  direction: ParsedDiagram['direction'],
  nodes: Map<string, DiagramNode>,
  edges: DiagramEdge[],
): ParsedDiagram | null {
  if (nodes.size === 0) return null;
  const indegree = new Map<string, number>();
  for (const id of nodes.keys()) indegree.set(id, 0);
  for (const edge of edges) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);

  const queue = [...nodes.keys()].filter((id) => (indegree.get(id) ?? 0) === 0);
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    seen.add(id);
    const node = nodes.get(id);
    if (!node) continue;
    for (const edge of edges.filter((item) => item.from === id)) {
      const next = nodes.get(edge.to);
      if (next) next.level = Math.max(next.level, node.level + 1);
      indegree.set(edge.to, Math.max(0, (indegree.get(edge.to) ?? 1) - 1));
      if ((indegree.get(edge.to) ?? 0) === 0 && !seen.has(edge.to)) {
        queue.push(edge.to);
      }
    }
  }

  const byLevel = new Map<number, DiagramNode[]>();
  for (const node of nodes.values()) {
    const group = byLevel.get(node.level) ?? [];
    group.push(node);
    byLevel.set(node.level, group);
  }
  for (const group of byLevel.values()) {
    group.forEach((node, index) => {
      node.index = index;
    });
  }

  return { direction, nodes: [...nodes.values()], edges };
}

function parseDiagram(language: string, text: string): ParsedDiagram | null {
  if (language === 'dot' || language === 'graphviz') return parseDotDiagram(text);
  return parseMermaidDiagram(text);
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
      <IconCopy />
      <span>{copied ? 'Copied' : label}</span>
    </button>
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
  const lines = text.split(/\r?\n/);
  return (
    <figure className="md-code-card">
      <figcaption className="md-code-toolbar">
        <span className="md-code-window" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="md-code-lang">{lang}</span>
        <CopyButton text={text} />
      </figcaption>
      <pre className="md-code-block">
        <code className={`language-${lang}`}>
          {lines.map((line, index) => {
            const diffClass = line.startsWith('+')
              ? ' md-code-line--add'
              : line.startsWith('-')
                ? ' md-code-line--del'
                : '';
            return (
              <span key={`${index}-${line}`} className={`md-code-line${diffClass}`}>
                <span className="md-code-line__number">{index + 1}</span>
                <span className="md-code-line__text">{line || ' '}</span>
              </span>
            );
          })}
        </code>
      </pre>
    </figure>
  );
}

function DiagramBlock({
  language,
  text,
}: {
  language: string;
  text: string;
}) {
  const diagram = useMemo(() => parseDiagram(language, text), [language, text]);
  if (!diagram) return <CodeBlock language={language} text={text} />;

  const nodeWidth = 132;
  const nodeHeight = 44;
  const levelGap = diagram.direction === 'LR' ? 72 : 54;
  const stackGap = diagram.direction === 'LR' ? 36 : 48;
  const levelCount = Math.max(1, ...diagram.nodes.map((node) => node.level + 1));
  const maxStack = Math.max(
    1,
    ...Array.from({ length: levelCount }, (_, level) =>
      diagram.nodes.filter((node) => node.level === level).length,
    ),
  );
  const width =
    diagram.direction === 'LR'
      ? levelCount * nodeWidth + (levelCount - 1) * levelGap + 32
      : maxStack * nodeWidth + (maxStack - 1) * stackGap + 32;
  const height =
    diagram.direction === 'LR'
      ? maxStack * nodeHeight + (maxStack - 1) * stackGap + 32
      : levelCount * nodeHeight + (levelCount - 1) * levelGap + 32;
  const positions = new Map<string, { x: number; y: number }>();
  for (const node of diagram.nodes) {
    const x =
      diagram.direction === 'LR'
        ? 16 + node.level * (nodeWidth + levelGap)
        : 16 + node.index * (nodeWidth + stackGap);
    const y =
      diagram.direction === 'LR'
        ? 16 + node.index * (nodeHeight + stackGap)
        : 16 + node.level * (nodeHeight + levelGap);
    positions.set(node.id, { x, y });
  }

  return (
    <figure className="md-diagram-card">
      <figcaption className="md-code-toolbar md-diagram-toolbar">
        <span className="md-diagram-title">Graph</span>
        <span className="md-code-lang">{language}</span>
        <CopyButton text={text} label="Source" />
      </figcaption>
      <div className="md-diagram-stage">
        <svg
          className="md-diagram"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Rendered graph diagram"
        >
          <defs>
            <marker
              id="md-diagram-arrow"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M1 1 7 4 1 7z" className="md-diagram-arrow" />
            </marker>
          </defs>
          {diagram.edges.map((edge, index) => {
            const from = positions.get(edge.from);
            const to = positions.get(edge.to);
            if (!from || !to) return null;
            const startX = from.x + nodeWidth;
            const startY = from.y + nodeHeight / 2;
            const endX = to.x;
            const endY = to.y + nodeHeight / 2;
            const midX = startX + Math.max(28, (endX - startX) / 2);
            const d =
              diagram.direction === 'LR'
                ? `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`
                : `M ${from.x + nodeWidth / 2} ${from.y + nodeHeight} C ${from.x + nodeWidth / 2} ${from.y + nodeHeight + 28}, ${to.x + nodeWidth / 2} ${to.y - 28}, ${to.x + nodeWidth / 2} ${to.y}`;
            return (
              <g key={`${edge.from}-${edge.to}-${index}`}>
                <path className="md-diagram-edge" d={d} markerEnd="url(#md-diagram-arrow)" />
                {edge.label ? (
                  <text className="md-diagram-edge-label" x={(startX + endX) / 2} y={(startY + endY) / 2 - 7}>
                    {edge.label}
                  </text>
                ) : null}
              </g>
            );
          })}
          {diagram.nodes.map((node) => {
            const position = positions.get(node.id);
            if (!position) return null;
            return (
              <g key={node.id} transform={`translate(${position.x} ${position.y})`}>
                <rect className="md-diagram-node" width={nodeWidth} height={nodeHeight} rx="7" />
                <text className="md-diagram-node-label" x={nodeWidth / 2} y={nodeHeight / 2 + 4}>
                  {truncateDiagramLabel(node.label)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
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
      const lang = normalizeLanguage(language);
      if (isDiagramSource(lang, text)) {
        return <DiagramBlock language={lang} text={text} />;
      }
      return <CodeBlock language={lang} text={text} />;
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
