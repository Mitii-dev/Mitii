import { describe, expect, it } from 'vitest';

import {
  detectMcpMentionQuery,
  enabledMcpSuggestItems,
  filterMcpSuggestions,
  insertMcpMention,
  togglePinnedMcpServer,
} from '../webview-ui/src/mcpSuggest';

describe('mcpSuggest', () => {
  it('lists enabled servers', () => {
    expect(
      enabledMcpSuggestItems([
        { name: 'Excalidraw', id: 'excalidraw', transport: 'streamable-http' },
        {
          name: 'Off',
          id: 'off',
          transport: 'stdio',
          enabled: false,
          command: 'x',
        },
      ]),
    ).toEqual([{ id: 'excalidraw', name: 'Excalidraw' }]);
  });

  it('detects and inserts @mcp mentions', () => {
    expect(detectMcpMentionQuery('draw @mcp:ex')).toBe('ex');
    expect(detectMcpMentionQuery('@mcp')).toBe('');
    expect(insertMcpMention('draw @mcp:ex', 'excalidraw')).toBe(
      'draw @mcp:excalidraw ',
    );
    expect(insertMcpMention('draw @mcp', 'excalidraw')).toBe(
      'draw @mcp:excalidraw ',
    );
  });

  it('filters and toggles pins', () => {
    expect(
      filterMcpSuggestions(
        [{ id: 'excalidraw', name: 'Excalidraw' }],
        'cal',
      ),
    ).toHaveLength(1);
    expect(togglePinnedMcpServer([], 'excalidraw')).toEqual(['excalidraw']);
    expect(togglePinnedMcpServer(['excalidraw'], 'excalidraw')).toEqual([]);
  });
});
