/**
 * Desktop shell chrome policy (titlebar brand inset vs traffic lights).
 */

/** IPC channel: main → renderer fullscreen state for shell layout. */
export const SHELL_FULLSCREEN_CHANNEL = 'mitii:shell-fullscreen' as const;

/**
 * macOS windowed + hiddenInset titlebar needs left inset so the brand
 * clears the traffic lights. Fullscreen and non-mac platforms do not.
 */
export function needsMacTrafficLightInset(
  platform: string,
  fullscreen: boolean,
): boolean {
  return platform === 'darwin' && !fullscreen;
}

/** Stamp `<html data-mac-traffic-inset>` for CSS titlebar padding. */
export function applyShellChromeDataset(
  root: { dataset: { [key: string]: string | undefined } },
  platform: string,
  fullscreen: boolean,
): void {
  root.dataset.platform = platform;
  root.dataset.fullscreen = fullscreen ? '1' : '0';
  root.dataset.macTrafficInset = needsMacTrafficLightInset(platform, fullscreen)
    ? '1'
    : '0';
}
