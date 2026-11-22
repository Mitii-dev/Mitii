import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  HostStartOptionsError,
  prepareStartInput,
  resolveApprovalPreset,
  THOROUGHNESS_MAP,
} from './index.js';

describe('resolveApprovalPreset', () => {
  it('maps pilot to never/never (SDK SSOT)', () => {
    expect(resolveApprovalPreset('pilot')).toEqual({
      approvalMode: 'never',
      planApproval: 'never',
    });
  });

  it('maps builder to guided', () => {
    expect(resolveApprovalPreset('builder')).toEqual({
      approvalMode: 'when_required',
      planApproval: 'policy',
    });
  });

  it('defaults unknown presets to guided', () => {
    expect(resolveApprovalPreset('nope')).toEqual({
      approvalMode: 'when_required',
      planApproval: 'policy',
    });
  });
});

describe('prepareStartInput', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mitii-prepare-start-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects empty prompt', async () => {
    await expect(
      prepareStartInput({ prompt: '' }),
    ).rejects.toBeInstanceOf(HostStartOptionsError);
  });

  it('maps thoroughness to depth and effort', async () => {
    const { start } = await prepareStartInput({
      prompt: 'hello',
      thoroughness: 'high',
      approvalPreset: 'safe',
    });
    expect(start.explorationDepth).toBe(THOROUGHNESS_MAP.high.depth);
    expect(start.windowBudget?.effort).toBe(THOROUGHNESS_MAP.high.effort);
    expect(start.approvalMode).toBe('every_mutation');
    expect(start.planApproval).toBe('policy');
  });

  it('omits depth/effort when thoroughness is not set', async () => {
    const { start } = await prepareStartInput({
      prompt: 'hello',
      approvalPreset: 'guided',
      maximumOutputTokens: 0,
    });
    expect(start.explorationDepth).toBeUndefined();
    expect(start.windowBudget?.effort).toBeUndefined();
    expect(start.windowBudget?.maximumOutputTokens).toBe(0);
  });

  it('loads disk project rules when workspace has AGENTS.md', async () => {
    writeFileSync(
      join(root, 'AGENTS.md'),
      '# Agents\nAlways use pnpm.\n',
      'utf8',
    );
    const { start, meta } = await prepareStartInput({
      prompt: 'what package manager?',
      workspaceRoot: root,
      uiMode: 'ask',
    });
    expect(meta.projectRulesCount).toBeGreaterThan(0);
    expect(start.projectRules?.some((r) => r.id === 'agents-md')).toBe(true);
  });

  it('skips disk rules when loadDiskProjectRules is false', async () => {
    writeFileSync(join(root, 'AGENTS.md'), 'secret rule\n', 'utf8');
    const { start, meta } = await prepareStartInput({
      prompt: 'hi',
      workspaceRoot: root,
      loadDiskProjectRules: false,
      loadModeProfiles: false,
      userSafety: 'off',
    });
    expect(meta.projectRulesCount).toBe(0);
    expect(start.projectRules).toBeUndefined();
  });

  it('merges mode profile project rules when active', async () => {
    mkdirSync(join(root, '.mitii'), { recursive: true });
    writeFileSync(
      join(root, '.mitii', 'modes.json'),
      JSON.stringify({
        schemaVersion: 1,
        active: 'docs-only',
        modes: [
          {
            slug: 'docs-only',
            name: 'Docs only',
            agentMode: 'ask',
            toolGroups: ['read'],
            roleDefinition: 'Documentation specialist.',
            customInstructions: 'Only touch markdown.',
          },
        ],
      }),
      'utf8',
    );
    const { start, meta, effectiveMode } = await prepareStartInput({
      prompt: 'update docs',
      workspaceRoot: root,
      uiMode: 'agent',
      userSafety: 'off',
    });
    expect(effectiveMode).toBe('ask');
    expect(meta.usedModeProfile).toBe('docs-only');
    expect(
      start.projectRules?.some((r) => r.content.includes('markdown')),
    ).toBe(true);
  });

  it('applies disk safety when enabled in safety.json', async () => {
    mkdirSync(join(root, '.mitii'), { recursive: true });
    writeFileSync(
      join(root, '.mitii', 'safety.json'),
      JSON.stringify({
        enabled: true,
        denyTools: ['delete_directory'],
        denyCommandPrefixes: ['rm'],
        denyPathScopes: [],
        denyNetworkHosts: [],
        protectedPathGlobs: ['.env'],
      }),
      'utf8',
    );
    const { start } = await prepareStartInput({
      prompt: 'cleanup',
      workspaceRoot: root,
      loadModeProfiles: false,
    });
    expect(start.userSafetyRules?.enabled).toBe(true);
    expect(start.userSafetyRules?.denyTools).toContain('delete_directory');
  });

  it('database overlay sets ask mode and skill pin', async () => {
    const { start, effectiveMode, meta } = await prepareStartInput({
      prompt: 'count users',
      workspaceRoot: root,
      uiMode: 'database',
      dbAccess: 'readonly',
      loadDiskProjectRules: false,
      userSafety: 'off',
    });
    expect(effectiveMode).toBe('ask');
    expect(meta.usedDatabaseOverlay).toBe(true);
    expect(start.requiredSkillIds).toContain('nl-sql-analyst');
    expect(
      start.projectRules?.some((r) => r.id === 'database-mode-access'),
    ).toBe(true);
  });

  it('honors approvalOverride over preset', async () => {
    const { start } = await prepareStartInput({
      prompt: 'go',
      approvalPreset: 'safe',
      approvalOverride: {
        approvalMode: 'never',
        planApproval: 'never',
      },
    });
    expect(start.approvalMode).toBe('never');
    expect(start.planApproval).toBe('never');
  });

  it('throws on unknown profileOverride', async () => {
    await expect(
      prepareStartInput({
        prompt: 'hi',
        workspaceRoot: root,
        profileOverride: 'does-not-exist',
      }),
    ).rejects.toMatchObject({ code: 'unknown_mode_profile' });
  });
});
