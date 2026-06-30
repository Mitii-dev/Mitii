const MDX_FILE_PATTERN = /\.mdx?$/i;
const RAW_TABLE_GENERIC_PATTERN = /\b[A-Za-z_$][\w.$]*\s*<[^>`|\n]*,[^>`|\n]*>/;
const BROKEN_LIVE_CODE_BLOCK_OPEN = /code=\{\s*\n\s*`/;
const BROKEN_LIVE_CODE_BLOCK_CLOSE = /`\s*\n\s*componentName=/;
const RENDER_IN_LIVE_CODE_BLOCK = /<LiveCodeBlock[\s\S]*?`[\s\S]*?\brender\s*\(/m;

export function validateMdxContent(path: string, content: string): string | undefined {
  if (!MDX_FILE_PATTERN.test(path)) return undefined;

  const tableError = validateMdxTableGenerics(content);
  if (tableError) return tableError;

  const liveCodeBlockError = validateLiveCodeBlock(content);
  if (liveCodeBlockError) return liveCodeBlockError;

  return undefined;
}

function validateMdxTableGenerics(content: string): string | undefined {
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!isMarkdownTableRow(line)) continue;

    const withoutCodeSpans = line.replace(/`[^`]*`/g, '');
    const match = withoutCodeSpans.match(RAW_TABLE_GENERIC_PATTERN);
    if (!match) continue;

    return [
      `Invalid MDX table type on line ${i + 1}: raw TypeScript generic "${match[0]}" will be parsed as JSX.`,
      'Wrap the whole table-cell type in backticks, for example `Record<string, any>` or `(values: Record<string, any>) => void`.',
      'This commonly causes: Unexpected character `,` in name, expected a name character.',
    ].join(' ');
  }

  return undefined;
}

function validateLiveCodeBlock(content: string): string | undefined {
  if (!content.includes('<LiveCodeBlock')) return undefined;

  if (BROKEN_LIVE_CODE_BLOCK_OPEN.test(content)) {
    return [
      'Invalid LiveCodeBlock: `code={` must be followed immediately by the opening backtick on the same line.',
      'Use `code={` + newline + `import ...` + newline + `  `}` before componentName.',
      'Splitting `code={` and the template literal across lines causes: Could not parse expression with acorn.',
      'Compare with a working sibling doc such as form-builder.md in the same folder.',
    ].join(' ');
  }

  if (BROKEN_LIVE_CODE_BLOCK_CLOSE.test(content)) {
    return [
      'Invalid LiveCodeBlock: close the code template with backtick + `}` before componentName.',
      'Expected pattern: `  `}` then `componentName="MyComponent"`.',
    ].join(' ');
  }

  if (RENDER_IN_LIVE_CODE_BLOCK.test(content)) {
    return [
      'Invalid LiveCodeBlock: remove render(<Component />) from the code string.',
      'live-demo-mui adds render() automatically via processCode().',
      'Keep only the component function in the code block; do not call render() yourself.',
      'Example: end the code with `}` + componentName="MyForm" (no render line).',
    ].join(' ');
  }

  return undefined;
}

function isMarkdownTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.split('|').length >= 4;
}
