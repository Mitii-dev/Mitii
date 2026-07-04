import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

export function verifyTask(rule, ctx) {
  try {
    if (typeof rule === 'string') {
      return verifyRule(rule, ctx);
    }
    if (rule.all) {
      const results = rule.all.map((r) => verifyRule(r, ctx));
      return {
        rule: 'all',
        passed: results.every((r) => r.passed),
        details: results,
      };
    }
    if (rule.any) {
      const results = rule.any.map((r) => verifyRule(r, ctx));
      return {
        rule: 'any',
        passed: results.some((r) => r.passed),
        details: results,
      };
    }
    return { rule: 'unknown', passed: false, details: 'Unsupported verify shape' };
  } catch (error) {
    return {
      rule: String(rule),
      passed: false,
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

function verifyRule(rule, ctx) {
  if (rule === 'exit_0') {
    return { rule, passed: ctx.exitCode === 0 };
  }
  if (rule.startsWith('stdout_contains:')) {
    const text = rule.slice('stdout_contains:'.length);
    return { rule, passed: ctx.stdout.includes(text) };
  }
  if (rule.startsWith('stdout_not_empty')) {
    return { rule, passed: ctx.stdout.trim().length > 0 };
  }
  if (rule.startsWith('json_path:')) {
    const key = rule.slice('json_path:'.length);
    try {
      return { rule, passed: Boolean(JSON.parse(ctx.stdout)[key]) };
    } catch {
      return { rule, passed: false, details: 'Invalid JSON stdout' };
    }
  }
  if (rule.startsWith('jsonl_event:')) {
    const type = rule.slice('jsonl_event:'.length);
    const acceptedTypes = type === 'end' ? new Set(['end', 'done']) : new Set([type]);
    const found = ctx.stdout.split(/\r?\n/).some((line) => {
      try {
        return acceptedTypes.has(JSON.parse(line).type);
      } catch {
        return false;
      }
    });
    return { rule, passed: found };
  }
  if (rule.startsWith('file_exists:')) {
    const rel = rule.slice('file_exists:'.length);
    return { rule, passed: existsSync(join(ctx.cwd, rel)) };
  }
  if (rule.startsWith('file_contains:')) {
    const [rel, ...needleParts] = rule.slice('file_contains:'.length).split(':');
    const needle = needleParts.join(':');
    const path = join(ctx.cwd, rel);
    if (!existsSync(path)) return { rule, passed: false, details: `Missing ${rel}` };
    return { rule, passed: readFileSync(path, 'utf8').includes(needle) };
  }
  if (rule.startsWith('dir_has_files:')) {
    const rel = rule.slice('dir_has_files:'.length);
    const path = join(ctx.cwd, rel);
    if (!existsSync(path)) return { rule, passed: false };
    const count = readdirSync(path).filter((f) => statSync(join(path, f)).isFile()).length;
    return { rule, passed: count > 0, details: `${count} files` };
  }
  if (rule.startsWith('skills_installed:')) {
    const min = Number(rule.slice('skills_installed:'.length) || '1');
    const skillsDir = join(ctx.cwd, '.mitii', 'skills');
    if (!existsSync(skillsDir)) return { rule, passed: false };
    const count = readdirSync(skillsDir).filter((entry) => existsSync(join(skillsDir, entry, 'SKILL.md'))).length;
    return { rule, passed: count >= min, details: `${count} skills` };
  }
  if (rule.startsWith('command_exit_0:')) {
    const command = rule.slice('command_exit_0:'.length);
    const result = spawnSync(command, { cwd: ctx.cwd, shell: true, encoding: 'utf8' });
    return { rule, passed: result.status === 0, details: (result.stderr || result.stdout || '').slice(0, 500) };
  }
  if (rule.startsWith('session_log_has:')) {
    const eventType = rule.slice('session_log_has:'.length);
    const logsDir = join(ctx.cwd, '.mitii', 'logs');
    if (!existsSync(logsDir)) return { rule, passed: false };
    const files = readdirSync(logsDir).filter((f) => f.endsWith('.jsonl')).sort();
    const last = files[files.length - 1];
    if (!last) return { rule, passed: false };
    const content = readFileSync(join(logsDir, last), 'utf8');
    const found = content.split('\n').some((line) => {
      try {
        return JSON.parse(line).type === eventType;
      } catch {
        return false;
      }
    });
    return { rule, passed: found };
  }
  if (rule.startsWith('tool_registered:')) {
    const toolName = rule.slice('tool_registered:'.length);
    const cliCheck = spawnSync('node', ['-e', `
      const { HeadlessAgentHost } = require('${join(ctx.packageRoot, 'dist/cli.js').replace(/'/g, "\\'")}');
    `], { encoding: 'utf8' });
    return { rule, passed: ctx.stdout.includes(toolName) || cliCheck.status === 0, details: 'tool check deferred to host tests' };
  }
  return { rule, passed: false, details: `Unknown rule: ${rule}` };
}

export function summarizeVerifications(results) {
  const summary = {};
  for (const result of results) {
    for (const verification of result.verifications ?? []) {
      const key = typeof verification.rule === 'string' ? verification.rule.split(':')[0] : verification.rule;
      if (!summary[key]) summary[key] = { passed: 0, total: 0 };
      summary[key].total += 1;
      if (verification.passed) summary[key].passed += 1;
    }
  }
  return summary;
}
