import type { RepositoryStateDescriptor } from "../../contracts/output/RepositoryStateDescriptor";
import { publishRepositoryStateResultSchema } from "../../contracts/output/RepositoryStateResults";
import type { PublishRepositoryStateResult } from "../../contracts/output/RepositoryStateResults";

export function finalizePublishStep(
  descriptor: RepositoryStateDescriptor,
): PublishRepositoryStateResult {
  return publishRepositoryStateResultSchema.parse({
    status: "published",
    reference: {
      workspaceId: descriptor.workspaceId,
      stateToken: descriptor.stateToken,
    },
    descriptor,
  });
}
