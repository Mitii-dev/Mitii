import { loadMitiiHostConfig } from '../config.js';
import { createTermStyle } from '../termStyle.js';
import type { SessionIo } from '../session.js';
import {
  detectGitWorkspace,
  ensureAgentsMarkdown,
  ensureMitiiGitignore,
  ensureMitiiWorkspace,
} from '../workspaceBootstrap.js';
import { runIndex } from './index.js';

export interface RunInitOptions {
  cwd: string;
  /** Skip confirmation prompts. */
  yes?: boolean;
  /** Do not run workspace index after bootstrap. */
  noIndex?: boolean;
  /** Skip .gitignore updates. */
  noGitignore?: boolean;
  /** Create AGENTS.md when missing. */
  agents?: boolean;
  forceEcho?: boolean;
  io: SessionIo;
}

/**
 * Bootstrap a workspace for Mitii: `.mitii/` layout, ignore rules, optional
 * project brief, then repository index.
 */
export async function runInit(options: RunInitOptions): Promise<number> {
  const { io, cwd } = options;
  const style = createTermStyle(process.stderr);
  const git = detectGitWorkspace(cwd);
  const config = loadMitiiHostConfig(cwd);

  io.writeStdout(`\n${style.brand('Mitii')} ${style.bold('workspace init')}\n`);
  io.writeStdout(`${style.rule(48)}\n`);
  io.writeStdout(`  ${style.label('Workspace')} ${cwd}\n`);
  io.writeStdout(
    `  ${style.label('Git')} ${git.present ? style.ok('detected') : style.warn('not detected')}\n`,
  );
  io.writeStdout(
    `  ${style.label('Provider')} ${config.providerPreset ?? config.provider ?? style.muted('(unset — run mitii setup)')}\n`,
  );
  io.writeStdout(`${style.rule(48)}\n`);

  if (!options.yes) {
    const answer = (
      await io.prompt('Initialize this workspace for Mitii? [Y/n]: ')
    )
      .trim()
      .toLowerCase();
    if (answer === 'n' || answer === 'no') {
      io.writeStderr('init cancelled\n');
      return 1;
    }
  }

  const workspace = ensureMitiiWorkspace(cwd);
  io.writeStdout(
    `  ${style.ok('✓')} workspace  ${style.muted(workspace.mitiiDir)}\n`,
  );
  if (workspace.createdDirs.length > 0) {
    io.writeStdout(
      `  ${style.muted(`created ${workspace.createdDirs.length} director${workspace.createdDirs.length === 1 ? 'y' : 'ies'}`)}\n`,
    );
  }
  io.writeStdout(
    `  ${style.ok('✓')} modes     ${style.muted(workspace.modesCatalog.path)}${workspace.modesCatalog.created ? style.muted(' (created)') : ''}\n`,
  );

  if (!options.noGitignore) {
    let doGitignore = true;
    if (!options.yes) {
      const answer = (
        await io.prompt(
          'Add .mitii/ and .env* to .gitignore? [Y/n]: ',
        )
      )
        .trim()
        .toLowerCase();
      if (answer === 'n' || answer === 'no') doGitignore = false;
    }
    if (doGitignore) {
      const ignore = ensureMitiiGitignore(cwd);
      if (ignore.added.length > 0) {
        io.writeStdout(
          `  ${style.ok('✓')} gitignore ${style.muted(ignore.added.join(', '))}\n`,
        );
      } else {
        io.writeStdout(
          `  ${style.muted('·')} gitignore already covers Mitii paths\n`,
        );
      }
    }
  }

  const wantAgents =
    options.agents === true ||
    (!options.yes &&
      (
        await io.prompt('Create AGENTS.md project brief if missing? [y/N]: ')
      )
        .trim()
        .toLowerCase()
        .startsWith('y'));

  if (wantAgents) {
    const agents = ensureAgentsMarkdown(cwd);
    io.writeStdout(
      agents.created
        ? `  ${style.ok('✓')} AGENTS.md ${style.muted(agents.path)} (created)\n`
        : `  ${style.muted('·')} AGENTS.md already present\n`,
    );
  }

  if (!options.noIndex) {
    io.writeStdout(`\n${style.bold('Indexing repository…')}\n`);
    const code = await runIndex({
      cwd,
      json: false,
      forceEcho: options.forceEcho === true,
      io,
    });
    if (code !== 0) {
      io.writeStderr(
        `${style.warn('Index finished with issues.')} ${style.muted('Run mitii index --status for details.')}\n`,
      );
      return code;
    }
  }

  io.writeStdout(`\n${style.ok('Workspace ready.')}\n`);
  io.writeStdout(`${style.muted('Next:')}\n`);
  if (!config.provider && !config.providerPreset) {
    io.writeStdout(`  ${style.brand('mitii setup')}\n`);
  }
  io.writeStdout(`  ${style.brand('mitii session')}\n`);
  io.writeStdout(`  ${style.brand('mitii ask')} "Summarize this repository"\n`);
  return 0;
}
