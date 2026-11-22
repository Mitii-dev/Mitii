import { appendDesktopLog } from '../shared/project-logs.js';
import type { MainRuntime } from './main-runtime.js';
import { getStorageInfo } from './storage-locations.js';

export function desktopLogsDir(
  runtime: MainRuntime,
  workspaceRoot?: string,
): string {
  const root =
    workspaceRoot?.trim() ||
    runtime.state?.workspaceRoot?.trim() ||
    process.env.MITII_DESKTOP_CWD?.trim() ||
    process.cwd();
  return getStorageInfo(root).logsPath;
}

export function logDesktop(
  runtime: MainRuntime,
  category: Parameters<typeof appendDesktopLog>[1],
  message: string,
  options?: Parameters<typeof appendDesktopLog>[3],
  workspaceRoot?: string,
): void {
  appendDesktopLog(
    desktopLogsDir(runtime, workspaceRoot),
    category,
    message,
    options,
  );
}
