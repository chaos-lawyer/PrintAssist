// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultGlobalSettings } from '../../domain/printSettings';
import type { QueueItem } from '../../domain/queueTypes';
import { DEFAULT_COLUMN_WIDTHS, getDirectoryOnly, PrintQueue } from './PrintQueue';

describe('PrintQueue Table Features (Width Adjustment & Directory Path Display)', () => {
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
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  describe('getDirectoryOnly', () => {
    it('extracts parent directory from Windows absolute path', () => {
      expect(getDirectoryOnly('C:\\Users\\Alice\\Documents\\report.pdf')).toBe(
        'C:\\Users\\Alice\\Documents',
      );
      expect(getDirectoryOnly('D:\\Projects\\Sub\\file.docx')).toBe(
        'D:\\Projects\\Sub',
      );
    });

    it('handles Windows root directory correctly', () => {
      expect(getDirectoryOnly('C:\\report.pdf')).toBe('C:\\');
      expect(getDirectoryOnly('D:\\invoice.xlsx')).toBe('D:\\');
    });

    it('extracts parent directory from Unix paths', () => {
      expect(getDirectoryOnly('/Users/chaos/Projects/file.pdf')).toBe(
        '/Users/chaos/Projects',
      );
      expect(getDirectoryOnly('/file.pdf')).toBe('/');
    });

    it('returns dash when no directory is present or path is empty', () => {
      expect(getDirectoryOnly('just_file.pdf')).toBe('—');
      expect(getDirectoryOnly('')).toBe('—');
    });
  });

  describe('Table rendering and interactions', () => {
    const mockItems: QueueItem[] = [
      {
        id: 'doc-1',
        path: 'C:\\Users\\Alice\\Documents\\QuarterlyReport.pdf',
        fileName: 'QuarterlyReport.pdf',
        kind: 'pdf',
        fileSize: 10240,
        createdAt: 1600000000000,
        modifiedAt: 1600000000000,
        addedAt: 1600000000000,
        pageCount: 5,
        status: 'pending',
        override: {},
      },
    ];

    it('renders directory only in path column, not the filename', () => {
      render(
        <PrintQueue
          items={mockItems}
          globalSettings={createDefaultGlobalSettings()}
          isPrinting={false}
          selectedRowKeys={[]}
          onSelectionChange={vi.fn()}
          onRemove={vi.fn()}
          onOpenSettings={vi.fn()}
        />,
      );

      // Should display directory C:\Users\Alice\Documents
      expect(screen.getByText('C:\\Users\\Alice\\Documents')).toBeDefined();
      // Filename should NOT be inside the path column
      const pathCell = screen.getByText('C:\\Users\\Alice\\Documents');
      expect(pathCell.textContent).toBe('C:\\Users\\Alice\\Documents');
    });

    it('renders column resizer handles in table headers', () => {
      render(
        <PrintQueue
          items={mockItems}
          globalSettings={createDefaultGlobalSettings()}
          isPrinting={false}
          selectedRowKeys={[]}
          onSelectionChange={vi.fn()}
          onRemove={vi.fn()}
          onOpenSettings={vi.fn()}
        />,
      );

      const resizers = document.querySelectorAll('.queue-col-resizer');
      expect(resizers.length).toBeGreaterThan(0);
    });

    it('resizes column width on drag and persists to localStorage', () => {
      render(
        <PrintQueue
          items={mockItems}
          globalSettings={createDefaultGlobalSettings()}
          isPrinting={false}
          selectedRowKeys={[]}
          onSelectionChange={vi.fn()}
          onRemove={vi.fn()}
          onOpenSettings={vi.fn()}
        />,
      );

      const pathResizer = screen.getAllByLabelText('调整 文件路径 列宽')[0];
      expect(pathResizer).toBeDefined();

      // Start drag at x = 100
      fireEvent.mouseDown(pathResizer, { clientX: 100 });
      // Move to x = 180 (delta +80)
      fireEvent.mouseMove(window, { clientX: 180 });
      fireEvent.mouseUp(window);

      const saved = localStorage.getItem('printassist_queue_column_widths');
      expect(saved).not.toBeNull();
      const parsed = JSON.parse(saved!);
      expect(parsed.path).toBe(DEFAULT_COLUMN_WIDTHS.path + 80);
    });

    it('resets column width to default on double click', () => {
      localStorage.setItem(
        'printassist_queue_column_widths',
        JSON.stringify({ path: 380 }),
      );

      render(
        <PrintQueue
          items={mockItems}
          globalSettings={createDefaultGlobalSettings()}
          isPrinting={false}
          selectedRowKeys={[]}
          onSelectionChange={vi.fn()}
          onRemove={vi.fn()}
          onOpenSettings={vi.fn()}
        />,
      );

      const pathResizer = screen.getAllByLabelText('调整 文件路径 列宽')[0];
      fireEvent.doubleClick(pathResizer);

      const saved = localStorage.getItem('printassist_queue_column_widths');
      const parsed = JSON.parse(saved!);
      expect(parsed.path).toBe(DEFAULT_COLUMN_WIDTHS.path);
    });

    it('allows user to hide and restore the actions column', () => {
      render(
        <PrintQueue
          items={mockItems}
          globalSettings={createDefaultGlobalSettings()}
          isPrinting={false}
          selectedRowKeys={[]}
          onSelectionChange={vi.fn()}
          onRemove={vi.fn()}
          onOpenSettings={vi.fn()}
        />,
      );

      // Actions column button should initially be present
      expect(screen.getByRole('button', { name: '设置此文件参数' })).toBeDefined();

      // Open header context menu
      const header = screen.getAllByText('创建时间')[0];
      fireEvent.contextMenu(header);

      // "操作" should be in the column visibility list
      const actionsMenuItem = screen.getByRole('menuitem', { name: /操作/ });
      expect(actionsMenuItem).toBeDefined();

      // Click "操作" to hide it
      fireEvent.click(actionsMenuItem);

      // Actions column button should now be gone
      expect(screen.queryByRole('button', { name: '设置此文件参数' })).toBeNull();

      // Open header context menu again and restore default columns
      const headerAgain = screen.getAllByText('创建时间')[0];
      fireEvent.contextMenu(headerAgain);
      const resetItem = screen.getByRole('menuitem', { name: /恢复默认列/ });
      fireEvent.click(resetItem);

      // Actions column button should be restored
      expect(screen.getByRole('button', { name: '设置此文件参数' })).toBeDefined();
    });

    it('automatically hides horizontal scroll when container is wide enough and shows it when narrow', () => {
      let resizeCallback: () => void = () => {};
      global.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
        constructor(cb: any) {
          resizeCallback = cb;
        }
      } as any;

      const { container } = render(
        <PrintQueue
          items={mockItems}
          globalSettings={createDefaultGlobalSettings()}
          isPrinting={false}
          selectedRowKeys={[]}
          onSelectionChange={vi.fn()}
          onRemove={vi.fn()}
          onOpenSettings={vi.fn()}
        />,
      );

      const tableWrap = container.querySelector('.queue-table-wrap');
      expect(tableWrap).not.toBeNull();

      // Case 1: Wide container (1800px) -> columns fit comfortably
      act(() => {
        Object.defineProperty(tableWrap, 'clientWidth', { configurable: true, value: 1800 });
        resizeCallback();
      });

      // Should not have horizontal scroll container
      expect(container.querySelector('.ant-table-scroll-horizontal')).toBeNull();

      // Case 2: Narrow container (600px) -> columns overflow
      act(() => {
        Object.defineProperty(tableWrap, 'clientWidth', { configurable: true, value: 600 });
        resizeCallback();
      });

      // Should enable horizontal scroll
      expect(container.querySelector('.ant-table-scroll-horizontal')).not.toBeNull();
    });
  });
});
