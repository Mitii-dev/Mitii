import { RepositoryStateError } from "../../contracts/errors/RepositoryStateError";
import type { RepositoryStateDescriptor } from "../../contracts/output/RepositoryStateDescriptor";
import { publishRepositoryStateResultSchema } from "../../contracts/output/RepositoryStateResults";
import type { PublishRepositoryStateResult } from "../../contracts/output/RepositoryStateResults";
import type { RepositoryStateStorePort } from "../../ports/RepositoryStateStorePorts";

export type PersistDescriptorResult =
  | { ok: true }
  | { ok: false; result: PublishRepositoryStateResult };

export async function persistDescriptorStep(params: {
  store: RepositoryStateStorePort;
  descriptor: RepositoryStateDescriptor;
}): Promise<PersistDescriptorResult> {
  try {
    await params.store.publish(params.descriptor);
    return { ok: true };
  } catch (error) {
    if (error instanceof RepositoryStateError) {
      return {
        ok: false,
        result: publishRepositoryStateResultSchema.parse({
          status: "failed",
          code: error.code,
          message: error.message,
        }),
      };
    }
    throw error;
  }
}
