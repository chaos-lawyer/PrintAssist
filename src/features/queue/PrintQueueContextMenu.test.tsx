// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultGlobalSettings } from '../../domain/printSettings';
import type { QueueItem } from '../../domain/queueTypes';
import { PrintQueue } from './PrintQueue';

describe('PrintQueue Context Menus', () => {
  beforeEach(() => {
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any;

    window.matchMedia =
      window.matchMedia ||
      function () {
        return {
          matches: false,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        };
      };
  });

  afterEach(() => {
    cleanup();
  });

  const mockItems: QueueItem[] = [
    {
      id: 'doc-1',
      path: '/path/to/report.pdf',
      fileName: 'report.pdf',
      kind: 'pdf',
      fileSize: 10240,
      createdAt: 1600000000000,
      modifiedAt: 1600000000000,
      addedAt: 1600000000000,
      pageCount: 5,
      status: 'pending',
      override: {},
    },
    {
      id: 'doc-2',
      path: '/path/to/invoice.docx',
      fileName: 'invoice.docx',
      kind: 'word',
      fileSize: 20480,
      createdAt: 1600000000000,
      modifiedAt: 1600000000000,
      addedAt: 1600000000000,
      pageCount: 2,
      status: 'pending',
      override: {},
    },
  ];

  const defaultSettings = createDefaultGlobalSettings('Test Printer');

  it('renders single-item context menu on right click on a row', () => {
    const handleSelectionChange = vi.fn();
    const handleOpenSettings = vi.fn();

    render(
      <PrintQueue
        items={mockItems}
        globalSettings={defaultSettings}
        isPrinting={false}
        selectedRowKeys={['doc-1']}
        activeId="doc-1"
        onSelectionChange={handleSelectionChange}
        onRemove={vi.fn()}
        onOpenSettings={handleOpenSettings}
      />,
    );

    const row = document.querySelector('[data-row-id="doc-1"]');
    expect(row).not.toBeNull();

    fireEvent.contextMenu(row!);

    expect(screen.getByRole('menuitem', { name: /打开文件/ })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /在文件夹中显示/ })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /文件打印设置/ })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /选择此文件的全部副本/ })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /复制文件项/ })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /移除/ })).toBeDefined();
  });

  it('selects unselected row on right click and opens menu', () => {
    const handleSelectionChange = vi.fn();

    render(
      <PrintQueue
        items={mockItems}
        globalSettings={defaultSettings}
        isPrinting={false}
        selectedRowKeys={['doc-1']}
        activeId="doc-1"
        onSelectionChange={handleSelectionChange}
        onRemove={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    const row2 = document.querySelector('[data-row-id="doc-2"]');
    expect(row2).not.toBeNull();

    fireEvent.contextMenu(row2!);

    // Should switch selection to doc-2
    expect(handleSelectionChange).toHaveBeenCalledWith(['doc-2']);
  });

  it('renders multi-item context menu when multiple items are selected', () => {
    const handleBatchSettings = vi.fn();
    const handleBatchRemove = vi.fn();

    render(
      <PrintQueue
        items={mockItems}
        globalSettings={defaultSettings}
        isPrinting={false}
        selectedRowKeys={['doc-1', 'doc-2']}
        activeId="doc-1"
        onSelectionChange={vi.fn()}
        onRemove={vi.fn()}
        onOpenSettings={vi.fn()}
        onBatchSettings={handleBatchSettings}
        onBatchRemove={handleBatchRemove}
      />,
    );

    const row1 = document.querySelector('[data-row-id="doc-1"]');
    fireEvent.contextMenu(row1!);

    expect(screen.getByRole('menuitem', { name: /批量设置（2 项）/ })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /复制文件项（2 项）/ })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /移除（2 项）/ })).toBeDefined();

    // Click batch settings
    fireEvent.click(screen.getByRole('menuitem', { name: /批量设置（2 项）/ }));
    expect(handleBatchSettings).toHaveBeenCalledTimes(1);
  });

  it('disables modifying actions when queue is locked (printing or completed)', () => {
    render(
      <PrintQueue
        items={mockItems}
        globalSettings={defaultSettings}
        isPrinting={true}
        selectedRowKeys={['doc-1']}
        activeId="doc-1"
        onSelectionChange={vi.fn()}
        onRemove={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    const row = document.querySelector('[data-row-id="doc-1"]');
    fireEvent.contextMenu(row!);

    const settingsItem = screen.getByRole('menuitem', { name: /文件打印设置/ });
    expect(settingsItem).toHaveProperty('disabled', true);

    const removeItem = screen.getByRole('menuitem', { name: /移除/ });
    expect(removeItem).toHaveProperty('disabled', true);
  });

  it('shows blank context menu with add files on empty queue right click', () => {
    const handleAddFiles = vi.fn();

    render(
      <PrintQueue
        items={[]}
        globalSettings={defaultSettings}
        isPrinting={false}
        selectedRowKeys={[]}
        onSelectionChange={vi.fn()}
        onRemove={vi.fn()}
        onOpenSettings={vi.fn()}
        onAddFiles={handleAddFiles}
      />,
    );

    const emptyContainer = document.querySelector('.queue-empty-container');
    expect(emptyContainer).not.toBeNull();

    fireEvent.contextMenu(emptyContainer!);

    const addFilesItem = screen.getByRole('menuitem', { name: /选择文件/ });
    expect(addFilesItem).toBeDefined();

    fireEvent.click(addFilesItem);
    expect(handleAddFiles).toHaveBeenCalledTimes(1);
  });

  it('opens table header column context menu with reset default columns', () => {
    render(
      <PrintQueue
        items={mockItems}
        globalSettings={defaultSettings}
        isPrinting={false}
        selectedRowKeys={[]}
        onSelectionChange={vi.fn()}
        onRemove={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    const header = screen.getAllByText('创建时间')[0];
    fireEvent.contextMenu(header);

    expect(screen.getByRole('menuitem', { name: /文件路径/ })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /文件大小/ })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /恢复默认列/ })).toBeDefined();
  });
});
