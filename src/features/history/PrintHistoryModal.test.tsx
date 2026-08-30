// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrintHistoryModal } from './PrintHistoryModal';
import {
  clearPrintHistory,
  loadPrintHistory,
  savePrintHistoryRecord,
} from './historyStorage';

describe('PrintHistoryModal', () => {
  afterEach(() => {
    cleanup();
  });
  beforeEach(() => {
    clearPrintHistory();
    // Setup matchMedia mock for Ant Design
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

    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  const setupSampleData = () => {
    savePrintHistoryRecord({
      printerName: 'Office-HP-LaserJet',
      totalFiles: 3,
      succeededCount: 3,
      failedCount: 0,
      skippedCount: 0,
      files: [
        { fileName: 'Document1.pdf', path: 'C:\\docs\\Document1.pdf', status: 'succeeded' },
        { fileName: 'Document2.docx', path: 'C:\\docs\\Document2.docx', status: 'succeeded' },
        { fileName: 'Document3.xlsx', path: 'C:\\docs\\Document3.xlsx', status: 'succeeded' },
      ],
    });

    savePrintHistoryRecord({
      printerName: 'Warehouse-Canon-Printer',
      totalFiles: 1,
      succeededCount: 0,
      failedCount: 1,
      skippedCount: 0,
      files: [
        {
          fileName: 'ShippingLabel.pdf',
          path: 'C:\\labels\\ShippingLabel.pdf',
          status: 'failed',
          message: '纸张卡住',
        },
      ],
    });
  };

  it('renders empty state when there are no history records', () => {
    render(<PrintHistoryModal open={true} onClose={() => {}} onReloadFiles={() => {}} />);
    expect(screen.getByText('暂无打印历史记录')).toBeDefined();
  });

  it('renders table columns directly without requiring row expansion', () => {
    setupSampleData();
    render(<PrintHistoryModal open={true} onClose={() => {}} onReloadFiles={() => {}} />);

    // Batch 1 (Warehouse-Canon-Printer, newest)
    expect(screen.getByText('Warehouse-Canon-Printer')).toBeDefined();
    expect(screen.getByText('ShippingLabel.pdf')).toBeDefined();
    expect(screen.getByText('1 个')).toBeDefined();
    expect(screen.getByText('全部失败')).toBeDefined();

    // Batch 2 (Office-HP-LaserJet)
    expect(screen.getByText('Office-HP-LaserJet')).toBeDefined();
    expect(screen.getByText('Document1.pdf')).toBeDefined();
    expect(screen.getByText('Document2.docx')).toBeDefined();
    expect(screen.getByText('另 1 个')).toBeDefined();
    expect(screen.getByText('3 个')).toBeDefined();
    expect(screen.getByText('全部成功')).toBeDefined();
  });

  it('provides reload button without visible text but with aria-label', () => {
    setupSampleData();
    const handleReloadFiles = vi.fn();
    const handleClose = vi.fn();

    render(
      <PrintHistoryModal
        open={true}
        onClose={handleClose}
        onReloadFiles={handleReloadFiles}
      />
    );

    const reloadButtons = screen.getAllByRole('button', { name: '重新加载此批文件' });
    expect(reloadButtons.length).toBe(2);

    // Verify there is no visible text like "重新载入这批文件"
    expect(screen.queryByText('重新载入这批文件')).toBeNull();

    // Click reload on the first row (Warehouse-Canon-Printer with 1 file)
    fireEvent.click(reloadButtons[0]);

    expect(handleReloadFiles).toHaveBeenCalledWith(['C:\\labels\\ShippingLabel.pdf']);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('toggles favorite with aria-pressed attribute and updates persistence', async () => {
    setupSampleData();
    render(<PrintHistoryModal open={true} onClose={() => {}} onReloadFiles={() => {}} />);

    const favoriteButtons = screen.getAllByRole('button', { name: '收藏此记录' });
    expect(favoriteButtons.length).toBe(2);
    expect(favoriteButtons[0].getAttribute('aria-pressed')).toBe('false');

    // Click to favorite
    fireEvent.click(favoriteButtons[0]);

    await waitFor(() => {
      expect(favoriteButtons[0].getAttribute('aria-pressed')).toBe('true');
    });

    // Check persistence
    const saved = loadPrintHistory();
    expect(saved[0].isFavorite).toBe(true);

    // Click to unfavorite
    fireEvent.click(favoriteButtons[0]);
    await waitFor(() => {
      expect(favoriteButtons[0].getAttribute('aria-pressed')).toBe('false');
    });
    expect(loadPrintHistory()[0].isFavorite).toBe(false);
  });

  it('filters by search keyword and favorite status, and displays empty filter state', () => {
    setupSampleData();
    render(<PrintHistoryModal open={true} onClose={() => {}} onReloadFiles={() => {}} />);

    const searchInput = screen.getByPlaceholderText('搜索文件名...');
    fireEvent.change(searchInput, { target: { value: 'ShippingLabel' } });

    // Should only show ShippingLabel, not Document1
    expect(screen.getByText('ShippingLabel.pdf')).toBeDefined();
    expect(screen.queryByText('Document1.pdf')).toBeNull();

    // Search for non-existent file
    fireEvent.change(searchInput, { target: { value: 'NonExistentXYZ' } });
    expect(screen.getByText('没有符合条件的打印记录')).toBeDefined();

    // Click "清除筛选" button
    const clearFilterBtn = screen.getByRole('button', { name: '清除筛选' });
    fireEvent.click(clearFilterBtn);

    // Both records should be back
    expect(screen.getByText('ShippingLabel.pdf')).toBeDefined();
    expect(screen.getByText('Document1.pdf')).toBeDefined();
  });

  it('expands row to show detailed file status and message', () => {
    setupSampleData();
    render(<PrintHistoryModal open={true} onClose={() => {}} onReloadFiles={() => {}} />);

    // Click on filename area of ShippingLabel.pdf to expand
    const filenameCell = screen.getByText('ShippingLabel.pdf').closest('.history-filename-cell');
    expect(filenameCell).not.toBeNull();
    if (filenameCell) {
      fireEvent.click(filenameCell);
    }

    // Now error message "纸张卡住" from expanded row should be visible
    expect(screen.getByText('纸张卡住')).toBeDefined();
  });

  it('clicking favorite button does not expand row', () => {
    setupSampleData();
    render(<PrintHistoryModal open={true} onClose={() => {}} onReloadFiles={() => {}} />);

    const favoriteButtons = screen.getAllByRole('button', { name: '收藏此记录' });
    fireEvent.click(favoriteButtons[0]);

    // Row should NOT have expanded, so "纸张卡住" should not be visible
    expect(screen.queryByText('纸张卡住')).toBeNull();
  });

  it('handles reload with no valid file paths safely without calling onReloadFiles', () => {
    savePrintHistoryRecord({
      printerName: 'Virtual-Printer',
      totalFiles: 1,
      succeededCount: 1,
      failedCount: 0,
      skippedCount: 0,
      files: [{ fileName: 'NoPath.pdf', path: '', status: 'succeeded' }],
    });
    const handleReloadFiles = vi.fn();
    const handleClose = vi.fn();

    render(
      <PrintHistoryModal
        open={true}
        onClose={handleClose}
        onReloadFiles={handleReloadFiles}
      />
    );

    const reloadBtn = screen.getByRole('button', { name: '重新加载此批文件' });
    fireEvent.click(reloadBtn);

    expect(handleReloadFiles).not.toHaveBeenCalled();
    expect(handleClose).not.toHaveBeenCalled();
  });
});
