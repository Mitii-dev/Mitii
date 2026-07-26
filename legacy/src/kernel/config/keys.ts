export const CONFIG_SECTION = 'mitii';
export const LEGACY_CONFIG_SECTION = 'thunder';

export function thunderConfigKey(path: string): string {
  return `${CONFIG_SECTION}.${path}`;
}

export function legacyThunderConfigKey(path: string): string {
  return `${LEGACY_CONFIG_SECTION}.${path}`;
}
