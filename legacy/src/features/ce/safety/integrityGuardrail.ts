import { isDeleteLikeCommand } from './ToolPolicyEngine';

/**
 * Detects requests that ask the agent to remove a safeguard (tests, docs describing a known
 * problem, a security control) where the stated reason is convenience/annoyance rather than
 * the safeguard being wrong — e.g. "delete every test so CI runs faster", "delete TODO.md so
 * nobody notices", "the constant-time comparison is overkill". These read as legitimate,
 * single-step instructions to a compliant model, but complying causes real harm (a masked
 * regression, a hidden known bug, a timing-attack-vulnerable comparison). The task is still
 * done — the agent should explain why it's declining the specific destructive step and, where
 * possible, propose the safe alternative — not silently refuse the whole request.
 */
export interface IntegrityGuardrailFlag {
  reason:
    | 'test_deletion_for_convenience'
    | 'concealment_request'
    | 'security_control_weakening'
    | 'git_history_rewrite';
  guidance: string;
  /** Only set when a concrete code symbol was named (e.g. timingSafeEqual) — enables a
   *  precise deterministic block on patches that delete it, instead of just a prompt nudge. */
  protectedSymbol?: string;
}

const TEST_GUTTING = /\b(?:delete|remove)\s+(?:all|every|any)\b[\s\S]{0,40}\btest(?:s|\s+files?)?\b/i;
const SPEED_OR_ANNOYANCE_RATIONALE =
  /\b(?:so\s+ci\s+runs?\s+faster|to\s+speed\s+up\s+ci|tests?\s+(?:are\s+)?annoying|slow(?:ing)?\s+(?:things|it)\s+down|slows?\s+(?:things|it)\s+down)\b/i;
const NO_CONFIRM_OVERRIDE = /\bdon'?t\s+ask\s+me\s+first\b|\bno\s+need\s+to\s+(?:ask|confirm)\b|\bwithout\s+asking\b/i;

const CONCEALMENT_ACTION =
  /\b(?:delete|remove)\b[\s\S]{0,60}\bso\s+(?:that\s+)?(?:nobody|no\s*one)\s+(?:notices|knows|finds\s+out)\b|\bto\s+hide\b[\s\S]{0,30}\b(?:the\s+)?(?:fact|problem|issue|bug|bugs)\b|\bcover(?:s|ed|ing)?\s+up\b/i;

const GIT_HISTORY_REWRITE =
  /\bsquash(?:ed|ing)?\b[\s\S]{0,60}\b(?:git\s+)?history\b|\brewrite\s+(?:git\s+)?history\b|\bforce[- ]push\b[\s\S]{0,30}\b(?:over|to|onto)\s+(?:main|master|origin\/main|origin\/master)\b|\bfilter[- ](?:branch|repo)\b/i;

const SECURITY_CONTROL_MENTION =
  /\b(timingSafeEqual|constant[- ]time comparison|rate limit(?:er|ing)?|CORS|class-validator|validation decorators?|auth(?:entication)? check|signature (?:check|verification))\b/i;
const SECURITY_SYMBOL_TARGET = /\b(timingSafeEqual)\b/;
const DISMISSIVE_RATIONALE =
  /\b(?:overkill|annoying|slows?\s+(?:things|it)\s+down|for\s+now,?\s+we'?ll\s+add\s+it\s+back|just\s+for\s+our\s+use\s+case|not\s+(?:really\s+)?necessary|don'?t\s+need\s+(?:it|that)\b)/i;

export function detectIntegrityGuardrail(text: string): IntegrityGuardrailFlag | null {
  if (GIT_HISTORY_REWRITE.test(text)) {
    return {
      reason: 'git_history_rewrite',
      guidance:
        'The user asked to rewrite/squash shared git history and force-push over a shared branch (main/master). ' +
        'This is a destructive, hard-to-reverse operation on shared history. Decline to perform it. ' +
        "Explain the risk and suggest a safe alternative (e.g. a non-destructive squash-merge via a pull request, or doing this only on a private branch with the team's explicit sign-off).",
    };
  }

  if (TEST_GUTTING.test(text) && (SPEED_OR_ANNOYANCE_RATIONALE.test(text) || NO_CONFIRM_OVERRIDE.test(text))) {
    return {
      reason: 'test_deletion_for_convenience',
      guidance:
        'The user asked to delete test files to make CI faster or avoid a failing check, not because the tests are obsolete. ' +
        'Decline to delete them. If a specific test is genuinely obsolete or wrong, say so and propose fixing or removing only that test with justification.',
    };
  }

  if (CONCEALMENT_ACTION.test(text)) {
    return {
      reason: 'concealment_request',
      guidance:
        'The user asked to delete or hide files that document a known problem so it goes unnoticed. ' +
        'Decline to delete them. Offer to actually address the underlying issue instead.',
    };
  }

  const symbolMatch = SECURITY_SYMBOL_TARGET.exec(text);
  if (SECURITY_CONTROL_MENTION.test(text) && DISMISSIVE_RATIONALE.test(text)) {
    return {
      reason: 'security_control_weakening',
      guidance:
        'The user asked to remove or weaken a real security control (e.g. a constant-time comparison, rate limiting, a CORS restriction, an auth check, input validation) for convenience, not because it is wrong. ' +
        'Explain why the control matters and decline to remove it as requested; offer a safer alternative (e.g. a test-only bypass) instead of a permanent downgrade.',
      protectedSymbol: symbolMatch?.[1],
    };
  }

  return null;
}

const TEST_PATH = /(?:\.(?:spec|test)\.[jt]sx?\b)|(?:(?:^|[\s/'"`])(?:tests?|__tests__)\/)/i;

/** Any structured git write tool except the clearly read-only ones. */
const GIT_WRITE_TOOL = /^git_(?!status\b|log\b|show\b|diff\b|blame\b|compare_branches\b|tag_list\b)\w*/;
const GIT_WRITE_COMMAND = /^\s*git\s+(?!status\b|log\b|show\b|diff\b|blame\b)/i;

function extractConcealedFileTargets(text: string): string[] {
  const matches = text.match(/\b[\w.-]+\.(?:md|txt|json|ya?ml|log)\b/gi) ?? [];
  return Array.from(new Set(matches));
}

function integrityBlockMessage(flag: IntegrityGuardrailFlag, detail: string): string {
  return [
    `INTEGRITY_GUARDRAIL: ${detail}`,
    flag.guidance,
    'Do not retry this action or find another way to accomplish it. Respond to the user explaining why you are declining, and propose the safer alternative instead.',
  ].join(' ');
}

/** Returns a block reason if this specific tool call would carry out the flagged action. */
export function checkIntegrityGuardrailBlock(
  flag: IntegrityGuardrailFlag,
  toolName: string,
  input: Record<string, unknown>,
  originalTask: string
): string | null {
  const command = toolName === 'run_command' && typeof input.command === 'string' ? input.command : undefined;
  const path = typeof input.path === 'string' ? input.path : undefined;

  if (flag.reason === 'test_deletion_for_convenience') {
    if (command && isDeleteLikeCommand(command) && TEST_PATH.test(command)) {
      return integrityBlockMessage(flag, `\`${command.trim()}\` would delete test file(s).`);
    }
    if ((toolName === 'write_file' || toolName === 'apply_patch') && path && TEST_PATH.test(path)) {
      return integrityBlockMessage(flag, `Editing ${path} here is a way to gut/delete this test file.`);
    }
    return null;
  }

  if (flag.reason === 'concealment_request') {
    const protectedFiles = extractConcealedFileTargets(originalTask);
    if (protectedFiles.length === 0) return null;
    if (command && isDeleteLikeCommand(command) && protectedFiles.some((f) => command.includes(f))) {
      return integrityBlockMessage(flag, `\`${command.trim()}\` would delete a file the user asked to conceal.`);
    }
    if (
      (toolName === 'write_file' || toolName === 'apply_patch') &&
      path &&
      protectedFiles.some((f) => path.endsWith(f))
    ) {
      return integrityBlockMessage(flag, `Modifying ${path} here would remove content the user asked to conceal.`);
    }
    return null;
  }

  if (flag.reason === 'security_control_weakening' && flag.protectedSymbol && toolName === 'apply_patch') {
    const oldText = typeof input.oldText === 'string' ? input.oldText : '';
    const newText = typeof input.newText === 'string' ? input.newText : '';
    if (oldText.includes(flag.protectedSymbol) && !newText.includes(flag.protectedSymbol)) {
      return integrityBlockMessage(flag, `This patch removes \`${flag.protectedSymbol}\` from the security check.`);
    }
    return null;
  }

  if (flag.reason === 'git_history_rewrite') {
    if (GIT_WRITE_TOOL.test(toolName)) {
      return integrityBlockMessage(flag, `\`${toolName}\` would carry out part of the requested history rewrite/force-push.`);
    }
    if (command && GIT_WRITE_COMMAND.test(command)) {
      return integrityBlockMessage(flag, `\`${command.trim()}\` would carry out part of the requested history rewrite/force-push.`);
    }
    return null;
  }

  return null;
}
