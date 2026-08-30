/** Client-side context-window preview (mirrors live derive capacity math). */

export function mergePolicy(base, overlay) {
  return { ...base, ...(overlay ?? {}) };
}

export function previewBudget(contextWindowTokens, baseWindow, windowOverlay) {
  const p = mergePolicy(baseWindow, windowOverlay);
  const W = Math.max(1, Math.floor(contextWindowTokens));
  const outputReserve = Math.max(
    Math.floor(p.outputMinTokens ?? 10_240),
    Math.floor(W * (p.outputRatio ?? 0.2)),
  );
  const cappedOutput = Math.min(
    outputReserve,
    Math.floor(W * (p.outputWindowCapRatio ?? 0.35)),
    Math.max(1, W - 1),
  );
  const toolFallback = Math.min(
    p.toolSchemaFallbackTokens ?? 8_000,
    Math.floor(W * (p.toolSchemaFallbackWindowRatio ?? 0.2)),
  );
  const afterOutput = Math.max(0, W - cappedOutput);
  const tools = Math.min(
    toolFallback,
    Math.max(0, afterOutput - (p.minimumUsableInputTokens ?? 2_048)),
  );
  let usable = Math.max(0, afterOutput - tools);
  if (usable < (p.minimumUsableInputTokens ?? 2_048)) {
    usable = Math.min(p.minimumUsableInputTokens ?? 2_048, afterOutput);
  }

  const repository = Math.min(
    p.repositoryTokensCap ?? 64_000,
    Math.floor(usable * (p.repositoryShare ?? 0.28)),
  );
  const conversation = Math.floor(usable * (p.conversationShare ?? 0.4));
  const plan = Math.min(
    p.planTokensCap ?? 16_000,
    Math.max(1, Math.floor(usable * (p.planShare ?? 0.06))),
  );
  const skills = Math.min(
    p.skillsTokensCap ?? 8_000,
    Math.max(1, Math.floor(usable * (p.skillsShare ?? 0.04))),
  );
  const allocated = repository + conversation + plan + skills;
  const free = Math.max(0, usable - allocated);

  const windowFiles = Math.floor(
    (W * (p.outputRatio ?? 0.2)) / Math.max(1, p.filesPerOutputTokens ?? 800),
  );
  const filesBeforeEffort = Math.min(
    Math.floor(p.maxUniqueFilesPerCallCap ?? 48),
    Math.max(Math.floor(p.minUniqueFilesPerCall ?? 2), windowFiles),
  );
  const files = Math.min(filesBeforeEffort, 8);
  const maxSkills = Math.min(
    Math.floor(p.maxSkillsCap ?? 4),
    Math.max(
      Math.floor(p.maxSkillsBase ?? 2),
      Math.floor(usable / Math.max(1, p.maxSkillsPerUsable ?? 12_000)),
    ),
  );
  const verify = Math.min(
    Math.floor(p.verificationChecksMax ?? 16),
    Math.max(
      Math.floor(p.verificationChecksBase ?? 2),
      Math.floor(usable / Math.max(1, p.verificationChecksPerUsable ?? 40_000)),
    ),
  );

  const shareSum =
    (p.repositoryShare ?? 0) +
    (p.conversationShare ?? 0) +
    (p.planShare ?? 0) +
    (p.skillsShare ?? 0);

  return {
    contextWindowTokens: W,
    maximumOutputTokens: cappedOutput,
    toolSchemaTokens: tools,
    usableInputTokens: usable,
    repositoryTokens: repository,
    conversationTokens: conversation,
    planTokens: plan,
    skillsTokens: skills,
    freeTokens: free,
    maxUniqueFilesPerCall: files,
    maxUniqueFilesBeforeEffort: filesBeforeEffort,
    maxSkills,
    maxVerificationChecks: verify,
    usableShareSum: shareSum,
    freeUsableShare: Math.max(0, 1 - shareSum),
    slices: [
      { id: 'output', label: 'Output', tokens: cappedOutput, color: '#c5926b' },
      { id: 'tools', label: 'Tool schemas', tokens: tools, color: '#8b7bb8' },
      {
        id: 'repository',
        label: 'Repository',
        tokens: repository,
        color: '#6f9b7a',
      },
      {
        id: 'conversation',
        label: 'Conversation',
        tokens: conversation,
        color: '#6f8794',
      },
      { id: 'plan', label: 'Plan', tokens: plan, color: '#8da2fb' },
      { id: 'skills', label: 'Skills', tokens: skills, color: '#c4a35a' },
      { id: 'free', label: 'Free', tokens: free, color: '#d6d3d1' },
    ],
  };
}

export function pctOf(part, whole) {
  if (!whole || !Number.isFinite(part)) return 0;
  return part / whole;
}

export function formatPct(ratio) {
  return `${Math.round((Number.isFinite(ratio) ? ratio : 0) * 1000) / 10}%`;
}

export function formatTokens(n) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.floor(n || 0)));
}
