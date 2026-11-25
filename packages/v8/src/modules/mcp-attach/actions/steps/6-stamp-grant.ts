/**
 * Flow step 6: stamp attach list onto a grant for ValidateGrant / describe_tool.
 */
export function withMcpAttachOnGrant<
  T extends { allowedMcpServerIds?: string[] },
>(
  grant: T,
  requiredMcpServerIds: readonly string[] | undefined,
): T {
  if (!requiredMcpServerIds || requiredMcpServerIds.length === 0) {
    return grant;
  }
  return {
    ...grant,
    allowedMcpServerIds: [...requiredMcpServerIds],
  };
}
