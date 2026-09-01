// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedPrinterProfileSummary } from '../../shared/contracts/printer';
import { ShortcutHelpModal } from './ShortcutHelpModal';

describe('ShortcutHelpModal', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
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

  it('renders three-column compact layout without single key switch', () => {
    render(
      <ShortcutHelpModal
        open={true}
        onClose={vi.fn()}
        savedProfiles={mockProfiles}
        printerName="HP LaserJet"
      />,
    );

    expect(screen.getByText('快捷键')).toBeDefined();
    // Verify single key switch banner was completely removed
    expect(screen.queryByText('启用单键快捷键')).toBeNull();

    // Verify 3 columns
    expect(screen.getByText('文件与队列')).toBeDefined();
    expect(screen.getByText('设置与配置')).toBeDefined();
    expect(screen.getByText('打印控制与导航')).toBeDefined();

    // Items
    expect(screen.getByText('添加文件')).toBeDefined();
    expect(screen.getByText('添加文件夹')).toBeDefined();
    expect(screen.getByText('开始打印')).toBeDefined();
    expect(screen.getByText('上一配置')).toBeDefined();
    expect(screen.getByText('下一配置')).toBeDefined();
  });

  it('does not render printer/profile mapping previews', () => {
    render(
      <ShortcutHelpModal
        open={true}
        onClose={vi.fn()}
        savedProfiles={mockProfiles}
        activeProfileId="prof-1"
        printerName="HP LaserJet"
      />,
    );

    expect(screen.queryByText('双面黑白经济模式')).toBeNull();
    expect(screen.queryByText('单面全彩高清模式')).toBeNull();
    expect(screen.queryByText(/配置映射/)).toBeNull();
    expect(screen.queryByText(/可见打印机映射/)).toBeNull();
  });

  it('toggles custom shortcuts editing mode', () => {
    render(
      <ShortcutHelpModal
        open={true}
        onClose={vi.fn()}
        savedProfiles={[]}
        printerName="HP LaserJet"
      />,
    );

    const customizeBtn = screen.getByRole('button', { name: /自定义快捷键/ });
    fireEvent.click(customizeBtn);

    expect(screen.getByText('自定义模式')).toBeDefined();
    expect(screen.getByText(/点击任意快捷键项进入按键录制状态/)).toBeDefined();

    // Click again to exit customization
    const doneBtn = screen.getByRole('button', { name: /完成自定义/ });
    fireEvent.click(doneBtn);
    expect(screen.queryByText('自定义模式')).toBeNull();
  });

  it('renders sortable columns when provided', () => {
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
  });
});
