import { useState, useRef, useCallback } from 'react';
import {
  type WorkspaceSnapshot,
  type UndoEntry,
  type CommitOptions,
  MAX_UNDO_ENTRIES,
  cloneSnapshot,
  areSnapshotsEqual,
} from './undoTypes';

export interface UseUndoHistoryOptions {
  getCurrentSnapshot: () => WorkspaceSnapshot;
  onRestore: (snapshot: WorkspaceSnapshot, direction: 'undo' | 'redo') => void;
  isLocked?: boolean;
  maxEntries?: number;
}

export interface UseUndoHistoryReturn {
  commit: (
    label: string,
    mutationOrUpdater: (() => void) | ((curr: WorkspaceSnapshot) => WorkspaceSnapshot),
    options?: CommitOptions,
  ) => void;
  undo: () => string | null;
  redo: () => string | null;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
  clearHistory: () => void;
}

export function useUndoHistory({
  getCurrentSnapshot,
  onRestore,
  isLocked = false,
  maxEntries = MAX_UNDO_ENTRIES,
}: UseUndoHistoryOptions): UseUndoHistoryReturn {
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [redoStack, setRedoStack] = useState<UndoEntry[]>([]);

  // 同步引用以支撑连续快速操作与避免闭包陈旧
  const undoStackRef = useRef<UndoEntry[]>([]);
  undoStackRef.current = undoStack;
  const redoStackRef = useRef<UndoEntry[]>([]);
  redoStackRef.current = redoStack;

  const commit = useCallback(
    (
      label: string,
      mutationOrUpdater: (() => void) | ((curr: WorkspaceSnapshot) => WorkspaceSnapshot),
      options?: CommitOptions,
    ) => {
      if (isLocked) return;

      const before = cloneSnapshot(getCurrentSnapshot());
      let after: WorkspaceSnapshot;

      if (typeof mutationOrUpdater === 'function' && mutationOrUpdater.length > 0) {
        const next = (mutationOrUpdater as (curr: WorkspaceSnapshot) => WorkspaceSnapshot)(before);
        onRestore(next, 'redo');
        after = cloneSnapshot(next);
      } else {
        (mutationOrUpdater as () => void)();
        after = cloneSnapshot(getCurrentSnapshot());
      }

      if (areSnapshotsEqual(before, after)) {
        return;
      }

      const now = Date.now();
      const mergeWindowMs = options?.mergeWindowMs ?? 800;
      const currentUndo = undoStackRef.current;
      const lastEntry = currentUndo.length > 0 ? currentUndo[currentUndo.length - 1] : null;

      // 连续输入合并判定（例如份数、页码在 800ms 内的多次敲击）
      if (
        options?.mergeKey &&
        lastEntry &&
        lastEntry.mergeKey === options.mergeKey &&
        now - lastEntry.createdAt <= mergeWindowMs
      ) {
        const merged: UndoEntry = {
          ...lastEntry,
          after,
          createdAt: now,
          label,
        };
        const nextUndo = [...currentUndo.slice(0, -1), merged];
        undoStackRef.current = nextUndo;
        setUndoStack(nextUndo);
        redoStackRef.current = [];
        setRedoStack([]);
        return;
      }

      const newEntry: UndoEntry = {
        label,
        before,
        after,
        mergeKey: options?.mergeKey,
        createdAt: now,
      };

      let nextUndo = [...currentUndo, newEntry];
      if (nextUndo.length > maxEntries) {
        nextUndo = nextUndo.slice(nextUndo.length - maxEntries);
      }

      undoStackRef.current = nextUndo;
      setUndoStack(nextUndo);
      redoStackRef.current = [];
      setRedoStack([]);
    },
    [isLocked, getCurrentSnapshot, onRestore, maxEntries],
  );

  const undo = useCallback((): string | null => {
    if (isLocked || undoStackRef.current.length === 0) return null;

    const currentUndo = [...undoStackRef.current];
    const entry = currentUndo.pop()!;

    undoStackRef.current = currentUndo;
    setUndoStack(currentUndo);

    const nextRedo = [...redoStackRef.current, entry];
    redoStackRef.current = nextRedo;
    setRedoStack(nextRedo);

    onRestore(cloneSnapshot(entry.before), 'undo');
    return entry.label;
  }, [isLocked, onRestore]);

  const redo = useCallback((): string | null => {
    if (isLocked || redoStackRef.current.length === 0) return null;

    const currentRedo = [...redoStackRef.current];
    const entry = currentRedo.pop()!;

    redoStackRef.current = currentRedo;
    setRedoStack(currentRedo);

    let nextUndo = [...undoStackRef.current, entry];
    if (nextUndo.length > maxEntries) {
      nextUndo = nextUndo.slice(nextUndo.length - maxEntries);
    }
    undoStackRef.current = nextUndo;
    setUndoStack(nextUndo);

    onRestore(cloneSnapshot(entry.after), 'redo');
    return entry.label;
  }, [isLocked, onRestore, maxEntries]);

  const clearHistory = useCallback(() => {
    undoStackRef.current = [];
    setUndoStack([]);
    redoStackRef.current = [];
    setRedoStack([]);
  }, []);

  const canUndo = !isLocked && undoStack.length > 0;
  const canRedo = !isLocked && redoStack.length > 0;
  const undoLabel = undoStack.length > 0 ? undoStack[undoStack.length - 1].label : undefined;
  const redoLabel = redoStack.length > 0 ? redoStack[redoStack.length - 1].label : undefined;

  return {
    commit,
    undo,
    redo,
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
    clearHistory,
  };
}
