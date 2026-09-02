// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddFavoriteModal } from './AddFavoriteModal';
import { _setRawFavoritesStorageForTesting, addFavorite } from './favoriteStorage';
import type { PrintSettings } from '../../domain/printSettings';

describe('AddFavoriteModal', () => {
  beforeEach(() => {
    cleanup();
    _setRawFavoritesStorageForTesting(null);
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

  const mockSettings: PrintSettings = {
    printerName: 'Epson L3150',
    colorMode: 'color',
    sidesMode: 'simplex',
    flipMode: 'longEdge',
    copies: 1,
    collateMode: 'byDocument',
    collate: true,
    nupLayout: { cols: 1, rows: 1 },
    nupScope: 'perFile',
    pageRange: { mode: 'all', expression: '' },
  };

  it('renders default name and submits favorite template', () => {
    const handleSave = vi.fn();
    const handleClose = vi.fn();

    const currentQueue = [
      {
        id: 'item_1',
        path: '/docs/Invoice.pdf',
        fileName: 'Invoice.pdf',
        kind: 'pdf' as const,
        pageCount: 1,
        status: 'ready' as const,
        override: {},
        addedAt: 1000,
      },
    ];

    render(
      <AddFavoriteModal
        open={true}
        onClose={handleClose}
        onSave={handleSave}
        currentQueue={currentQueue}
        currentPrinterName="Epson L3150"
        currentProfileName="双面节墨"
        currentPersistentProfileId="prof_epson_1"
        currentSettings={mockSettings}
      />,
    );

    expect(screen.getByDisplayValue('Invoice')).toBeDefined();
    expect(screen.getByText(/当前待打印文件任务（1 个文件）/)).toBeDefined();
    expect(screen.getByText(/目标打印机：Epson L3150/)).toBeDefined();
    expect(screen.getByText('双面节墨')).toBeDefined();

    const saveBtn = screen.getByRole('button', { name: '保存收藏' });
    fireEvent.click(saveBtn);

    expect(handleSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Invoice',
        task: expect.objectContaining({
          items: [
            expect.objectContaining({
              fileName: 'Invoice.pdf',
              path: '/docs/Invoice.pdf',
            }),
          ],
        }),
        printer: { name: 'Epson L3150' },
        printConfig: expect.objectContaining({
          persistentProfileId: 'prof_epson_1',
          persistentProfileName: '双面节墨',
        }),
      }),
    );
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('prevents saving when duplicate name is entered', () => {
    addFavorite({
      name: '已有模板',
      printer: null,
      printConfig: null,
      task: null,
    });

    const handleSave = vi.fn();

    render(
      <AddFavoriteModal
        open={true}
        onClose={() => {}}
        onSave={handleSave}
        currentQueue={[]}
        currentPrinterName="HP LaserJet"
        currentSettings={mockSettings}
      />,
    );

    const input = screen.getByPlaceholderText(/请输入收藏名称/);
    fireEvent.change(input, { target: { value: '已有模板' } });

    expect(screen.getByText(/已存在名为“已有模板”的收藏/)).toBeDefined();
    const saveBtn = screen.getByRole('button', { name: '保存收藏' });
    expect(saveBtn.hasAttribute('disabled')).toBe(true);
  });
});
