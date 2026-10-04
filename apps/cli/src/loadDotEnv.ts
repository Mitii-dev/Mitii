import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Load KEY=VALUE pairs from dotenv-style files into process.env.
 * Does not override variables that are already set (shell / CI wins).
 *
 * Search order (first hit for a key wins among files; later files skip set keys):
 *   1. <cwd>/.env
 *   2. <cwd>/.env.local
 *   3. <cwd>/.mitii/.env
 *   4. ~/.mitii/.env
 */
export function loadCliDotEnv(cwd: string = process.cwd()): {
  loadedFiles: string[];
  keysSet: string[];
} {
  const candidates = [
    join(cwd, '.env'),
    join(cwd, '.env.local'),
    join(cwd, '.mitii', '.env'),
    join(homedir(), '.mitii', '.env'),
  ];

  const loadedFiles: string[] = [];
  const keysSet: string[] = [];
  const seen = new Set<string>();

  for (const file of candidates) {
    if (!existsSync(file)) continue;
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    loadedFiles.push(file);
    for (const { key, value } of parseDotEnv(text)) {
      if (seen.has(key)) continue;
      seen.add(key);
      if (process.env[key] !== undefined && process.env[key] !== '') continue;
      process.env[key] = value;
      keysSet.push(key);
    }
  }

  return { loadedFiles, keysSet };
}

export function parseDotEnv(
  text: string,
): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out.push({ key, value });
  }
  return out;
}
