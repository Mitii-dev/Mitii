import type { UserRequestEnvelope } from "../../../request-intake";
import {
  extractCurrentUserRequestForAnalysis,
  extractPrimaryUserMessage,
} from "../../helpers/intent/extractPrimaryUserMessage";

export function extractUnderstandingMessages(envelope: UserRequestEnvelope): {
  userMessage: string;
  analysisMessage: string;
} {
  const userMessage = extractPrimaryUserMessage(envelope.message);
  const analysisMessage = extractCurrentUserRequestForAnalysis(
    envelope.message,
  );
  return { userMessage, analysisMessage };
}
