import { describe, expect, it } from 'vitest';
import {
  AGENT_DEPTH_OPTIONS,
  AGENT_DEPTHS,
  normalizeAgentDepth,
} from '../src/core/config/agentDepth';
import { AgentConfigSchema, AgentDepthSchema } from '../src/core/config/schema';

describe('agentDepth', () => {
  it('exposes exactly three canonical depths for the UI', () => {
    expect([...AGENT_DEPTHS]).toEqual(['auto', 'quick', 'deep']);
    expect(AGENT_DEPTH_OPTIONS.map((option) => option.id)).toEqual(['auto', 'quick', 'deep']);
  });

  it('normalizes legacy depths onto the canonical set', () => {
    expect(normalizeAgentDepth('auto')).toBe('auto');
    expect(normalizeAgentDepth('quick')).toBe('quick');
    expect(normalizeAgentDepth('deep')).toBe('deep');
    expect(normalizeAgentDepth('standard')).toBe('deep');
    expect(normalizeAgentDepth('pilot')).toBe('deep');
    expect(normalizeAgentDepth('enterprise')).toBe('deep');
    expect(normalizeAgentDepth('unknown')).toBe('auto');
  });

  it('parses legacy depth values through the config schema', () => {
    expect(AgentDepthSchema.parse('pilot')).toBe('deep');
    expect(AgentDepthSchema.parse('enterprise')).toBe('deep');
    expect(AgentConfigSchema.parse({
      askDepth: 'standard',
      planDepth: 'pilot',
      actDepth: 'enterprise',
    })).toMatchObject({
      askDepth: 'deep',
      planDepth: 'deep',
      actDepth: 'deep',
    });
  });
});
