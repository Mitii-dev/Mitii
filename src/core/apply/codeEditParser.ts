import { extractFileMentions } from '../context/fuzzyFileMatch';

export interface ParsedCodeEdit {
  path: string;
  content: string;
}

const CODE_EDIT_BLOCK_RE = /```[\w+-]*\|CODE_EDIT_BLOCK\|([^\n`]+)\n([\s\S]*?)```/g;

export function parseCodeEdits(response: string, userMessage = ''): ParsedCodeEdit[] {
  const edits: ParsedCodeEdit[] = [];
  const seen = new Set<string>();

  for (const match of response.matchAll(CODE_EDIT_BLOCK_RE)) {
    const path = match[1].trim();
    const content = match[2].replace(/\n$/, '');
    if (path && content && !seen.has(path)) {
      seen.add(path);
      edits.push({ path, content });
    }
  }

  if (edits.length > 0) return edits;

  const pathHeaderRe = /```[\w+-]*\n(?:\/\/\s*(?:path|file):\s*|#\s*)([^\n]+)\n([\s\S]*?)```/gi;
  for (const match of response.matchAll(pathHeaderRe)) {
    const path = match[1].trim();
    const content = match[2].replace(/\n$/, '');
    if (path && content && !seen.has(path)) {
      seen.add(path);
      edits.push({ path, content });
    }
  }

  const mentions = extractFileMentions(userMessage);
  const fencedBlocks = extractFencedCodeBlocks(response);

  if (edits.length === 0 && mentions.length === 1 && fencedBlocks.length === 1) {
    edits.push({ path: mentions[0], content: fencedBlocks[0] });
  }

  if (edits.length === 0 && mentions.length === 1 && fencedBlocks.length > 0) {
    const largest = fencedBlocks.reduce((a, b) => (a.length >= b.length ? a : b));
    if (largest.length > 30) {
      edits.push({ path: mentions[0], content: largest });
    }
  }

  return edits;
}

function extractFencedCodeBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re = /```[\w+-]*\n([\s\S]*?)```/g;
  for (const match of text.matchAll(re)) {
    const content = match[1].replace(/\n$/, '');
    if (content.length > 20) blocks.push(content);
  }
  return blocks;
}
