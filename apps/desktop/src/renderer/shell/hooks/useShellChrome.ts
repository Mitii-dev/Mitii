/** Platform / fullscreen chrome dataset on the document root. */

import { useLayoutEffect } from 'react';
import { applyShellChromeDataset } from '../../../shared/shellChrome.js';
import { getDesktopBridge } from '../../api.js';

export function useShellChrome() {
  useLayoutEffect(() => {
    const guessPlatform = (): string => {
      if (/Mac|iPhone|iPad|iPod/i.test(navigator.platform)) return 'darwin';
      if (/Win/i.test(navigator.platform)) return 'win32';
      if (/Linux/i.test(navigator.platform)) return 'linux';
      return navigator.platform || 'unknown';
    };
    let platform = guessPlatform();
    let fullscreen = false;
    const stamp = () => {
      applyShellChromeDataset(document.documentElement, platform, fullscreen);
    };
    stamp();

    const bridge = getDesktopBridge();
    if (!bridge?.getShellChrome || !bridge.onShellFullscreen) return;
    let cancelled = false;
    void bridge.getShellChrome().then((chrome) => {
      if (cancelled) return;
      platform = chrome.platform;
      fullscreen = chrome.fullscreen;
      stamp();
    });
    const unsubscribe = bridge.onShellFullscreen((next) => {
      fullscreen = next;
      stamp();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
}
