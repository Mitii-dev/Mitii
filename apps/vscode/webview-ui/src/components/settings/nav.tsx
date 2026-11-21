import { type ReactNode } from 'react';
import { IconBug, IconCode, IconFolder, IconLayers, IconModel, IconPlan, IconPlug, IconReview } from '../Icons';
import { type SettingsTab } from '../../protocol';

export const COMPACT_MAX_WIDTH = 440;

export const NAV: {
  id: SettingsTab;
  label: string;
  icon: ReactNode;
}[] = [
  { id: 'model', label: 'Provider', icon: <IconModel /> },
  { id: 'autocomplete', label: 'Autocomplete', icon: <IconCode /> },
  { id: 'workspace', label: 'Workspace', icon: <IconFolder /> },
  { id: 'modes', label: 'Modes', icon: <IconPlan /> },
  { id: 'context', label: 'Context', icon: <IconLayers /> },
  { id: 'features', label: 'Features', icon: <IconReview /> },
  { id: 'integrations', label: 'MCP', icon: <IconPlug /> },
  { id: 'debug', label: 'Developer', icon: <IconBug /> },
];

export const PAGE_COPY: Record<SettingsTab, { title: string; description: string }> = {
  model: {
    title: 'Provider',
    description: 'Connect a model first. Everything else depends on this.',
  },
  autocomplete: {
    title: 'Autocomplete',
    description: 'Inline FIM suggestions for the active editor.',
  },
  workspace: {
    title: 'Workspace',
    description: 'Folder and local index used for context.',
  },
  modes: {
    title: 'Modes',
    description: 'Defaults and run limits for Ask, Plan, and Agent.',
  },
  context: {
    title: 'Context',
    description: 'What Mitii attaches to each turn.',
  },
  features: {
    title: 'Features',
    description: 'Opt-in IDE surfaces. Off by default until you enable them.',
  },
  integrations: {
    title: 'MCP',
    description: 'Optional servers. Off by default.',
  },
  debug: {
    title: 'Developer',
    description: 'Diagnostics and advanced controls. Leave off unless you need them.',
  },
};
