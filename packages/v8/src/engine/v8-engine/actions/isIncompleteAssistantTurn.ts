/**
 * Shim — owner is runtime/helpers/loop-turn.
 */
export {
  claimsPackageScriptsWithoutEvidence,
  hasLeakedToolCallMarkup,
  isDegenerateRepeatedAnswer,
  isEmptyAssistantTurn,
  isMidWorkAnalysisDump,
  isPseudoToolRequestAnswer,
  isTransitionalAssistantAnswer,
  isUnfinishedInvestigationAnswer,
  looksLikeInstructionalAnswer,
  compactRecoveredAssistantContent,
  shouldRecoverIncompleteAssistantTurn,
  buildIncompleteAnswerRecoveryMessage,
  synthesizeFallbackAnswer,
  selectUserFacingLoopAnswer,
  salvageUserFacingAnswerSection,
  stripInjectionComplianceEchoes,
  amendMessageWithPriorConversation,
  buildUnderstandingHistoryDigest,
} from "../../../runtime/helpers/loop-turn";
