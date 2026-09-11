import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';

import { workspaceRootsFromPath } from '../src/mcp/stdioClient.js';

describe('MCP client P1 helpers', () => {
  it('workspaceRootsFromPath emits file:// URIs', () => {
    const roots = workspaceRootsFromPath('/tmp/project', 'workspace');
    expect(roots).toHaveLength(1);
    expect(roots[0]?.uri).toBe(pathToFileURL('/tmp/project').href);
    expect(roots[0]?.name).toBe('workspace');
  });
});
