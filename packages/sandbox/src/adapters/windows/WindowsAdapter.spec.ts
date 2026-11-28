import { describe, expect, it, vi } from 'vitest';

vi.mock('../../helpers/commandExists.js', () => ({
  commandExists: vi.fn((bin: string) => bin === 'podman'),
}));

import { commandExists } from '../../helpers/commandExists.js';
import { resolveWindowsBackend } from './WindowsAdapter.js';

describe('resolveWindowsBackend', () => {
  it('prefers docker when present', async () => {
    vi.mocked(commandExists).mockImplementation((bin) => bin === 'docker');
    const backend = resolveWindowsBackend();
    expect(backend.id).toBe('docker');
    expect(backend.available).toBe(true);
  });

  it('falls back to podman when docker is missing', () => {
    vi.mocked(commandExists).mockImplementation((bin) => bin === 'podman');
    const backend = resolveWindowsBackend();
    expect(backend.id).toBe('podman');
    expect(backend.available).toBe(true);
  });

  it('fails closed when neither runtime is present', () => {
    vi.mocked(commandExists).mockReturnValue(false);
    const backend = resolveWindowsBackend();
    expect(backend.id).toBe('unavailable');
    expect(backend.available).toBe(false);
    expect(backend.reason).toMatch(/docker or podman/i);
    expect(backend.reason).toMatch(/Windows/i);
  });
});
