// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedPrinterProfileSummary } from '../../shared/contracts/printer';
import { ShortcutHelpModal } from './ShortcutHelpModal';
import { getSingleKeyShortcutsEnabled, setSingleKeyShortcutsEnabled } from './shortcutRegistry';

describe('ShortcutHelpModal', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    setSingleKeyShortcutsEnabled(true);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  const mockProfiles: SavedPrinterProfileSummary[] = [
    {
      id: 'prof-1',
      printerName: 'HP LaserJet',
      name: '双面黑白经济模式',
      compatibility: 'compatible',
      isDefault: false,
      summary: 'A4, 单面, 600 DPI',
      settings: {} as any,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
    {
      id: 'prof-2',
      printerName: 'HP LaserJet',
      name: '单面全彩高清模式',
      compatibility: 'compatible',
      isDefault: false,
      summary: 'A4, 双面, 1200 DPI',
      settings: {} as any,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
  ];

  it('renders shortcut categories and items when open', () => {
    render(
      <ShortcutHelpModal
        open={true}
        onClose={vi.fn()}
        savedProfiles={mockProfiles}
        printerName="HP LaserJet"
      />,
    );

    expect(screen.getByText('快捷键')).toBeDefined();
    expect(screen.getByText('启用单键快捷键')).toBeDefined();
    expect(screen.getByText('文件与队列')).toBeDefined();
    expect(screen.getByText('添加文件')).toBeDefined();
    expect(screen.getByText('添加文件夹')).toBeDefined();
    expect(screen.getByText('打印控制')).toBeDefined();

    // Keycaps
    expect(screen.getAllByText('A').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('F')).toBeDefined();
    expect(screen.getByText('Enter')).toBeDefined();
  });

  it('renders available printer profiles mapped to 1 and 2', () => {
    render(
      <ShortcutHelpModal
        open={true}
        onClose={vi.fn()}
        savedProfiles={mockProfiles}
        activeProfileId="prof-1"
        printerName="HP LaserJet"
      />,
    );

    expect(screen.getByText('双面黑白经济模式')).toBeDefined();
    expect(screen.getByText('单面全彩高清模式')).toBeDefined();
    expect(screen.getByText('当前')).toBeDefined();
  });

  it('toggles single key shortcuts setting and persists to localStorage', () => {
    render(
      <ShortcutHelpModal
        open={true}
        onClose={vi.fn()}
        savedProfiles={[]}
        printerName="HP LaserJet"
      />,
    );

    const switchBtn = screen.getByRole('switch');
    expect(switchBtn.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(switchBtn);
    expect(getSingleKeyShortcutsEnabled()).toBe(false);

    // Reset button restores to true
    const resetBtn = screen.getByRole('button', { name: /恢复默认设置/ });
    fireEvent.click(resetBtn);
    expect(getSingleKeyShortcutsEnabled()).toBe(true);
  });

  it('renders only Ctrl+1/2 when exactly two sortable columns are displayed', () => {
    render(
      <ShortcutHelpModal
        open={true}
        onClose={vi.fn()}
        savedProfiles={[]}
        sortableColumns={[
          { field: 'fileName', key: 'fileName', label: '文件名', shortcutNumber: 1 },
          { field: 'path', key: 'path', label: '文件路径', shortcutNumber: 2 },
        ]}
      />,
    );

    expect(screen.getByText('按文件名排序')).toBeDefined();
    expect(screen.getByText('按文件路径排序')).toBeDefined();
    expect(screen.queryByText('按创建时间排序')).toBeNull();
  });

  it('adapts when first column is path: displays Ctrl+1 for path and Ctrl+2 for createdAt', () => {
    render(
      <ShortcutHelpModal
        open={true}
        onClose={vi.fn()}
        savedProfiles={[]}
        sortableColumns={[
          { field: 'path', key: 'path', label: '文件路径', shortcutNumber: 1 },
          { field: 'createdAt', key: 'createdAt', label: '创建时间', shortcutNumber: 2 },
        ]}
      />,
    );

    expect(screen.getByText('按文件路径排序')).toBeDefined();
    expect(screen.getByText('按当前第 1 列（文件路径）排序，按一下正序，再按一下逆序')).toBeDefined();
    expect(screen.getByText('按创建时间排序')).toBeDefined();
    expect(screen.getByText('按当前第 2 列（创建时间）排序，按一下正序，再按一下逆序')).toBeDefined();
    expect(screen.queryByText('按文件名排序')).toBeNull();
  });
});
