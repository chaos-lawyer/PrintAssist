// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedPrinterProfileSummary } from '../../shared/contracts/printer';
import { PrinterProfileManagerModal } from './PrinterProfileManagerModal';

describe('PrinterProfileManagerModal Context Menu', () => {
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

  const mockProfiles: SavedPrinterProfileSummary[] = [
    {
      id: 'profile-1',
      name: '双面黑白经济',
      printerName: 'Test Printer',
      summary: 'A4 · 双面',
      settings: { printerName: 'Test Printer', driverExtraBytes: 0 },
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
      isDefault: true,
      compatibility: 'compatible',
    },
    {
      id: 'profile-2',
      name: '单面彩色高质量',
      printerName: 'Test Printer',
      summary: 'A4 · 单面',
      settings: { printerName: 'Test Printer', driverExtraBytes: 0 },
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
      isDefault: false,
      compatibility: 'compatible',
    },
  ];

  it('opens context menu on profile card right click', () => {
    render(
      <PrinterProfileManagerModal
        open={true}
        currentPrinterName="Test Printer"
        profiles={mockProfiles}
        onClose={vi.fn()}
        onRefreshProfiles={vi.fn().mockResolvedValue(undefined)}
        onApplyProfile={vi.fn()}
      />,
    );

    const cardTitle = screen.getByText('双面黑白经济');
    const card = cardTitle.closest('.profile-card');
    expect(card).not.toBeNull();

    fireEvent.contextMenu(card!, { clientX: 200, clientY: 200 });

    expect(screen.getByRole('menuitem', { name: /重命名/ })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /复制配置/ })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /导出配置/ })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /删除配置/ })).toBeDefined();
  });

  it('opens context menu on more button click', () => {
    render(
      <PrinterProfileManagerModal
        open={true}
        currentPrinterName="Test Printer"
        profiles={mockProfiles}
        onClose={vi.fn()}
        onRefreshProfiles={vi.fn().mockResolvedValue(undefined)}
        onApplyProfile={vi.fn()}
      />,
    );

    const moreButtons = screen.getAllByRole('button', { name: /更多操作/ });
    expect(moreButtons.length).toBeGreaterThan(0);

    fireEvent.click(moreButtons[0]);

    expect(screen.getByRole('menuitem', { name: /重命名/ })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /复制配置/ })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /导出配置/ })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /删除配置/ })).toBeDefined();
  });
});
