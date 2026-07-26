import { z } from "zod";

import { userRequestEnvelopeSchema } from "../../../request-intake";

export const requestUnderstandingPipelineInputSchema =
  userRequestEnvelopeSchema;

export type RequestUnderstandingPipelineInput = z.infer<
  typeof requestUnderstandingPipelineInputSchema
>;
