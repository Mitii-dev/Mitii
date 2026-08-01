import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard']);
export const MODES = Object.freeze(['ask', 'plan', 'agent']);

export function loadCases(rootDir) {
  const cases = [];
  for (const difficulty of DIFFICULTIES) {
    const path = join(rootDir, 'cases', `${difficulty}.jsonl`);
    if (!existsSync(path)) throw new Error(`Missing case file: ${path}`);
    const lines = readFileSync(path, 'utf8').split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line) continue;
      try {
        cases.push(JSON.parse(line));
      } catch (error) {
        throw new Error(`${path}:${index + 1}: invalid JSON (${error.message})`);
      }
    }
  }
  return cases;
}

export function filterCases(cases, filters) {
  return cases.filter((testCase) => {
    if (filters.difficulty && testCase.difficulty !== filters.difficulty) return false;
    if (filters.mode && testCase.mode !== filters.mode) return false;
    if (filters.fixture && testCase.fixture !== filters.fixture) return false;
    if (filters.id && !testCase.id.includes(filters.id)) return false;
    return true;
  });
}
