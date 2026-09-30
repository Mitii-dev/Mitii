export function isVerificationRetryAsk(message: string): boolean {
  return /\b(fix (those|them|the remaining(?: ones)?|remaining (?:errors|issues|diagnostics)|the (?:verification )?errors)|retry verification|continue (?:the )?verification)\b/i.test(
    message,
  );
}
