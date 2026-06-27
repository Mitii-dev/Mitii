import type { SafetyConfig } from '../config/schema';
import type { AutonomyPreset } from '../planning/PlanActEngine';

export function applyAutonomyPreset(base: SafetyConfig, preset: AutonomyPreset): SafetyConfig {
  switch (preset) {
    case 'safe':
      return {
        ...base,
        requireApprovalForWrites: true,
        requireApprovalForShell: true,
        blockDangerousCommands: true,
      };
    case 'guided':
      return {
        ...base,
        requireApprovalForWrites: true,
        requireApprovalForShell: true,
        blockDangerousCommands: true,
      };
    case 'builder':
      return {
        ...base,
        requireApprovalForWrites: true,
        requireApprovalForShell: true,
        blockDangerousCommands: true,
      };
    case 'pilot':
      return {
        ...base,
        requireApprovalForWrites: false,
        requireApprovalForShell: true,
        blockDangerousCommands: true,
        approvalMode: base.approvalMode === 'review_all' ? 'ask_commands' : base.approvalMode,
      };
    case 'enterprise':
      return {
        ...base,
        requireApprovalForWrites: true,
        requireApprovalForShell: true,
        blockDangerousCommands: true,
        allowNetwork: false,
      };
    default:
      return base;
  }
}
