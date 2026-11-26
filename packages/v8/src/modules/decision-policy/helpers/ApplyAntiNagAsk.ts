/**
 * Anti-nagging ask gate (§5.5) — Decision Policy authority.
 * Ballot askUserSuggested is evidence only.
 */

export interface AntiNagAskInput {
  askUserSuggested: boolean;
  primaryTaskIntent: string;
  difficulty?: "trivial" | "simple" | "moderate" | "complex" | "very_complex";
  risk?: "low" | "medium" | "high" | "critical";
  clarityConfidence: "low" | "medium" | "high";
  userQuestions?: readonly string[];
  clarificationQuestions?: readonly { blocking?: boolean }[];
  turnKind?: "new" | "continue" | "steer" | "follow_up" | "recover";
}

export interface AntiNagAskResult {
  askUser: boolean;
  reasonCodes: string[];
}

export function applyAntiNagAsk(input: AntiNagAskInput): AntiNagAskResult {
  const reasonCodes: string[] = [];

  // Vague / unclear primary always may clarify.
  if (input.primaryTaskIntent === "unclear") {
    return {
      askUser: true,
      reasonCodes: ["anti_nag_unclear_allows_ask"],
    };
  }

  // Non-empty userQuestions + otherwise clear → answer them, don't clarify.
  if (
    (input.userQuestions?.length ?? 0) > 0 &&
    input.clarityConfidence !== "low"
  ) {
    reasonCodes.push("anti_nag_answer_user_questions");
    return { askUser: false, reasonCodes };
  }

  const difficulty = input.difficulty ?? "simple";
  const risk = input.risk ?? "low";

  // Trivial/simple + low risk → prefer assumptions over nagging.
  if (
    (difficulty === "trivial" || difficulty === "simple") &&
    risk === "low" &&
    input.clarityConfidence !== "low"
  ) {
    reasonCodes.push("clamp_anti_nag_clarify");
    return { askUser: false, reasonCodes };
  }

  // Continue/steer: raise ask threshold.
  const turn = input.turnKind ?? "new";
  if (turn === "continue" || turn === "steer" || turn === "follow_up") {
    const hasBlocking = (input.clarificationQuestions ?? []).some(
      (q) => q.blocking !== false,
    );
    if (!(input.clarityConfidence === "low" && hasBlocking)) {
      reasonCodes.push("anti_nag_continue_raise_threshold");
      return { askUser: false, reasonCodes };
    }
  }

  // High/critical risk or moderate+ with low clarity → honor ballot.
  if (
    input.clarityConfidence === "low" &&
    (difficulty === "moderate" ||
      difficulty === "complex" ||
      difficulty === "very_complex" ||
      risk === "high" ||
      risk === "critical")
  ) {
    return {
      askUser: input.askUserSuggested,
      reasonCodes: ["anti_nag_allow_blocking_clarify"],
    };
  }

  if (!input.askUserSuggested) {
    return { askUser: false, reasonCodes };
  }

  return {
    askUser: true,
    reasonCodes: [...reasonCodes, "anti_nag_honor_ballot"],
  };
}
