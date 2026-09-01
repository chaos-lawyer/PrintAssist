// @vitest-environment jsdom
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import React, { useState } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useUndoHistory } from './useUndoHistory';
import type { WorkspaceSnapshot } from './undoTypes';
import { queueReducer } from '../queue/queueReducer';
import { createDefaultGlobalSettings } from '../../domain/printSettings';
import { createEmptyQueueState, type QueueItem } from '../../domain/queueTypes';
import { shouldIgnoreShortcut } from '../shortcuts/shortcutGuards';

function createMockItem(id: string, name: string): QueueItem {
  return {
    id,
    path: `/test/${name}`,
    fileName: name,
    kind: 'pdf',
    pageCount: 1,
    status: 'ready',
    override: {},
    metadataLoaded: true,
    addedAt: Date.now(),
  };
}

function TestWorkbench() {
  const [queueState, setQueueState] = useState(() => {
    const q = createEmptyQueueState();
    q.items = [
      createMockItem('id-1', 'apple.pdf'),
      createMockItem('id-2', 'banana.pdf'),
      createMockItem('id-3', 'cherry.pdf'),
    ];
    return q;
  });
  const [globalSettings, setGlobalSettings] = useState(createDefaultGlobalSettings);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>(['id-1']);
  const [activeId, setActiveId] = useState<string | null>('id-1');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const currentRef = React.useRef<WorkspaceSnapshot>({
    queueState,
    globalSettings,
    selectedRowKeys,
    activeId,
  });
  currentRef.current = {
    queueState,
    globalSettings,
    selectedRowKeys,
    activeId,
  };

  const applySnapshot = React.useCallback((s: WorkspaceSnapshot) => {
    setQueueState(s.queueState);
    setGlobalSettings(s.globalSettings);
    const validIds = new Set(s.queueState.items.map((i) => i.id));
    setSelectedRowKeys(s.selectedRowKeys.filter((id) => validIds.has(id)));
    setActiveId(s.activeId && validIds.has(s.activeId) ? s.activeId : null);
  }, []);

  const { commit, undo, redo, canUndo, canRedo, undoLabel } = useUndoHistory({
    getCurrentSnapshot: () => currentRef.current,
    onRestore: (s) => {
      applySnapshot(s);
      currentRef.current = s;
    },
  });

  const handleRemoveItem = (id: string) => {
    commit('移除 1 个文件', (curr) => ({
      ...curr,
      queueState: queueReducer(curr.queueState, { type: 'remove_item', id }),
      selectedRowKeys: curr.selectedRowKeys.filter((k) => k !== id),
      activeId: curr.activeId === id ? null : curr.activeId,
    }));
    setToastMessage('已移除 1 个文件');
  };

  const handleClearQueue = () => {
    const count = queueState.items.length;
    commit(`清空 ${count} 个文件`, (curr) => ({
      ...curr,
      queueState: queueReducer(curr.queueState, { type: 'clear_queue' }),
      selectedRowKeys: [],
      activeId: null,
    }));
    setToastMessage(`已清空 ${count} 个文件`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      if (!shouldIgnoreShortcut(e.nativeEvent as KeyboardEvent, { isSingleKey: false })) {
        e.preventDefault();
        undo();
      }
    }
    const isRedoKey =
      (e.ctrlKey || e.metaKey) &&
      ((e.shiftKey && e.key.toLowerCase() === 'z') || (!e.shiftKey && e.key.toLowerCase() === 'y'));
    if (isRedoKey) {
      if (!shouldIgnoreShortcut(e.nativeEvent as KeyboardEvent, { isSingleKey: false })) {
        e.preventDefault();
        redo();
      }
    }
  };

  return (
    <div onKeyDown={handleKeyDown} data-testid="workbench">
      <div data-testid="item-count">{queueState.items.length}</div>
      <div data-testid="can-undo">{canUndo ? 'true' : 'false'}</div>
      <div data-testid="can-redo">{canRedo ? 'true' : 'false'}</div>
      <div data-testid="undo-label">{undoLabel || ''}</div>
      <div data-testid="items-list">{queueState.items.map((i) => i.fileName).join(', ')}</div>

      <input data-testid="test-input" defaultValue="some text" />

      <button data-testid="btn-remove-first" onClick={() => handleRemoveItem('id-1')}>
        删除首项
      </button>
      <button data-testid="btn-clear" onClick={handleClearQueue}>
        清空队列
      </button>
      <button data-testid="btn-undo" onClick={() => undo()} disabled={!canUndo}>
        撤销
      </button>
      <button data-testid="btn-redo" onClick={() => redo()} disabled={!canRedo}>
        重做
      </button>

      {toastMessage && (
        <div data-testid="toast-msg">
          <span>{toastMessage}</span>
          <button data-testid="toast-undo" onClick={() => undo()}>
            撤销
          </button>
        </div>
      )}
    </div>
  );
}

describe('Undo / Redo Integration Workflows', () => {
  beforeEach(() => {
    cleanup();
  });

  it('removes file without popup confirmation and restores via toast undo button', () => {
    render(<TestWorkbench />);

    expect(screen.getByTestId('item-count').textContent).toBe('3');
    expect(screen.getByTestId('can-undo').textContent).toBe('false');

    // Click delete without any confirmation popup
    fireEvent.click(screen.getByTestId('btn-remove-first'));

    expect(screen.getByTestId('item-count').textContent).toBe('2');
    expect(screen.getByTestId('items-list').textContent).toBe('banana.pdf, cherry.pdf');
    expect(screen.getByTestId('can-undo').textContent).toBe('true');
    expect(screen.getByTestId('undo-label').textContent).toBe('移除 1 个文件');
    expect(screen.getByTestId('toast-msg').textContent).toContain('已移除 1 个文件');

    // Click toast undo button
    fireEvent.click(screen.getByTestId('toast-undo'));

    expect(screen.getByTestId('item-count').textContent).toBe('3');
    expect(screen.getByTestId('items-list').textContent).toBe('apple.pdf, banana.pdf, cherry.pdf');
    expect(screen.getByTestId('can-undo').textContent).toBe('false');
    expect(screen.getByTestId('can-redo').textContent).toBe('true');
  });

  it('clears queue without popup and restores via Ctrl+Z shortcut', () => {
    render(<TestWorkbench />);

    fireEvent.click(screen.getByTestId('btn-clear'));

    expect(screen.getByTestId('item-count').textContent).toBe('0');
    expect(screen.getByTestId('undo-label').textContent).toBe('清空 3 个文件');

    // Press Ctrl+Z
    const workbench = screen.getByTestId('workbench');
    fireEvent.keyDown(workbench, { key: 'z', ctrlKey: true });

    expect(screen.getByTestId('item-count').textContent).toBe('3');
    expect(screen.getByTestId('items-list').textContent).toBe('apple.pdf, banana.pdf, cherry.pdf');

    // Press Ctrl+Y (Redo)
    fireEvent.keyDown(workbench, { key: 'y', ctrlKey: true });
    expect(screen.getByTestId('item-count').textContent).toBe('0');

    // Press Ctrl+Shift+Z (Redo alias after undo)
    fireEvent.keyDown(workbench, { key: 'z', ctrlKey: true });
    expect(screen.getByTestId('item-count').textContent).toBe('3');
    fireEvent.keyDown(workbench, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(screen.getByTestId('item-count').textContent).toBe('0');
  });

  it('protects text inputs: Ctrl+Z while typing in input is ignored by workspace undo', () => {
    render(<TestWorkbench />);

    // Delete first item
    fireEvent.click(screen.getByTestId('btn-remove-first'));
    expect(screen.getByTestId('item-count').textContent).toBe('2');

    // Focus on input
    const input = screen.getByTestId('test-input');
    input.focus();

    // Fire Ctrl+Z on the input
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true });

    // Workspace queue count MUST NOT change (remains 2, left for browser native text undo)
    expect(screen.getByTestId('item-count').textContent).toBe('2');
  });
});
