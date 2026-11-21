import type { SidebarContext } from './context.js';
import type { SidebarIndexOrchestrator } from './indexOrchestrator.js';
import type { SidebarRunController } from './runController.js';
import type { SidebarSettingsService } from './settingsService.js';

/** Context plus the domain services; consumed by the router and bootstrap. */
export interface SidebarServices extends SidebarContext {
  readonly settings: SidebarSettingsService;
  readonly indexer: SidebarIndexOrchestrator;
  readonly runs: SidebarRunController;
}
