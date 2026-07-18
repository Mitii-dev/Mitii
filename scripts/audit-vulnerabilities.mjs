#!/usr/bin/env node
/**
 * Enterprise vulnerability audit for npm/pnpm/yarn workspaces.
 * Read-only: runs package-manager audit + optional OSV lookups. Never mutates the lockfile.
 *
 * Output: structured JSON on stdout suitable for agent consumption.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const cwd = process.cwd();
const requestedTarget = process.argv[2]?.trim();
const MAX_OSV = 12;
const OSV_TIMEOUT_MS = 8_000;

function detectPackageManager(root = cwd) {
  if (existsSync(join(root, 'pnpm-lock.yaml')) || existsSync(join(root, 'pnpm-workspace.yaml'))) {
    return 'pnpm';
  }
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'package-lock.json'))) return 'npm';
  if (existsSync(join(root, 'package.json'))) {
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      const pm = pkg.packageManager;
      if (typeof pm === 'string') {
        if (pm.startsWith('pnpm')) return 'pnpm';
        if (pm.startsWith('yarn')) return 'yarn';
        if (pm.startsWith('npm')) return 'npm';
      }
    } catch {
      // fall through
    }
  }
  return 'npm';
}

function resolveScanRoot() {
  if (!requestedTarget) return cwd;
  const target = isAbsolute(requestedTarget) ? requestedTarget : resolve(cwd, requestedTarget);
  if (!existsSync(target)) {
    throw new Error(`Audit target does not exist: ${requestedTarget}`);
  }
  return statSync(target).isDirectory() ? target : dirname(target);
}

function findPackageRoots(root) {
  const roots = [];
  const skip = new Set(['node_modules', '.git', '.mitii', 'dist', 'build', 'coverage', '.next', 'out']);

  function walk(dir, depth) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      roots.push(dir);
    }
    if (depth >= 3) return;
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry) || entry.startsWith('.')) continue;
      const abs = join(dir, entry);
      try {
        if (statSync(abs).isDirectory()) walk(abs, depth + 1);
      } catch {
        // ignore
      }
    }
  }

  walk(root, 0);
  if (roots.length === 0) roots.push(root);
  return roots;
}

function runAudit(pm, dir) {
  const argsByPm = {
    pnpm: ['audit', '--json'],
    npm: ['audit', '--json'],
    yarn: ['audit', '--json'],
  };
  const args = argsByPm[pm] ?? argsByPm.npm;
  const result = spawnSync(pm, args, {
    cwd: dir,
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, FORCE_COLOR: '0', npm_config_color: 'false' },
    timeout: 120_000,
    maxBuffer: 12 * 1024 * 1024,
  });

  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();
  let parsed = null;
  if (stdout) {
    try {
      parsed = JSON.parse(stdout);
    } catch {
      // yarn classic sometimes emits non-JSON lines; keep raw
    }
  }

  return {
    packageRoot: relative(cwd, dir) || '.',
    exitCode: result.status ?? 1,
    error: result.error?.message,
    stderr: stderr.slice(0, 2000),
    raw: parsed ? undefined : stdout.slice(0, 8000),
    report: parsed,
  };
}

function collectAdvisoryIds(report) {
  const ids = new Set();
  if (!report || typeof report !== 'object') return [];

  // npm / pnpm classic advisories map
  const advisories = report.advisories;
  if (advisories && typeof advisories === 'object') {
    for (const adv of Object.values(advisories)) {
      if (adv?.url) ids.add(String(adv.url));
      if (adv?.id != null) ids.add(`GHSA-or-npm:${adv.id}`);
    }
  }

  // pnpm / npm v7+ vulnerabilities map
  const vulns = report.vulnerabilities;
  if (vulns && typeof vulns === 'object') {
    for (const [name, info] of Object.entries(vulns)) {
      if (info?.via) {
        for (const via of Array.isArray(info.via) ? info.via : [info.via]) {
          if (typeof via === 'object' && via?.url) ids.add(String(via.url));
          if (typeof via === 'string') ids.add(`${name}:${via}`);
        }
      }
      if (info?.fixAvailable) {
        // keep name for OSV query
        ids.add(`pkg:${name}`);
      }
    }
  }

  return [...ids].slice(0, MAX_OSV);
}

function advisoryPackageName(advisory) {
  const name = advisory?.module_name ?? advisory?.moduleName ?? advisory?.name;
  return typeof name === 'string' && name.trim() ? name.trim() : undefined;
}

function summarizeReport(report) {
  if (!report || typeof report !== 'object') {
    return { total: 0, bySeverity: {}, packages: [] };
  }

  const meta = report.metadata?.vulnerabilities ?? report.metadata ?? {};
  const bySeverity = {
    critical: Number(meta.critical ?? 0) || 0,
    high: Number(meta.high ?? 0) || 0,
    moderate: Number(meta.moderate ?? meta.moderate ?? 0) || 0,
    low: Number(meta.low ?? 0) || 0,
    info: Number(meta.info ?? 0) || 0,
  };

  if (!bySeverity.critical && !bySeverity.high && report.vulnerabilities) {
    for (const info of Object.values(report.vulnerabilities)) {
      const sev = String(info?.severity ?? 'info').toLowerCase();
      if (sev in bySeverity) bySeverity[sev] += 1;
      else bySeverity.info += 1;
    }
  }

  const total = Object.values(bySeverity).reduce((a, b) => a + b, 0);
  const packages = report.vulnerabilities
    ? Object.entries(report.vulnerabilities).slice(0, 40).map(([name, info]) => ({
        name,
        severity: info?.severity,
        range: info?.range,
        fixAvailable: info?.fixAvailable ?? false,
        via: Array.isArray(info?.via)
          ? info.via.slice(0, 5).map((v) => (typeof v === 'string' ? v : v?.title || v?.url || v))
          : info?.via,
      }))
    : Object.values(report.advisories ?? {})
        .map((info) => ({
          name: advisoryPackageName(info),
          severity: info?.severity,
          range: info?.vulnerable_versions,
          patchedVersions: info?.patched_versions,
          recommendation: info?.recommendation,
          via: info?.title || info?.url,
        }))
        .filter((info) => info.name)
        .slice(0, 40);

  return { total, bySeverity, packages };
}

async function enrichWithOsv(packageNames) {
  const results = [];
  for (const name of packageNames.slice(0, MAX_OSV)) {
    const pkg = name.startsWith('pkg:') ? name.slice(4) : name;
    if (!pkg || pkg.includes('/') && !pkg.startsWith('@')) continue;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), OSV_TIMEOUT_MS);
      const res = await fetch('https://api.osv.dev/v1/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ package: { name: pkg, ecosystem: 'npm' } }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        results.push({ package: pkg, error: `HTTP ${res.status}` });
        continue;
      }
      const data = await res.json();
      const vulns = Array.isArray(data.vulns) ? data.vulns : [];
      results.push({
        package: pkg,
        count: vulns.length,
        ids: vulns.slice(0, 8).map((v) => v.id),
        summaries: vulns.slice(0, 5).map((v) => ({
          id: v.id,
          summary: v.summary,
          severity: v.severity?.[0]?.score ?? v.database_specific?.severity,
        })),
      });
    } catch (error) {
      results.push({ package: pkg, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

function runOutdated(pm, dir) {
  const argsByPm = {
    pnpm: ['outdated', '--format', 'json'],
    npm: ['outdated', '--json'],
    yarn: ['outdated', '--json'],
  };
  const args = argsByPm[pm] ?? argsByPm.npm;
  const result = spawnSync(pm, args, {
    cwd: dir,
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, FORCE_COLOR: '0' },
    timeout: 90_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const stdout = (result.stdout || '').trim();
  let parsed = null;
  if (stdout) {
    try {
      parsed = JSON.parse(stdout);
    } catch {
      // yarn may emit multiple JSON objects
    }
  }
  return {
    packageRoot: relative(cwd, dir) || '.',
    exitCode: result.status ?? 0,
    outdated: parsed,
    raw: parsed ? undefined : stdout.slice(0, 4000),
  };
}

async function main() {
  const scanRoot = resolveScanRoot();
  const pm = detectPackageManager(cwd);
  const roots = findPackageRoots(scanRoot);
  // Prefer root + first-level packages to keep runtime bounded
  const targets = roots.length <= 6 ? roots : [scanRoot, ...roots.filter((r) => r !== scanRoot).slice(0, 5)];

  const audits = targets.map((dir) => runAudit(pm, dir));
  const outdated = targets.slice(0, 3).map((dir) => runOutdated(pm, dir));

  const summaries = audits.map((a) => ({
    packageRoot: a.packageRoot,
    exitCode: a.exitCode,
    summary: summarizeReport(a.report),
    advisoryRefs: collectAdvisoryIds(a.report).slice(0, 20),
  }));

  const vulnerablePackages = [];
  for (const a of audits) {
    if (a.report?.vulnerabilities) {
      vulnerablePackages.push(...Object.keys(a.report.vulnerabilities));
    }
    if (a.report?.advisories) {
      vulnerablePackages.push(
        ...Object.values(a.report.advisories)
          .map(advisoryPackageName)
          .filter(Boolean)
      );
    }
  }

  const uniquePkgs = [...new Set(vulnerablePackages)].slice(0, MAX_OSV);
  let osv = [];
  if (uniquePkgs.length > 0 && process.env.MITII_SKIP_OSV !== '1') {
    osv = await enrichWithOsv(uniquePkgs);
  }

  const totalVulns = summaries.reduce((n, s) => n + (s.summary?.total ?? 0), 0);

  const output = {
    ok: true,
    kind: 'vulnerability-audit',
    packageManager: pm,
    workspace: cwd,
    requestedTarget: requestedTarget ? relative(cwd, scanRoot) || '.' : undefined,
    scannedRoots: targets.map((d) => relative(cwd, d) || '.'),
    totals: {
      vulnerabilityFindings: totalVulns,
      packagesWithAdvisories: uniquePkgs.length,
    },
    audits: summaries,
    outdated,
    osv,
    guidance: [
      'This is a read-only vulnerability audit (no lockfile changes).',
      'Use packageManager audit details + osv entries to prioritize upgrades.',
      'For unused-dependency cleanup use audit-dependencies.mjs instead.',
      'To apply upgrades, switch to Agent mode and run the package manager with explicit version bumps.',
      'Online advisory pages: https://github.com/advisories , https://osv.dev , https://www.npmjs.com/advisories',
    ],
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  // Exit 0 even when vulns found — the JSON payload is the contract; non-zero
  // would make execute_workspace_script look like a hard tool failure.
  process.exit(0);
}

main().catch((error) => {
  process.stdout.write(
    `${JSON.stringify({
      ok: false,
      kind: 'vulnerability-audit',
      error: error instanceof Error ? error.message : String(error),
    })}\n`
  );
  process.exit(0);
});
