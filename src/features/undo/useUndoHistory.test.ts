// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useUndoHistory } from './useUndoHistory';
import type { WorkspaceSnapshot } from './undoTypes';
import { createDefaultGlobalSettings } from '../../domain/printSettings';
import { createEmptyQueueState, type QueueItem } from '../../domain/queueTypes';

function makeMockItem(id: string, fileName: string): QueueItem {
  return {
    id,
    path: `/docs/${fileName}`,
    fileName,
    kind: 'pdf',
    pageCount: 1,
    status: 'ready',
    override: {},
    metadataLoaded: true,
    addedAt: Date.now(),
  };
}

function makeInitialSnapshot(itemCount = 2): WorkspaceSnapshot {
  const queue = createEmptyQueueState();
  for (let i = 1; i <= itemCount; i++) {
    queue.items.push(makeMockItem(`item-${i}`, `file-${i}.pdf`));
  }
  return {
    queueState: queue,
    globalSettings: createDefaultGlobalSettings(),
    selectedRowKeys: ['item-1'],
    activeId: 'item-1',
  };
}

describe('useUndoHistory Hook', () => {
  it('initializes with empty history and cannot undo or redo', () => {
    let current = makeInitialSnapshot();
    const { result } = renderHook(() =>
      useUndoHistory({
        getCurrentSnapshot: () => current,
        onRestore: (s) => {
          current = s;
        },
      }),
    );

    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.undoLabel).toBeUndefined();
    expect(result.current.redoLabel).toBeUndefined();
  });

  it('records transactions through commit and updates canUndo / undoLabel', () => {
    let current = makeInitialSnapshot(2);
    const { result } = renderHook(() =>
      useUndoHistory({
        getCurrentSnapshot: () => current,
        onRestore: (s) => {
          current = s;
        },
      }),
    );

    act(() => {
      result.current.commit('移除 1 个文件', (curr) => ({
        ...curr,
        queueState: {
          ...curr.queueState,
          items: curr.queueState.items.slice(0, 1),
        },
        selectedRowKeys: [],
        activeId: null,
      }));
    });

    expect(result.current.canUndo).toBe(true);
    expect(result.current.undoLabel).toBe('移除 1 个文件');
    expect(result.current.canRedo).toBe(false);
    expect(current.queueState.items.length).toBe(1);
  });

  it('undo restores previous snapshot and enables redo', () => {
    let current = makeInitialSnapshot(2);
    const { result } = renderHook(() =>
      useUndoHistory({
        getCurrentSnapshot: () => current,
        onRestore: (s) => {
          current = s;
        },
      }),
    );

    act(() => {
      result.current.commit('移除 1 个文件', (curr) => ({
        ...curr,
        queueState: {
          ...curr.queueState,
          items: [curr.queueState.items[0]],
        },
      }));
    });

    expect(current.queueState.items.length).toBe(1);

    act(() => {
      const undoneLabel = result.current.undo();
      expect(undoneLabel).toBe('移除 1 个文件');
    });

    expect(current.queueState.items.length).toBe(2);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
    expect(result.current.redoLabel).toBe('移除 1 个文件');

    // Redo restores the mutation
    act(() => {
      const redoneLabel = result.current.redo();
      expect(redoneLabel).toBe('移除 1 个文件');
    });

    expect(current.queueState.items.length).toBe(1);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it('clears redo stack when a new mutation is committed', () => {
    let current = makeInitialSnapshot(2);
    const { result } = renderHook(() =>
      useUndoHistory({
        getCurrentSnapshot: () => current,
        onRestore: (s) => {
          current = s;
        },
      }),
    );

    act(() => {
      result.current.commit('操作 1', (curr) => ({
        ...curr,
        selectedRowKeys: ['item-2'],
      }));
    });

    act(() => {
      result.current.undo();
    });

    expect(result.current.canRedo).toBe(true);

    // Commit new action
    act(() => {
      result.current.commit('操作 2', (curr) => ({
        ...curr,
        activeId: 'item-2',
      }));
    });

    expect(result.current.canRedo).toBe(false);
    expect(result.current.undoLabel).toBe('操作 2');
  });

  it('coalesces rapid consecutive inputs with mergeKey within window', () => {
    let current = makeInitialSnapshot(2);
    const { result } = renderHook(() =>
      useUndoHistory({
        getCurrentSnapshot: () => current,
        onRestore: (s) => {
          current = s;
        },
      }),
    );

    // Type 2 copies
    act(() => {
      result.current.commit(
        '修改全局打印设置',
        (curr) => ({
          ...curr,
          globalSettings: { ...curr.globalSettings, copies: 2 },
        }),
        { mergeKey: 'globalSettings_copies', mergeWindowMs: 800 },
      );
    });

    // Type 3 copies 100ms later
    act(() => {
      result.current.commit(
        '修改全局打印设置',
        (curr) => ({
          ...curr,
          globalSettings: { ...curr.globalSettings, copies: 3 },
        }),
        { mergeKey: 'globalSettings_copies', mergeWindowMs: 800 },
      );
    });

    // Type 4 copies 200ms later
    act(() => {
      result.current.commit(
        '修改全局打印设置',
        (curr) => ({
          ...curr,
          globalSettings: { ...curr.globalSettings, copies: 4 },
        }),
        { mergeKey: 'globalSettings_copies', mergeWindowMs: 800 },
      );
    });

    expect(current.globalSettings.copies).toBe(4);

    // Single undo should revert directly back to copies = 1 (the before state of the first keystroke)
    act(() => {
      result.current.undo();
    });

    expect(current.globalSettings.copies).toBe(1);
    expect(result.current.canUndo).toBe(false);
  });

  it('enforces maximum 50 entries limit by discarding oldest entries', () => {
    let current = makeInitialSnapshot(1);
    const { result } = renderHook(() =>
      useUndoHistory({
        getCurrentSnapshot: () => current,
        onRestore: (s) => {
          current = s;
        },
        maxEntries: 50,
      }),
    );

    // Commit 55 distinct mutations
    for (let i = 1; i <= 55; i++) {
      act(() => {
        result.current.commit(`修改 ${i}`, (curr) => ({
          ...curr,
          globalSettings: { ...curr.globalSettings, copies: i },
        }));
      });
    }

    expect(result.current.undoLabel).toBe('修改 55');

    // Undo 50 times should be allowed, and then canUndo becomes false
    let undoCount = 0;
    while (result.current.canUndo) {
      act(() => {
        result.current.undo();
      });
      undoCount++;
    }

    expect(undoCount).toBe(50);
    expect(result.current.canUndo).toBe(false);
  });

  it('does not commit when state does not change', () => {
    let current = makeInitialSnapshot(2);
    const { result } = renderHook(() =>
      useUndoHistory({
        getCurrentSnapshot: () => current,
        onRestore: (s) => {
          current = s;
        },
      }),
    );

    act(() => {
      result.current.commit('无实质变动', (curr) => ({
        ...curr,
      }));
    });

    expect(result.current.canUndo).toBe(false);
  });

  it('handles 1000 items in queue without performance degradation or mutation contamination', () => {
    let current = makeInitialSnapshot(1000);
    const { result } = renderHook(() =>
      useUndoHistory({
        getCurrentSnapshot: () => current,
        onRestore: (s) => {
          current = s;
        },
      }),
    );

    const start = performance.now();
    act(() => {
      result.current.commit('移除 500 个文件', (curr) => ({
        ...curr,
        queueState: {
          ...curr.queueState,
          items: curr.queueState.items.slice(0, 500),
        },
      }));
    });

    act(() => {
      result.current.undo();
    });

    const elapsed = performance.now() - start;
    expect(current.queueState.items.length).toBe(1000);
    expect(elapsed).toBeLessThan(500); // Must be very fast (well under 500ms)
  });
});
