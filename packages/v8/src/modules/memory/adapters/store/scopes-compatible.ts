import type { MemoryScope } from "../../contracts";

export function scopesCompatible(
  fact: MemoryScope,
  request: MemoryScope,
): boolean {
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
