import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ensureThunderDir } from '../indexing/paths';
import { AGENT_NAME } from '../../shared/brand';
import { installBundledSkills } from '../skills/installBundledSkills';

const MCP_TEMPLATE = {
  mcpServers: {},
} as const;

const README = `# ${AGENT_NAME} workspace (.mitii)

This folder stores ${AGENT_NAME} runtime data for this workspace.

## MCP servers

Built-in servers load automatically when \`mitii.mcp.preloadBuiltin\` is enabled (default):

| Server | Package |
|--------|---------|
| filesystem | @modelcontextprotocol/server-filesystem (scoped to workspace root) |
| memory | @modelcontextprotocol/server-memory |
| sequential-thinking | @modelcontextprotocol/server-sequential-thinking |

To add custom MCP servers, edit \`mcp.json\` in this folder or set \`mitii.mcp.servers\` in VS Code settings.
Workspace \`mcp.json\` entries override built-ins with the same name.

Example:

\`\`\`json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "my-mcp-server"],
      "env": {}
    }
  }
}
\`\`\`

## Other paths

- \`mitii.sqlite\` — code index
- \`logs/\` — session logs (when enabled)
- \`tasks/\` — saved plans
- \`skills/\` — bundled workspace skill playbooks (copied from the extension on first init)
- \`MITTII.local.md\` — optional personal project instructions; copy from \`MITTII.local.md.example\`
`;

const LOCAL_RULES_EXAMPLE = `# Local Mitii Instructions

Personal notes for this workspace. This file is intentionally not meant for git.

- Preferred verification command:
- Local services or ports:
- Project-specific cautions:
`;

export interface ScaffoldMitiiWorkspaceOptions {
  extensionRoot?: string;
  forceBundledSkills?: boolean;
}

/** Create default .mitii reference files on first workspace init (idempotent). */
export function scaffoldMitiiWorkspace(
  workspace: string,
  options: ScaffoldMitiiWorkspaceOptions = {}
): void {
  if (!workspace.trim()) return;
  const dir = ensureThunderDir(workspace);

  const mcpPath = join(dir, 'mcp.json');
  if (!existsSync(mcpPath)) {
    writeFileSync(mcpPath, `${JSON.stringify(MCP_TEMPLATE, null, 2)}\n`, 'utf-8');
  }

  const readmePath = join(dir, 'README.md');
  if (!existsSync(readmePath)) {
    writeFileSync(readmePath, README, 'utf-8');
  }

  const localRulesExamplePath = join(dir, 'MITTII.local.md.example');
  if (!existsSync(localRulesExamplePath)) {
    writeFileSync(localRulesExamplePath, LOCAL_RULES_EXAMPLE, 'utf-8');
  }

  if (options.extensionRoot?.trim()) {
    installBundledSkills(workspace, options.extensionRoot, {
      force: options.forceBundledSkills,
    });
  }
}
