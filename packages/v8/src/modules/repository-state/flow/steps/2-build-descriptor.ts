import type { PublishRepositoryStateInput } from "../../contracts/input/PublishRepositoryStateInput";
import type { RepositoryStateDescriptor } from "../../contracts/output/RepositoryStateDescriptor";
import { buildDescriptor } from "../../helpers/state-publication/buildDescriptor";

export function buildDescriptorStep(params: {
  candidate: PublishRepositoryStateInput;
  generatedAt: string;
}): RepositoryStateDescriptor {
  return buildDescriptor({
    candidate: params.candidate,
    generatedAt: params.generatedAt,
  });
}
