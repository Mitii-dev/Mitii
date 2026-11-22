import type { ReactNode } from 'react';

export type ComposerMode = 'ask' | 'plan' | 'agent' | 'database';
export type ComposerApprovalMode = 'safe' | 'guided' | 'pilot';
export type ComposerThoroughness = 'low' | 'medium' | 'high';
/** Database-mode privilege; replaces the approval picker while Database mode is active. */
export type ComposerDbAccess = 'readonly' | 'readwrite';

/** One selectable row. Icons are supplied by the host through `icons`, never stored here. */
export interface ComposerOption<T extends string = string> {
  id: T;
  label: string;
  description: string;
  /** Accent colour (CSS value) exposed as `--composer-control-color` / `--composer-option-color`. */
  color: string;
  /** Marks risky choices (`…--warning` modifier classes). */
  warning?: boolean;
}

/** Option id that selects a custom icon; `custom` is the thoroughness trigger shown by `intensityCustom`. */
export type ComposerIconKey =
  | ComposerMode
  | ComposerApprovalMode
  | ComposerThoroughness
  | ComposerDbAccess
  | 'custom';

export type ComposerControlIcons = Partial<Record<ComposerIconKey, ReactNode>>;

export interface ComposerControlsProps {
  mode: ComposerMode;
  approvalMode: ComposerApprovalMode;
  thoroughness: ComposerThoroughness;
  onModeChange: (mode: ComposerMode) => void;
  onApprovalModeChange: (mode: ComposerApprovalMode) => void;
  onThoroughnessChange: (thoroughness: ComposerThoroughness) => void;
  /** Active database privilege; defaults to `readonly`. */
  dbAccess?: ComposerDbAccess;
  /**
   * When set and `mode` is `database`, a DB-access picker replaces the approval
   * picker. Without it, the approval picker is always shown.
   */
  onDbAccessChange?: (access: ComposerDbAccess) => void;
  /**
   * Thoroughness trigger reads "Custom" and no level is marked selected until
   * the user picks one (developer intensity overrides are active).
   */
  intensityCustom?: boolean;
  disabled?: boolean;
  /** Per-option icons keyed by option id. Missing keys render no icon. */
  icons?: ComposerControlIcons;
  /**
   * Mark shown beside the selected option. Passing it also reserves its slot
   * on unselected rows so labels stay aligned; omitted, a `✓` appears only on
   * the selected row.
   */
  checkIcon?: ReactNode;
  /** Replace the default option catalogs (see `defaults.ts`). */
  modeOptions?: readonly ComposerOption<ComposerMode>[];
  approvalOptions?: readonly ComposerOption<ComposerApprovalMode>[];
  thoroughnessOptions?: readonly ComposerOption<ComposerThoroughness>[];
  dbAccessOptions?: readonly ComposerOption<ComposerDbAccess>[];
  /** Menu anchor relative to its trigger: left edges aligned, or centred. */
  menuAlign?: 'start' | 'center';
}
