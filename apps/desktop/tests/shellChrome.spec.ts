import { describe, expect, it } from 'vitest';

import {
  applyShellChromeDataset,
  needsMacTrafficLightInset,
} from '../src/shared/shellChrome.js';

describe('needsMacTrafficLightInset', () => {
  it('insets macOS when not fullscreen', () => {
    expect(needsMacTrafficLightInset('darwin', false)).toBe(true);
  });

  it('clears inset on macOS fullscreen', () => {
    expect(needsMacTrafficLightInset('darwin', true)).toBe(false);
  });

  it('never insets Windows or Linux', () => {
    expect(needsMacTrafficLightInset('win32', false)).toBe(false);
    expect(needsMacTrafficLightInset('win32', true)).toBe(false);
    expect(needsMacTrafficLightInset('linux', false)).toBe(false);
  });
});

describe('applyShellChromeDataset', () => {
  it('stamps mac traffic inset only for windowed darwin', () => {
    const root = { dataset: {} as { [key: string]: string | undefined } };
    applyShellChromeDataset(root, 'darwin', false);
    expect(root.dataset.macTrafficInset).toBe('1');
    applyShellChromeDataset(root, 'darwin', true);
    expect(root.dataset.macTrafficInset).toBe('0');
    applyShellChromeDataset(root, 'win32', false);
    expect(root.dataset.macTrafficInset).toBe('0');
  });
});
