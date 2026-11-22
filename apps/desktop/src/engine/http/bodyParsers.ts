/** Request-body parsing helpers shared by engine routes. */

import {
  type MitiiStartInput,
} from '@mitii/sdk';

export function asStringArray(value: unknown, max: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, max);
  return out.length > 0 ? out : undefined;
}

export function asOptionalStringPaths(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  return asStringArray(value, 200) ?? [];
}

export function readCommitMessageStyle(
  body: Record<string, unknown>,
): 'conventional' | 'plain' | undefined {
  if (body.commitMessageStyle === 'conventional' || body.commitMessageStyle === 'plain') {
    return body.commitMessageStyle;
  }
  const json = process.env.MITII_DESKTOP_SETTINGS_JSON?.trim();
  if (!json) return undefined;
  try {
    const root = JSON.parse(json) as { scm?: { commitMessageStyle?: unknown } };
    const style = root.scm?.commitMessageStyle;
    if (style === 'conventional' || style === 'plain') return style;
  } catch {
    /* ignore */
  }
  return undefined;
}

export function parseConversation(
  value: unknown,
): MitiiStartInput['conversation'] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const out: NonNullable<MitiiStartInput['conversation']> = [];
  for (const item of value.slice(0, 200)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const role = record.role === 'assistant' ? 'assistant' : 'user';
    const content =
      typeof record.content === 'string'
        ? record.content.trim()
        : typeof record.text === 'string'
          ? record.text.trim()
          : '';
    if (!content) continue;
    out.push({ role, content });
  }
  return out.length > 0 ? out : undefined;
}
