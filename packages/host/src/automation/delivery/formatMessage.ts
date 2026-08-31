export function formatDeliveryMessage(input: {
  title: string;
  runId: string;
  status: string;
  answer?: string | null;
  error?: string | null;
  reportPath?: string | null;
}): string {
  const lines = [
    `Mitii automation: **${input.title}**`,
    `run=\`${input.runId}\` status=\`${input.status}\``,
  ];
  if (input.error) lines.push(`error: ${input.error}`);
  if (input.answer) {
    const clipped =
      input.answer.length > 2_500
        ? `${input.answer.slice(0, 2_500)}…`
        : input.answer;
    lines.push('', clipped);
  }
  if (input.reportPath) lines.push('', `report: ${input.reportPath}`);
  return lines.join('\n');
}
