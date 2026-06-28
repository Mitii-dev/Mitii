import type { ThunderDb } from '../indexing/ThunderDb';

export type ContextContentTier = 'full' | 'signatures' | 'excerpt';

const SIGNATURE_TIER_SOURCES = new Set([
  'current-editor',
  'open-files',
  'indexed-file-search',
]);

const EXCERPT_TIER_SOURCES = new Set([
  'fts',
  'vector',
  'repo-map',
  'memory',
  'workspace-overview',
  'git-diff',
  'diagnostics',
]);

export function getSourceContentTier(
  sourceId: string,
  options: { hasSelection?: boolean; isPinned?: boolean }
): ContextContentTier {
  if (options.isPinned || sourceId === 'mentioned-files' || sourceId === 'project-rules') {
    return 'full';
  }
  if (options.hasSelection && sourceId === 'current-editor') {
    return 'full';
  }
  if (SIGNATURE_TIER_SOURCES.has(sourceId)) {
    return 'signatures';
  }
  if (EXCERPT_TIER_SOURCES.has(sourceId)) {
    return 'excerpt';
  }
  return 'excerpt';
}

export function formatFileSignatures(
  symbols: Array<{ name: string; kind: string; signature: string | null }>,
  maxSymbols = 25
): string {
  if (symbols.length === 0) return '(no symbols indexed)';
  return symbols
    .slice(0, maxSymbols)
    .map((s) => {
      const sig = s.signature?.trim();
      return sig ? `${s.kind} ${s.name} — ${sig}` : `${s.kind} ${s.name}`;
    })
    .join('\n');
}

export function formatFileHead(content: string, maxLines = 40): string {
  const lines = content.split('\n');
  if (lines.length <= maxLines) return content;
  return `${lines.slice(0, maxLines).join('\n')}\n… (${lines.length - maxLines} more lines)`;
}

export function loadFileSignatures(
  db: ThunderDb,
  workspace: string,
  relPath: string
): Array<{ name: string; kind: string; signature: string | null }> {
  const row = db.raw
    .prepare('SELECT id FROM files WHERE workspace = ? AND rel_path = ?')
    .get(workspace, relPath) as { id: number } | undefined;
  if (!row) return [];

  return db.raw
    .prepare(
      'SELECT name, kind, signature FROM symbols WHERE file_id = ? ORDER BY start_line LIMIT 30'
    )
    .all(row.id) as Array<{ name: string; kind: string; signature: string | null }>;
}

export function applyContentTier(
  content: string,
  tier: ContextContentTier,
  symbols: Array<{ name: string; kind: string; signature: string | null }>
): { content: string; reasonSuffix: string } {
  if (tier === 'full') {
    return { content, reasonSuffix: '' };
  }
  if (tier === 'signatures') {
    const sigBlock = formatFileSignatures(symbols);
    const head = formatFileHead(content, 25);
    return {
      content: `// Signatures\n${sigBlock}\n\n// File head\n${head}`,
      reasonSuffix: ' (signatures + head only)',
    };
  }
  return {
    content: content.length > 1200 ? `${content.slice(0, 1200).trimEnd()}\n[excerpt]` : content,
    reasonSuffix: ' (excerpt)',
  };
}
