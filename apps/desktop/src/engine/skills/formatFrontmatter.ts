/**
 * Format skill frontmatter via the active profile LLM (internal recipe).
 * Preserves playbook body; falls back to deterministic frontmatter on failure.
 */

import {
  createHostLlmPorts,
  getProviderPreset,
  inferHostProviderType,
  isHostProviderType,
  normalizeOllamaModelId,
  resolveProviderApiKey,
} from '@mitii/host';
import type { LlmPort, ModelRequest } from '@mitii/sdk';

import {
  buildSkillFrontmatterPrompt,
  composeSkillMarkdown,
  fallbackSkillFrontmatter,
  normalizeSkillId,
  parseFrontmatterFromModelText,
  splitSkillMarkdown,
  type SkillFrontmatterFields,
} from './frontmatterRecipe.js';
import {
  readProfiles,
  type DesktopProfile,
  type DesktopProfileProvider,
} from '../profiles.js';

export interface FormatSkillFrontmatterResult {
  id: string;
  title: string;
  description: string;
  body: string;
  frontmatterYaml: string;
  markdown: string;
  usedAi: boolean;
  recipeId: string;
  profileId: string;
  profileName: string;
}

function fallbackProviderFromEnv(): DesktopProfileProvider {
  const type = process.env.MITII_PROVIDER?.trim() || 'ollama';
  return {
    type,
    preset: process.env.MITII_PROVIDER_PRESET?.trim() || type,
    baseUrl: process.env.MITII_BASE_URL?.trim() || '',
    model: process.env.MITII_MODEL?.trim() || '',
    contextWindow: Number(process.env.MITII_CONTEXT_WINDOW ?? 0) || 0,
    maximumOutputTokens:
      Number(process.env.MITII_MAXIMUM_OUTPUT_TOKENS ?? 0) || 0,
  };
}

/** Require a selected active profile before creating/saving skills. */
export function requireActiveDesktopProfile(workspaceRoot: string): {
  profile: DesktopProfile;
  file: ReturnType<typeof readProfiles>;
} {
  const file = readProfiles(workspaceRoot, fallbackProviderFromEnv());
  const profile =
    file.profiles.find((p) => p.id === file.activeProfileId) ??
    file.profiles[0];
  if (!profile) {
    throw new Error('active_profile_required');
  }
  return { profile, file };
}

async function collectLlmText(llm: LlmPort, request: ModelRequest): Promise<string> {
  let text = '';
  for await (const event of llm.complete(request)) {
    if (event.type === 'content_delta' && typeof event.content === 'string') {
      text += event.content;
    }
  }
  return text.trim();
}

function createProfileLlm(profile: DesktopProfile): {
  llm: LlmPort;
  forceEcho: boolean;
} {
  const env = process.env;
  const typeRaw = profile.provider.type || env.MITII_PROVIDER || 'openai-compatible';
  const type = isHostProviderType(typeRaw)
    ? typeRaw
    : inferHostProviderType(env) ?? 'openai-compatible';
  const forceEcho =
    env.MITII_FORCE_ECHO === '1' ||
    env.MITII_FORCE_ECHO === 'true' ||
    type === 'echo';
  if (forceEcho) {
    return {
      forceEcho: true,
      llm: createHostLlmPorts({
        type: 'echo',
        model: 'echo',
      }).understandingLlm,
    };
  }
  const presetId =
    profile.provider.preset ||
    env.MITII_PROVIDER_PRESET ||
    (type === 'openai-compatible' ? 'ollama' : type);
  const preset = getProviderPreset(presetId);
  const baseUrl =
    profile.provider.baseUrl ||
    env.MITII_BASE_URL ||
    preset?.baseUrl ||
    '';
  const model = normalizeOllamaModelId(
    profile.provider.model || env.MITII_MODEL || preset?.model || 'gpt-4o-mini',
    baseUrl,
  );
  const apiKey = resolveProviderApiKey({ type, env });
  const ports = createHostLlmPorts({
    type,
    preset: presetId,
    model,
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
    capabilities: {
      supportsTools: false,
      maximumOutputTokens: 1200,
    },
  });
  return { llm: ports.understandingLlm, forceEcho: false };
}

export async function formatSkillFrontmatterWithAi(input: {
  workspaceRoot: string;
  markdownOrBody: string;
  nameHint?: string;
  titleHint?: string;
  descriptionHint?: string;
  /** When false, skip LLM and use deterministic fallback. */
  useAi?: boolean;
}): Promise<FormatSkillFrontmatterResult> {
  const { profile } = requireActiveDesktopProfile(input.workspaceRoot);
  const split = splitSkillMarkdown(input.markdownOrBody);
  const body =
    split.body.trim() ||
    '# Skill\n\nDescribe what this skill should do.\n';

  let fields: SkillFrontmatterFields = fallbackSkillFrontmatter({
    nameHint: input.nameHint,
    titleHint: input.titleHint,
    descriptionHint: input.descriptionHint,
    body,
  });
  let usedAi = false;

  if (input.useAi !== false) {
    const { llm, forceEcho } = createProfileLlm(profile);
    if (!forceEcho) {
      try {
        const prompt = buildSkillFrontmatterPrompt({
          nameHint: input.nameHint || fields.name,
          titleHint: input.titleHint || fields.title,
          descriptionHint: input.descriptionHint || fields.description,
          body,
          existingYaml: split.frontmatterYaml,
        });
        const raw = await collectLlmText(llm, {
          model: profile.provider.model || 'default',
          messages: [{ role: 'user', content: prompt }],
          stream: false,
        });
        const parsed = parseFrontmatterFromModelText(raw);
        if (parsed) {
          fields = {
            ...parsed,
            name: input.nameHint
              ? fields.name
              : parsed.name || fields.name,
            title: input.titleHint?.trim() || parsed.title,
            description:
              input.descriptionHint?.trim() || parsed.description,
          };
          usedAi = true;
        }
      } catch {
        // Keep deterministic fallback.
      }
    }
  }

  if (input.nameHint?.trim()) {
    fields = {
      ...fields,
      name: normalizeSkillId(input.nameHint) || fields.name,
    };
  }

  const markdown = composeSkillMarkdown(fields, body);
  const yaml = splitSkillMarkdown(markdown).frontmatterYaml ?? '';
  return {
    id: fields.name,
    title: fields.title,
    description: fields.description,
    body,
    frontmatterYaml: yaml,
    markdown,
    usedAi,
    recipeId: 'skill-frontmatter',
    profileId: profile.id,
    profileName: profile.name,
  };
}
