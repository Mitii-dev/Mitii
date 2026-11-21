import { McpServersEditor } from '../McpServersEditor';
import { SettingsSection } from './shared';
import { type SettingsPanelProps } from './types';
import { type SettingsPanelView } from './useSettingsPanelState';

export function IntegrationsTab({ props, view }: { props: SettingsPanelProps; view: SettingsPanelView }) {
  const {
    mcp,
    mcpRuntimeStatus,
    mcpStore,
    onMcpChange,
  } = props;

  return (
    <div className="settings-panel">
      <SettingsSection
        title="Servers"
        description="Install what you need. Delete anytime."
      >
        <McpServersEditor
          mcp={mcp}
          storeCatalog={mcpStore}
          runtimeStatus={mcpRuntimeStatus}
          onChange={onMcpChange}
        />
      </SettingsSection>
    </div>
  );
}
