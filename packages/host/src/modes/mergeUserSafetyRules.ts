import {
  DISABLED_USER_SAFETY_RULES,
  type UserSafetyRules,
} from "@mitii/v8";

/**
 * Merge tighten-only safety rule fragments (workspace + mode + hooks).
 * Union of deny lists; first non-empty approvalCeiling / regex / autoApprove wins
 * by preference order (later args override earlier for scalar fields).
 */
export function mergeUserSafetyRules(
  ...parts: Array<UserSafetyRules | undefined>
): UserSafetyRules {
  const enabledParts = parts.filter(
    (part): part is UserSafetyRules => part !== undefined && part.enabled,
  );
  if (enabledParts.length === 0) {
    return { ...DISABLED_USER_SAFETY_RULES };
  }

  const denyTools = unique([
    ...enabledParts.flatMap((part) => part.denyTools),
  ]);
  const denyCommandPrefixes = unique([
    ...enabledParts.flatMap((part) => part.denyCommandPrefixes),
  ]);
  const denyPathScopes = unique([
    ...enabledParts.flatMap((part) => part.denyPathScopes),
  ]);
  const denyNetworkHosts = unique([
    ...enabledParts.flatMap((part) => part.denyNetworkHosts),
  ]);
  const protectedPathGlobs = unique([
    ...enabledParts.flatMap((part) => part.protectedPathGlobs ?? []),
  ]);

  const allowCommandPrefixes = unique([
    ...enabledParts.flatMap((part) => part.allowCommandPrefixes ?? []),
  ]);

  let approvalCeiling = enabledParts[0]?.approvalCeiling;
  let mutationRelativePathRegex =
    enabledParts[0]?.mutationRelativePathRegex;
  let autoApprove = enabledParts[0]?.autoApprove;
  for (const part of enabledParts.slice(1)) {
    if (part.approvalCeiling) {
      approvalCeiling = part.approvalCeiling;
    }
    if (part.mutationRelativePathRegex) {
      mutationRelativePathRegex = part.mutationRelativePathRegex;
    }
    if (part.autoApprove) {
      autoApprove = { ...autoApprove, ...part.autoApprove };
    }
  }

  return {
    enabled: true,
    denyTools,
    denyCommandPrefixes,
    denyPathScopes,
    denyNetworkHosts,
    protectedPathGlobs,
    ...(allowCommandPrefixes.length > 0 ? { allowCommandPrefixes } : {}),
    ...(approvalCeiling ? { approvalCeiling } : {}),
    ...(mutationRelativePathRegex ? { mutationRelativePathRegex } : {}),
    ...(autoApprove ? { autoApprove } : {}),
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
