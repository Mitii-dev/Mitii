#!/usr/bin/env node
/**
 * Enterprise skill authoring gate for Mitii bundled + workspace skills.
 * Exit 1 on errors (broken frontmatter, missing refs, oversize descriptions).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { basename, dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MAX_DESC = 240;
const RECOMMENDED_CHARS = 8_000;
const WARN_CHARS = 18_000;

const targets = process.argv.slice(2);
const roots = targets.length
  ? targets.map((t) => (t.startsWith('/') ? t : join(ROOT, t)))
  : [join(ROOT, 'src/features/ce/skills/bundled')];

let errors = 0;
let warnings = 0;

function walkSkillFiles(dir, depth = 0, out = []) {
  if (depth > 6 || !existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const abs = join(dir, entry);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkSkillFiles(abs, depth + 1, out);
    else if (entry === 'SKILL.md') out.push(abs);
  }
  return out;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const block = match[1];
  const read = (key) => {
    const lines = block.replace(/\r\n/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const m = lines[i].match(new RegExp(`^${key}:\\s*(.*)$`));
      if (!m) continue;
      const value = m[1].trim();
      if (value === '|' || value === '|-' || value === '>' || value === '>-') {
        const indented = [];
        for (let c = i + 1; c < lines.length; c += 1) {
          if (/^\S/.test(lines[c])) break;
          if (!lines[c].trim()) {
            indented.push('');
            continue;
          }
          indented.push(lines[c].replace(/^\s{1,}/, ''));
        }
        return value.startsWith('>')
          ? indented.join(' ').replace(/\s+/g, ' ').trim()
          : indented.join('\n').trim();
      }
      return value.replace(/^['"]|['"]$/g, '').replace(/\s+#.*$/, '').trim();
    }
    return undefined;
  };
  return { name: read('name'), description: read('description') };
}

function validateSkill(absPath, root) {
  const rel = relative(root, absPath);
  const folder = basename(dirname(absPath));
  const content = readFileSync(absPath, 'utf8');
  const fm = parseFrontmatter(content);

  const err = (msg) => {
    errors += 1;
    console.error(`ERROR  ${rel}: ${msg}`);
  };
  const warn = (msg) => {
    warnings += 1;
    console.warn(`WARN   ${rel}: ${msg}`);
  };

  if (!fm) {
    err('malformed or missing YAML frontmatter (need opening/closing ---)');
    return;
  }
  if (!fm.name) err('missing frontmatter name');
  else if (fm.name !== folder) warn(`frontmatter name "${fm.name}" != folder "${folder}"`);
  if (!fm.description) err('missing frontmatter description');
  else if (fm.description.length > MAX_DESC) {
    err(`description ${fm.description.length} chars > ${MAX_DESC} (catalog truncates)`);
  }

  if (!/^##\s+(Quick Reference|Overview)\s*$/m.test(content)) {
    warn('missing "## Quick Reference" or "## Overview" (local-large tiers fall back to 800 chars)');
  }

  if (content.length > WARN_CHARS) {
    warn(`${content.length} chars may exhaust a single tier skill budget; move detail to references/`);
  } else if (content.length > RECOMMENDED_CHARS) {
    warn(`${content.length} chars > recommended ${RECOMMENDED_CHARS}; prefer progressive disclosure`);
  }

  const refs = [...content.matchAll(/`?(references\/[A-Za-z0-9._/-]+)`?/g)].map((m) => m[1]);
  for (const ref of new Set(refs)) {
    const refPath = join(dirname(absPath), ref);
    if (!existsSync(refPath)) err(`dangling reference ${ref}`);
  }

  // Empty sibling dirs without SKILL.md under bundled root are noise
  const parent = dirname(dirname(absPath));
  if (basename(parent) === 'bundled' || basename(parent) === 'skills') {
    // ok
  }
}

for (const root of roots) {
  console.log(`Validating skills under ${root}`);
  const files = walkSkillFiles(root);
  if (files.length === 0) {
    console.error(`ERROR  no SKILL.md found under ${root}`);
    errors += 1;
    continue;
  }

  // Flag empty skill directories (no SKILL.md) at top level
  if (existsSync(root)) {
    for (const entry of readdirSync(root)) {
      const abs = join(root, entry);
      try {
        if (!statSync(abs).isDirectory()) continue;
      } catch {
        continue;
      }
      if (entry.startsWith('.')) continue;
      if (!existsSync(join(abs, 'SKILL.md'))) {
        errors += 1;
        console.error(`ERROR  ${entry}/: directory exists without SKILL.md`);
      }
    }
  }

  for (const file of files.sort()) validateSkill(file, root);
}

console.log(`\nSkills validation complete: ${errors} error(s), ${warnings} warning(s)`);
process.exit(errors > 0 ? 1 : 0);
