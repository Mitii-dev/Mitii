import type { FeatureModule } from '../../interfaces/feature';

function feature(id: string, displayName: string, description: string): FeatureModule {
  return {
    manifest: {
      id,
      apiVersion: '1',
      edition: 'ee',
      version: '1.0.0',
      displayName,
      description,
    },
    register() {},
  };
}

export const eeFeatureModules: readonly FeatureModule[] = [
  feature('ee.managed-policy', 'Managed Policy', 'Organization controlled provider, tool, and channel policy.'),
  feature('ee.audit.automation', 'Audit Automation', 'Managed audit export, signing, retention, and redaction policy.'),
  feature('ee.telemetry.webhook', 'Telemetry Webhook', 'Managed outbound telemetry and SIEM delivery.'),
  feature('ee.teams', 'Teams', 'Team task ownership, mailboxes, and collaboration workflow.'),
  feature('ee.distributed-jobs', 'Distributed Jobs', 'Persistent job queue and worker coordination.'),
  feature('ee.parallel-agents', 'Parallel Agents', 'Policy controlled parallel task execution.'),
  feature('ee.channels', 'Channels', 'Managed external channels such as Slack and Telegram.'),
  feature('ee.managed-mcp', 'Managed MCP', 'Allowlisted MCP servers, credentials, and managed tool exposure.'),
] as const;
