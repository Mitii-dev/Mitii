import {
  initModeCatalog,
  loadModeProfiles,
  setActiveModeProfile,
} from '@mitii/host';
import type { SessionIo } from '../session.js';

export async function runProfileCommand(options: {
  cwd: string;
  args: string[];
  json?: boolean;
  io: SessionIo;
}): Promise<number> {
  const [sub = 'list', ...rest] = options.args.filter((a) => !a.startsWith('-'));
  const loaded = loadModeProfiles(options.cwd);

  if (sub === 'list' || sub === 'ls') {
    if (options.json) {
      options.io.writeStdout(
        `${JSON.stringify(
          {
            activeSlug: loaded.activeSlug ?? null,
            profiles: loaded.profiles.map((p) => ({
              slug: p.slug,
              name: p.name,
              agentMode: p.agentMode,
              source: p.source ?? 'builtin',
              active: p.slug === loaded.activeSlug,
            })),
          },
          null,
          2,
        )}\n`,
      );
      return 0;
    }
    options.io.writeStdout('Mode profiles (overlays on ask/plan/agent)\n\n');
    options.io.writeStdout(
      `Active: ${loaded.activeSlug ?? '(none — AgentMode from --mode / config)'}\n\n`,
    );
    for (const p of loaded.profiles) {
      const mark = p.slug === loaded.activeSlug ? '*' : ' ';
      options.io.writeStdout(
        `${mark} ${p.slug.padEnd(12)}  mode=${p.agentMode.padEnd(5)}  ${p.name}  [${p.source ?? 'builtin'}]\n`,
      );
      if (p.description) {
        options.io.writeStdout(`    ${p.description}\n`);
      }
    }
    options.io.writeStdout(
      '\nUse: mitii profile use <slug>   Clear: mitii profile clear\n',
    );
    return 0;
  }

  if (sub === 'show') {
    const slug = rest[0] ?? loaded.activeSlug;
    if (!slug) {
      options.io.writeStderr('mitii profile show: no active profile; pass a slug\n');
      return 2;
    }
    const profile = loaded.profiles.find((p) => p.slug === slug);
    if (!profile) {
      options.io.writeStderr(`mitii profile show: unknown slug "${slug}"\n`);
      return 2;
    }
    options.io.writeStdout(`${JSON.stringify(profile, null, 2)}\n`);
    return 0;
  }

  if (sub === 'use' || sub === 'set') {
    const slug = rest[0];
    if (!slug) {
      options.io.writeStderr('Usage: mitii profile use <slug>\n');
      return 2;
    }
    try {
      const { path } = setActiveModeProfile(options.cwd, slug);
      options.io.writeStdout(`Active profile → ${slug}\nWrote ${path}\n`);
      return 0;
    } catch (error) {
      options.io.writeStderr(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      return 2;
    }
  }

  if (sub === 'clear') {
    const { path } = setActiveModeProfile(options.cwd, undefined);
    options.io.writeStdout(`Cleared active profile\nWrote ${path}\n`);
    return 0;
  }

  if (sub === 'init') {
    const { path, created } = initModeCatalog(options.cwd);
    options.io.writeStdout(
      created
        ? `Created ${path}\n`
        : `Already exists: ${path}\n`,
    );
    return 0;
  }

  options.io.writeStderr(
    `Usage: mitii profile list|show [slug]|use <slug>|clear|init\n`,
  );
  return 2;
}
