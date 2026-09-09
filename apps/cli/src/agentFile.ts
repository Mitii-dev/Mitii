import { readFileSync } from 'node:fs';
import { extname, isAbsolute, join, resolve } from 'node:path';

import type {
  AgentMode,
  MitiiAutonomyPreset,
  MitiiImageAttachment,
  UserRequestOrigin,
} from '@mitii/sdk';

const IMAGE_MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/**
 * Agent markdown under `.mitii/agents/<id>.md` (Continue-style).
 * Frontmatter is optional; body becomes the prompt (or is appended).
 */
export interface MitiiAgentFile {
  id: string;
  path: string;
  name?: string;
  description?: string;
  mode?: AgentMode;
  origin?: UserRequestOrigin;
  autonomyPreset?: MitiiAutonomyPreset;
  requiredSkillIds?: string[];
  /** Prompt body from the markdown (after frontmatter). */
  prompt: string;
  /** Raw frontmatter key/values for forward compatibility. */
  frontmatter: Record<string, string>;
}

const AGENT_MODES = new Set(['ask', 'plan', 'agent']);
const ORIGINS = new Set(['user', 'automation', 'api']);
const AUTONOMY = new Set([
  'readonly',
  'propose',
  'apply',
  'apply_and_pr',
]);

/**
 * Resolve `--agent` value to an absolute path.
 * Bare ids look under `<cwd>/.mitii/agents/<id>.md`.
 */
export function resolveAgentFilePath(
  agentRef: string,
  cwd: string,
): string {
  const trimmed = agentRef.trim();
  if (!trimmed) {
    throw new Error('mitii: --agent requires a path or agent id');
  }
  if (
    isAbsolute(trimmed) ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    trimmed.endsWith('.md')
  ) {
    return resolve(cwd, trimmed);
  }
  return join(cwd, '.mitii', 'agents', `${trimmed}.md`);
}

export function loadAgentFile(
  agentRef: string,
  cwd: string,
): MitiiAgentFile {
  const path = resolveAgentFilePath(agentRef, cwd);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`mitii: cannot read agent file "${path}": ${detail}`);
  }
  const { frontmatter, body } = parseFrontmatter(raw);
  const id =
    frontmatter.name?.trim() ||
    path.replace(/\\/g, '/').split('/').pop()?.replace(/\.md$/i, '') ||
    'agent';
  const modeRaw = frontmatter.mode?.trim();
  const originRaw = frontmatter.origin?.trim();
  const autonomyRaw =
    frontmatter.autonomyPreset?.trim() || frontmatter.autonomy?.trim();
  const requiredSkillIds = parseSkillIds(frontmatter.skills);

  if (modeRaw && !AGENT_MODES.has(modeRaw)) {
    throw new Error(
      `mitii: agent "${id}" has invalid mode "${modeRaw}" (ask|plan|agent)`,
    );
  }
  if (originRaw && !ORIGINS.has(originRaw)) {
    throw new Error(
      `mitii: agent "${id}" has invalid origin "${originRaw}" (user|automation|api)`,
    );
  }
  if (autonomyRaw && !AUTONOMY.has(autonomyRaw)) {
    throw new Error(
      `mitii: agent "${id}" has invalid autonomyPreset "${autonomyRaw}"`,
    );
  }

  const prompt = body.trim();
  if (!prompt) {
    throw new Error(`mitii: agent file "${path}" has an empty body`);
  }

  return {
    id,
    path,
    name: frontmatter.name?.trim() || id,
    description: frontmatter.description?.trim(),
    mode: modeRaw as AgentMode | undefined,
    origin: originRaw as UserRequestOrigin | undefined,
    autonomyPreset: autonomyRaw as MitiiAutonomyPreset | undefined,
    requiredSkillIds,
    prompt,
    frontmatter,
  };
}

/**
 * Load a prompt from a file path, or stdin when path is `-`.
 */
export function loadPromptFile(
  promptFile: string,
  options?: { stdin?: () => string },
): string {
  const trimmed = promptFile.trim();
  if (!trimmed) {
    throw new Error('mitii: --prompt-file requires a path (or - for stdin)');
  }
  if (trimmed === '-') {
    const text = (options?.stdin ?? (() => readFileSync(0, 'utf8')))().trim();
    if (!text) {
      throw new Error('mitii: --prompt-file - received empty stdin');
    }
    return text;
  }
  try {
    const text = readFileSync(resolve(trimmed), 'utf8').trim();
    if (!text) {
      throw new Error(`mitii: prompt file "${trimmed}" is empty`);
    }
    return text;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('mitii:')) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`mitii: cannot read prompt file "${trimmed}": ${detail}`);
  }
}

/**
 * Load an image file from disk as a base64 attachment for `--image`.
 * Supports .png/.jpg/.jpeg/.webp/.gif — matches SUPPORTED_IMAGE_MIME_TYPES.
 */
export function loadImageAttachment(
  imagePath: string,
  cwd: string,
): MitiiImageAttachment {
  const trimmed = imagePath.trim();
  if (!trimmed) {
    throw new Error('mitii: --image requires a file path');
  }
  const extension = extname(trimmed).toLowerCase();
  const mimeType = IMAGE_MIME_TYPES_BY_EXTENSION[extension];
  if (!mimeType) {
    throw new Error(
      `mitii: unsupported image type "${extension || trimmed}" (supported: .png, .jpg, .jpeg, .webp, .gif)`,
    );
  }
  const resolvedPath = isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
  let buffer: Buffer;
  try {
    buffer = readFileSync(resolvedPath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`mitii: cannot read image "${trimmed}": ${detail}`);
  }
  if (buffer.length === 0) {
    throw new Error(`mitii: image "${trimmed}" is empty`);
  }
  return {
    mimeType: mimeType as MitiiImageAttachment['mimeType'],
    data: buffer.toString('base64'),
    name: trimmed.replace(/\\/g, '/').split('/').pop() || trimmed,
  };
}

/**
 * Combine CLI prompt positionals, --prompt-file, and agent body.
 * Prefer: explicit prompt + agent instructions appended; else agent body alone.
 */
export function composeAgentPrompt(options: {
  cliPrompt?: string;
  promptFileText?: string;
  agent?: MitiiAgentFile;
}): string {
  const parts: string[] = [];
  if (options.agent) {
    parts.push(options.agent.prompt);
  }
  const userParts = [
    options.cliPrompt?.trim(),
    options.promptFileText?.trim(),
  ].filter((part): part is string => Boolean(part));
  const userPart = userParts.join('\n\n');
  if (userPart) {
    if (options.agent) {
      parts.push('---\nUser request:\n' + userPart);
    } else {
      parts.push(userPart);
    }
  }
  const combined = parts.join('\n\n').trim();
  if (!combined) {
    throw new Error(
      'mitii: ask requires a prompt, --prompt-file, or --agent with a body',
    );
  }
  return combined;
}

function parseFrontmatter(raw: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const trimmed = raw.replace(/^\uFEFF/, '');
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: trimmed };
  }
  const end = trimmed.indexOf('\n---', 3);
  if (end < 0) {
    return { frontmatter: {}, body: trimmed };
  }
  const fmBlock = trimmed.slice(3, end).replace(/^\r?\n/, '');
  let body = trimmed.slice(end + 4).replace(/^\r?\n/, '');
  const frontmatter: Record<string, string> = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    const match = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    const key = match[1]!;
    let value = match[2]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }
  return { frontmatter, body };
}

function parseSkillIds(raw: string | undefined): string[] | undefined {
  const value = raw?.trim();
  if (!value) {
    return undefined;
  }
  const stripped =
    value.startsWith('[') && value.endsWith(']')
      ? value.slice(1, -1)
      : value;
  const ids = stripped
    .split(',')
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
    .slice(0, 3);
  return ids.length > 0 ? ids : undefined;
}
