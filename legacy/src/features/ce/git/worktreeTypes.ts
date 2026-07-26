export interface WorktreeInfo {
  taskId: string;
  path: string;
  branch: string;
  status: 'active' | 'removed' | 'orphaned';
  createdAt: number;
  updatedAt: number;
}

export interface WorktreeCreateOptions {
  branch?: string;
  taskId: string;
  baseRef?: string;
}
