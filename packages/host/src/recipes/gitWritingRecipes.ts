import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Product recipes that force-attach a bundled writing skill. */
export const MITII_WRITING_RECIPE_IDS = [
  'commit-message',
  'pr-summary',
  'changelog',
] as const;

export type MitiiWritingRecipeId = (typeof MITII_WRITING_RECIPE_IDS)[number];

export interface MitiiWritingRecipe {
  id: MitiiWritingRecipeId;
  /** Bundled skill id under packages/sdk/skills/<id>. */
  skillId: string;
  title: string;
  /** CLI subcommand alias for this recipe. */
  command: string;
}

export const MITII_WRITING_RECIPES: readonly MitiiWritingRecipe[] = [
  {
    id: 'commit-message',
    skillId: 'git-commit-message',
    title: 'Git commit message',
    command: 'commit-message',
  },
  {
    id: 'pr-summary',
    skillId: 'git-pr-summary',
    title: 'Git PR summary',
    command: 'pr-summary',
  },
  {
    id: 'changelog',
    skillId: 'release-changelog',
    title: 'Release changelog',
    command: 'changelog',
  },
] as const;

const RECIPE_BY_ID = new Map(
  MITII_WRITING_RECIPES.map((recipe) => [recipe.id, recipe]),
);
const RECIPE_BY_COMMAND = new Map(
  MITII_WRITING_RECIPES.map((recipe) => [recipe.command, recipe]),
);

export function isMitiiWritingRecipeId(
  value: string,
): value is MitiiWritingRecipeId {
  return RECIPE_BY_ID.has(value as MitiiWritingRecipeId);
}

export function resolveMitiiWritingRecipe(
  idOrCommand: string,
): MitiiWritingRecipe | undefined {
  return (
    RECIPE_BY_ID.get(idOrCommand as MitiiWritingRecipeId) ??
    RECIPE_BY_COMMAND.get(idOrCommand)
  );
}

const MAX_SECTION_CHARS = 12_000;

export type CommitMessageStyle = 'conventional' | 'plain';

export interface BuildWritingRecipeAskOptions {
  workspaceRoot: string;
  recipe: MitiiWritingRecipeId | string;
  /** Commit-message style hint (VS Code setting / CLI). Default conventional. */
  commitMessageStyle?: CommitMessageStyle;
  /** Optional extra user note appended to the prompt. */
  userNote?: string;
  /** Override base ref for PR/changelog (default: origin/HEAD || main || master). */
  baseRef?: string;
}

export interface WritingRecipeAsk {
  recipe: MitiiWritingRecipe;
  prompt: string;
  requiredSkillIds: string[];
  mode: 'ask';
  /** Short label for UI / logs. */
  label: string;
}

async function runGit(
  cwd: string,
  args: string[],
  timeoutMs = 15_000,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      encoding: 'utf8',
    });
    return stdout.trim();
  } catch {
    return '';
  }
}

function clip(text: string, max = MAX_SECTION_CHARS): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n…(truncated)`;
}

async function gitRefExists(cwd: string, ref: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['rev-parse', '--verify', '--quiet', ref], {
      cwd,
      timeout: 10_000,
      encoding: 'utf8',
    });
    return true;
  } catch {
    return false;
  }
}

async function resolveDefaultBaseRef(
  cwd: string,
  override?: string,
): Promise<string> {
  if (override?.trim()) {
    return override.trim();
  }
  const symbolic = await runGit(cwd, [
    'symbolic-ref',
    '--short',
    'refs/remotes/origin/HEAD',
  ]);
  if (symbolic && (await gitRefExists(cwd, symbolic))) {
    return symbolic;
  }
  for (const candidate of ['origin/main', 'main', 'origin/master', 'master']) {
    if (await gitRefExists(cwd, candidate)) {
      return candidate;
    }
  }
  return 'HEAD~20';
}

export async function collectGitWritingContext(options: {
  workspaceRoot: string;
  recipeId: MitiiWritingRecipeId;
  baseRef?: string;
}): Promise<string> {
  const cwd = options.workspaceRoot;
  const status = await runGit(cwd, ['status', '--porcelain', '-b']);
  const log = await runGit(cwd, ['log', '-8', '--oneline']);
  const staged = await runGit(cwd, ['diff', '--staged']);
  const unstaged = await runGit(cwd, ['diff']);

  const sections: string[] = [
    '### git status',
    clip(status || '(unable to read git status)'),
    '### recent commits',
    clip(log || '(no commits)'),
  ];

  if (staged) {
    sections.push('### staged diff', clip(staged));
  }
  if (unstaged) {
    sections.push('### unstaged diff', clip(unstaged));
  }
  if (!staged && !unstaged) {
    sections.push('### diff', '(working tree clean — no local diff)');
  }

  if (
    options.recipeId === 'pr-summary' ||
    options.recipeId === 'changelog'
  ) {
    const base = await resolveDefaultBaseRef(cwd, options.baseRef);
    const rangeLog = await runGit(cwd, [
      'log',
      '--oneline',
      `${base}..HEAD`,
    ]);
    const rangeDiffStat = await runGit(cwd, [
      'diff',
      '--stat',
      `${base}...HEAD`,
    ]);
    const rangeDiff = await runGit(cwd, ['diff', `${base}...HEAD`]);
    sections.push(
      `### commits since ${base}`,
      clip(rangeLog || '(none)'),
      `### diff --stat since ${base}`,
      clip(rangeDiffStat || '(none)'),
      `### diff since ${base}`,
      clip(rangeDiff || '(none)'),
    );

    if (options.recipeId === 'changelog') {
      const lastTag = await runGit(cwd, [
        'describe',
        '--tags',
        '--abbrev=0',
      ]);
      if (lastTag) {
        const sinceTagLog = await runGit(cwd, [
          'log',
          '--oneline',
          `${lastTag}..HEAD`,
        ]);
        sections.push(
          `### commits since tag ${lastTag}`,
          clip(sinceTagLog || '(none)'),
        );
      } else {
        sections.push('### last tag', '(no tags found)');
      }
    }
  }

  return sections.join('\n\n');
}

function styleHint(style: CommitMessageStyle | undefined): string {
  if (style === 'plain') {
    return 'Use a plain short subject line (no Conventional Commits type prefix).';
  }
  return 'Use Conventional Commits: type(scope): subject.';
}

function recipeTaskLine(
  recipe: MitiiWritingRecipe,
  commitMessageStyle?: CommitMessageStyle,
): string {
  switch (recipe.id) {
    case 'commit-message':
      return `Write a concise git commit message for this repository.\n${styleHint(commitMessageStyle)}\nReply with ONLY the raw commit message text (subject line, optional blank line, optional body). Do not wrap in markdown fences.`;
    case 'pr-summary':
      return 'Write a compact pull-request body for these changes.\nReply with ONLY markdown containing ## Summary and ## Test plan.';
    case 'changelog':
      return 'Write a Keep a Changelog section for these changes.\nReply with ONLY the changelog markdown section (## [version] …).';
    default:
      return `Complete the ${recipe.title} task. Reply with only the final artifact.`;
  }
}

/** Strip optional markdown fences from a model answer (commit messages). */
export function unwrapRecipeAnswer(answer: string): string {
  const trimmed = answer.trim();
  const fenced = trimmed.match(/^```(?:\w+)?\r?\n([\s\S]*?)\r?\n```$/);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  return trimmed;
}

/**
 * Build an ask prompt + forced skill attachment for a writing recipe.
 * Used by VS Code SCM helpers and CLI recipe/subcommands.
 */
export async function buildWritingRecipeAsk(
  options: BuildWritingRecipeAskOptions,
): Promise<WritingRecipeAsk> {
  const recipe = resolveMitiiWritingRecipe(options.recipe);
  if (!recipe) {
    throw new Error(
      `Unknown Mitii writing recipe "${options.recipe}". Expected one of: ${MITII_WRITING_RECIPE_IDS.join(', ')}`,
    );
  }

  const context = await collectGitWritingContext({
    workspaceRoot: options.workspaceRoot,
    recipeId: recipe.id,
    baseRef: options.baseRef,
  });

  const note = options.userNote?.trim();
  const prompt = [
    recipeTaskLine(recipe, options.commitMessageStyle),
    note ? `User note:\n${note}` : undefined,
    'Git context:',
    context,
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    recipe,
    prompt,
    requiredSkillIds: [recipe.skillId],
    mode: 'ask',
    label: recipe.title,
  };
}
