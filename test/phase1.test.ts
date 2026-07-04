import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { query } from '../packages/sdk/src';
import { ProjectRulesService } from '../src/core/rules/ProjectRulesService';
import { AutoMemoryFileWriter } from '../src/core/memory/AutoMemoryFileWriter';
import { connectAgentMemoryMcp, loadWorkspaceMcpServers } from '../src/core/mcp/mcpWorkspaceConfig';

describe('Phase 1 SDK and platform gaps', () => {
  it('streams SDK events for a stub agent query', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mitii-sdk-test-'));
    try {
      const events = [];
      for await (const event of query({
        cwd,
        runtime: 'stub',
        provider: 'echo',
        mode: 'agent',
        prompt: 'hello',
        approval: 'auto',
      })) {
        events.push(event.type);
      }

      expect(events).toContain('assistant_delta');
      expect(events).toContain('metrics');
      expect(events).toContain('done');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('loads layered MITTII rules and expands @file references', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mitii-rules-test-'));
    try {
      mkdirSync(join(cwd, '.mitii', 'rules'), { recursive: true });
      mkdirSync(join(cwd, '.cursor', 'rules'), { recursive: true });
      writeFileSync(join(cwd, 'README.md'), '# Project Readme\n');
      writeFileSync(join(cwd, 'MITII.md'), 'Root rules @README.md');
      writeFileSync(join(cwd, 'AGENTS.md'), 'Agents compatibility');
      writeFileSync(join(cwd, '.mitii', 'rules', 'testing.md'), 'Always run tests');
      writeFileSync(join(cwd, '.cursor', 'rules', 'style.md'), 'Cursor style');
      writeFileSync(join(cwd, '.mitii', 'MITTII.local.md'), 'Local override');

      const loaded = new ProjectRulesService(cwd).load(5000, 20_000);
      const paths = loaded.map((rule) => rule.relPath);
      expect(paths).toEqual(expect.arrayContaining([
        'MITII.md',
        'AGENTS.md',
        '.mitii/rules/testing.md',
        '.cursor/rules/style.md',
        '.mitii/MITTII.local.md',
      ]));
      expect(loaded.find((rule) => rule.relPath === 'MITII.md')?.content).toContain('Project Readme');
      expect(paths.indexOf('.mitii/MITTII.local.md')).toBe(paths.length - 1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('writes workspace auto-memory markdown and an index', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mitii-memory-test-'));
    try {
      const writer = new AutoMemoryFileWriter(cwd, { enabled: true, scope: 'workspace' });
      const paths = writer.writeObservation({
        id: 1,
        workspace: cwd,
        sessionId: 's1',
        type: 'decision',
        text: 'Use pnpm for all verification commands.',
        files: ['package.json'],
        createdAt: Date.now(),
      });

      expect(paths).toHaveLength(1);
      expect(existsSync(paths[0])).toBe(true);
      expect(readFileSync(join(cwd, '.mitii', 'auto-memory', 'MEMORY.md'), 'utf-8')).toContain('decision');
      expect(writer.readRecent(1)[0]?.content).toContain('Use pnpm');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('merges agentmemory MCP config idempotently', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mitii-agentmemory-test-'));
    try {
      connectAgentMemoryMcp(cwd);
      connectAgentMemoryMcp(cwd);
      const servers = loadWorkspaceMcpServers(cwd);
      expect(servers.agentmemory).toMatchObject({
        disabled: false,
        type: 'streamable-http',
        url: 'http://localhost:3111/mcp',
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
