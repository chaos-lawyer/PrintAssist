import type { QueueState } from '../../domain/queueTypes';
import type { PrintSettings } from '../../domain/printSettings';

export interface WorkspaceSnapshot {
  queueState: QueueState;
  globalSettings: PrintSettings;
  selectedRowKeys: string[];
  activeId: string | null;
}

export interface UndoEntry {
  label: string;
  before: WorkspaceSnapshot;
  after: WorkspaceSnapshot;
  mergeKey?: string;
  createdAt: number;
}

export interface CommitOptions {
  mergeKey?: string;
  mergeWindowMs?: number; // 默认 800ms 内合并连续变动
}

export const MAX_UNDO_ENTRIES = 50;

export function cloneSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(snapshot);
    } catch {
      // 降级使用 JSON 序列化深拷贝
    }
  }
  return JSON.parse(JSON.stringify(snapshot)) as WorkspaceSnapshot;
}

export function areSnapshotsEqual(a: WorkspaceSnapshot, b: WorkspaceSnapshot): boolean {
  if (a === b) return true;
  // 快速属性对比
  if (a.activeId !== b.activeId) return false;
  if (a.selectedRowKeys.length !== b.selectedRowKeys.length) return false;
  for (let i = 0; i < a.selectedRowKeys.length; i++) {
    if (a.selectedRowKeys[i] !== b.selectedRowKeys[i]) return false;
  }
  // 完整深层对比
  return JSON.stringify(a) === JSON.stringify(b);
}
