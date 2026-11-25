import { MemoryContentPolicy } from "../../rules/contentPolicy";
import type {
  MemoryFact,
  MemoryOmission,
  MemoryScope,
} from "../../types";

/**
 * Flow step 1: drop out-of-scope / stale / private / superseded facts.
 */
export function filterMemoryCandidates(params: {
  facts: readonly MemoryFact[];
  scope: MemoryScope;
  requesterUserId?: string;
  origin?: "user" | "automation" | "delegated";
  now: Date;
}): {
  candidates: MemoryFact[];
  omissions: MemoryOmission[];
  staleFiltered: boolean;
  privacyFiltered: boolean;
  supersededFiltered: boolean;
} {
  const omissions: MemoryOmission[] = [];
  const candidates: MemoryFact[] = [];
  let staleFiltered = false;
  let privacyFiltered = false;
  let supersededFiltered = false;

  for (const fact of params.facts) {
    if (!scopesCompatible(fact.scope, params.scope)) {
      omissions.push({ memoryId: fact.id, reason: "scope_mismatch" });
      continue;
    }

    if (fact.isLatest === false) {
      omissions.push({ memoryId: fact.id, reason: "superseded" });
      supersededFiltered = true;
      continue;
    }

    if (
      fact.validation === "needs_revalidation" ||
      (fact.expiresAt &&
        new Date(fact.expiresAt).getTime() <= params.now.getTime())
    ) {
      omissions.push({ memoryId: fact.id, reason: "stale" });
      staleFiltered = true;
      continue;
    }

    if (
      fact.privacy === "private" &&
      (!fact.scope.userId ||
        !params.requesterUserId ||
        fact.scope.userId !== params.requesterUserId ||
        params.origin === "automation" ||
        params.origin === "delegated")
    ) {
      omissions.push({ memoryId: fact.id, reason: "privacy" });
      privacyFiltered = true;
      continue;
    }

    if (!fact.content.trim()) {
      continue;
    }

    candidates.push(new MemoryContentPolicy().fact(fact));
  }

  return {
    candidates,
    omissions,
    staleFiltered,
    privacyFiltered,
    supersededFiltered,
  };
}

function scopesCompatible(fact: MemoryScope, request: MemoryScope): boolean {
  if (fact.kind !== request.kind) {
    return false;
  }
  if (fact.kind === "user") {
    return fact.userId === request.userId;
  }
  if (fact.kind === "workspace") {
    return fact.workspaceId === request.workspaceId;
  }
  return fact.projectId === request.projectId;
}
