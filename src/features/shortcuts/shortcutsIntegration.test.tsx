// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrintQueue } from '../queue/PrintQueue';
import type { QueueItem } from '../../domain/queueTypes';
import { createDefaultGlobalSettings, type PrintSettings } from '../../domain/printSettings';
import {
  SHORTCUT_DEFINITIONS,
} from './shortcutRegistry';
import { shouldIgnoreShortcut } from './shortcutGuards';
import { GlobalSettingsPanel } from '../settings/GlobalSettingsPanel';
import { getVisibleSortableColumns } from '../queue/queueColumns';

describe('Shortcuts Integration in PrintQueue', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();

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
    localStorage.clear();
  });

  const mockSettings: PrintSettings = createDefaultGlobalSettings();

  const mockItems: QueueItem[] = [
    {
      id: 'item-1',
      path: '/docs/report1.pdf',
      fileName: 'report1.pdf',
      kind: 'pdf',
      pageCount: 5,
      status: 'ready',
      addedAt: 1000,
      override: {},
    },
    {
      id: 'item-2',
      path: '/docs/report2.pdf',
      fileName: 'report2.pdf',
      kind: 'pdf',
      pageCount: 3,
      status: 'ready',
      addedAt: 2000,
      override: {},
    },
  ];

  it('supports Ctrl+C to copy, Ctrl+X to cut (with is-cut class) and Ctrl+V to paste/move', () => {
    const handleSelectionChange = vi.fn();
    const handleReorderItems = vi.fn();

    const { rerender } = render(
      <PrintQueue
        items={mockItems}
        globalSettings={mockSettings}
        isPrinting={false}
        selectedRowKeys={['item-1']}
        activeId="item-1"
        onSelectionChange={handleSelectionChange}
        onRemove={vi.fn()}
        onOpenSettings={vi.fn()}
        onReorderItems={handleReorderItems}
      />,
    );

    const row1 = document.querySelector('[data-row-id="item-1"]') as HTMLElement;
    expect(row1).not.toBeNull();
    expect(row1.className).not.toContain('is-cut');

    // Pressing 'x' alone WITHOUT ctrl does NOT cut
    fireEvent.keyDown(window, { key: 'x' });
    expect(row1.className).not.toContain('is-cut');

    // Press Ctrl+X to cut
    fireEvent.keyDown(window, { key: 'x', ctrlKey: true });

    // Rerender to reflect is-cut class
    rerender(
      <PrintQueue
        items={mockItems}
        globalSettings={mockSettings}
        isPrinting={false}
        selectedRowKeys={['item-1']}
        activeId="item-1"
        onSelectionChange={handleSelectionChange}
        onRemove={vi.fn()}
        onOpenSettings={vi.fn()}
        onReorderItems={handleReorderItems}
      />,
    );

    expect(row1.className).toContain('is-cut');

    // Press Ctrl+V to paste/move after item-2
    rerender(
      <PrintQueue
        items={mockItems}
        globalSettings={mockSettings}
        isPrinting={false}
        selectedRowKeys={['item-2']}
        activeId="item-2"
        onSelectionChange={handleSelectionChange}
        onRemove={vi.fn()}
        onOpenSettings={vi.fn()}
        onReorderItems={handleReorderItems}
      />,
    );

    fireEvent.keyDown(window, { key: 'v', ctrlKey: true });

    expect(handleReorderItems).toHaveBeenCalledWith(['item-1'], 'item-2', 'after');
  });

  it('clears cut state when Escape is pressed', () => {
    const { rerender } = render(
      <PrintQueue
        items={mockItems}
        globalSettings={mockSettings}
        isPrinting={false}
        selectedRowKeys={['item-1']}
        activeId="item-1"
        onSelectionChange={vi.fn()}
        onRemove={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    const row1 = document.querySelector('[data-row-id="item-1"]') as HTMLElement;
    fireEvent.keyDown(window, { key: 'x', ctrlKey: true });

    rerender(
      <PrintQueue
        items={mockItems}
        globalSettings={mockSettings}
        isPrinting={false}
        selectedRowKeys={['item-1']}
        activeId="item-1"
        onSelectionChange={vi.fn()}
        onRemove={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    expect(row1.className).toContain('is-cut');

    fireEvent.keyDown(window, { key: 'Escape' });

    rerender(
      <PrintQueue
        items={mockItems}
        globalSettings={mockSettings}
        isPrinting={false}
        selectedRowKeys={[]}
        activeId={null}
        onSelectionChange={vi.fn()}
        onRemove={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    expect(row1.className).not.toContain('is-cut');
  });

  it('renders updated context menu with shortcut labels and cut option', () => {
    render(
      <PrintQueue
        items={mockItems}
        globalSettings={mockSettings}
        isPrinting={false}
        selectedRowKeys={['item-1']}
        activeId="item-1"
        onSelectionChange={vi.fn()}
        onRemove={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    const row1 = document.querySelector('[data-row-id="item-1"]') as HTMLElement;
    fireEvent.contextMenu(row1);

    expect(screen.getByRole('menuitem', { name: /打开文件.*Enter/ })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /在文件夹中显示.*L/ })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /文件打印设置.*E/ })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /复制文件项.*Ctrl\+C/ })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /剪切文件项.*Ctrl\+X/ })).toBeDefined();
  });

  it('supports Home and End keys for jumping selection', () => {
    const handleSelectionChange = vi.fn();
    const tableWrap = document.createElement('div');
    document.body.appendChild(tableWrap);

    render(
      <PrintQueue
        items={mockItems}
        globalSettings={mockSettings}
        isPrinting={false}
        selectedRowKeys={['item-1']}
        activeId="item-1"
        onSelectionChange={handleSelectionChange}
        onRemove={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
      { container: tableWrap },
    );

    const tableWrapEl = tableWrap.querySelector('.queue-table-wrap') as HTMLElement;
    expect(tableWrapEl).not.toBeNull();

    // Press End key on table
    fireEvent.keyDown(tableWrapEl, { key: 'End' });
    expect(handleSelectionChange).toHaveBeenCalledWith(['item-2']);

    // Press Home key on table
    fireEvent.keyDown(tableWrapEl, { key: 'Home' });
    expect(handleSelectionChange).toHaveBeenCalledWith(['item-1']);
  });

  it('registers E for file settings, D for sidesMode, and S for colorMode in shortcut definitions', () => {
    const openSettings = SHORTCUT_DEFINITIONS.find((d) => d.id === 'open_settings');
    expect(openSettings?.keys).toEqual(['E']);

    const toggleSides = SHORTCUT_DEFINITIONS.find((d) => d.id === 'toggle_sides');
    expect(toggleSides?.keys).toEqual(['D']);
    expect(toggleSides?.name).toContain('单双面');

    const toggleColor = SHORTCUT_DEFINITIONS.find((d) => d.id === 'toggle_color');
    expect(toggleColor?.keys).toEqual(['S']);
    expect(toggleColor?.name).toContain('黑白/彩色');
  });

  it('renders shortcut hint tooltips for S and D in GlobalSettingsPanel', () => {
    const handleChange = vi.fn();
    render(
      <GlobalSettingsPanel
        settings={mockSettings}
        printers={[]}
        loadingPrinters={false}
        onChange={handleChange}
        onOpenProperties={vi.fn()}
        onRefreshPrinters={vi.fn()}
      />,
    );

    expect(screen.getByText('颜色')).toBeDefined();
    expect(screen.getByText('单双面')).toBeDefined();
  });

  it('computes visibleSortableColumns dynamically based on user window columns', () => {
    // 1. Default visible columns
    const defaultCols = getVisibleSortableColumns([
      'fileName',
      'path',
      'createdAt',
      'modifiedAt',
      'fileSize',
      'kind',
      'settings',
    ]);
    expect(defaultCols.length).toBe(5);
    expect(defaultCols[0]).toEqual({
      key: 'fileName',
      field: 'fileName',
      label: '文件名',
      shortcutNumber: 1,
    });
    expect(defaultCols[1]).toEqual({
      key: 'path',
      field: 'path',
      label: '文件路径',
      shortcutNumber: 2,
    });

    // 2. User hides 'fileName', first column becomes 'path'
    const pathFirstCols = getVisibleSortableColumns(['path', 'createdAt', 'fileSize']);
    expect(pathFirstCols.length).toBe(3);
    expect(pathFirstCols[0]).toEqual({
      key: 'path',
      field: 'path',
      label: '文件路径',
      shortcutNumber: 1,
    });
    expect(pathFirstCols[1]).toEqual({
      key: 'createdAt',
      field: 'createdAt',
      label: '创建时间',
      shortcutNumber: 2,
    });

    // 3. Exactly two sortable columns
    const twoCols = getVisibleSortableColumns(['fileName', 'path']);
    expect(twoCols.length).toBe(2);
    expect(twoCols.map((c) => c.shortcutNumber)).toEqual([1, 2]);
  });

  it('does not render shortcut badges on sortable column headers to keep header clean', () => {
    render(
      <PrintQueue
        items={mockItems}
        globalSettings={mockSettings}
        isPrinting={false}
        selectedRowKeys={[]}
        visibleColumns={['fileName', 'path']}
        onSelectionChange={vi.fn()}
        onRemove={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(screen.queryByText('Ctrl+1')).toBeNull();
    expect(screen.queryByText('Ctrl+2')).toBeNull();
    expect(screen.queryByText('Ctrl+3')).toBeNull();
  });

  it('includes printer and profile switching shortcuts in registry', () => {
    const shiftSelect = SHORTCUT_DEFINITIONS.find((d) => d.id === 'select_printer_1_9');
    const nextPrinter = SHORTCUT_DEFINITIONS.find((d) => d.id === 'next_printer');
    const prevPrinter = SHORTCUT_DEFINITIONS.find((d) => d.id === 'prev_printer');
    const prevProfile = SHORTCUT_DEFINITIONS.find((d) => d.id === 'prev_profile');
    const nextProfile = SHORTCUT_DEFINITIONS.find((d) => d.id === 'next_profile');

    expect(shiftSelect).toBeDefined();
    expect(shiftSelect?.keys).toEqual(['Shift', '1 ~ 9']);

    expect(nextPrinter).toBeDefined();
    expect(nextPrinter?.keys).toEqual([']']);

    expect(prevPrinter).toBeDefined();
    expect(prevPrinter?.keys).toEqual(['[']);

    expect(prevProfile).toBeDefined();
    expect(prevProfile?.keys).toEqual(['-']);

    expect(nextProfile).toBeDefined();
    expect(nextProfile?.keys).toEqual(['=']);
  });

  it('triggers onOpenPrinterManager when clicking manage button in GlobalSettingsPanel', () => {
    const manageSpy = vi.fn();
    render(
      <GlobalSettingsPanel
        printers={[]}
        settings={mockSettings}
        loadingPrinters={false}
        onRefreshPrinters={vi.fn()}
        onOpenPrinterManager={manageSpy}
        onChange={vi.fn()}
      />,
    );

    const manageBtns = screen.getAllByRole('button', { name: '管理' });
    fireEvent.click(manageBtns[0]);
    expect(manageSpy).toHaveBeenCalledTimes(1);
  });
});
