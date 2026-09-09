export function appendTextContinuation(prefix: string, continuation: string): string {
  const first = prefix.trimEnd();
  const second = continuation.trimStart();
  if (!first) return continuation;
  if (!second) return first;
  return `${first}\n${second}`;
}

