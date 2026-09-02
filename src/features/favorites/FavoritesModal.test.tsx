// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FavoritesModal } from './FavoritesModal';
import {
  _setRawFavoritesStorageForTesting,
  addFavorite,
  loadFavorites,
} from './favoriteStorage';
import type { SystemPrinter } from '../../shared/contracts/printer';

describe('FavoritesModal', () => {
  beforeEach(() => {
    cleanup();
    _setRawFavoritesStorageForTesting(null);
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
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

  const mockPrinters: SystemPrinter[] = [
    {
      name: 'Canon TS8300',
      isDefault: true,
      portName: 'USB001',
      state: 'ready' as const,
      statusCode: 0,
      color: { support: 'supported', source: 'driver' },
      duplex: { support: 'supported', source: 'driver' },
    },
  ];

  it('renders empty state when there are no favorites', () => {
    const handleAdd = vi.fn();
    render(
      <FavoritesModal
        open={true}
        onClose={() => {}}
        onLoadFavorite={() => {}}
        onOpenAddFavorite={handleAdd}
        isPrinting={false}
        systemPrinters={mockPrinters}
        customShortcuts={{}}
        onSetCustomShortcut={() => {}}
      />,
    );

    expect(screen.getByText(/暂无收藏模板/)).toBeDefined();
    const btn = screen.getByRole('button', { name: /创建第一个收藏/ });
    fireEvent.click(btn);
    expect(handleAdd).toHaveBeenCalledTimes(1);
  });

  it('renders favorites list and triggers load', async () => {
    const fav = addFavorite({
      name: '日报打印',
      printer: { name: 'Canon TS8300' },
      printConfig: {
        persistentProfileId: 'prof_1',
        persistentProfileName: '彩色双面',
        standardSettings: {} as any,
      },
      task: {
        items: [
          {
            path: '/docs/report.pdf',
            fileName: 'report.pdf',
            kind: 'pdf',
            pageCount: 2,
            override: {},
          },
        ],
      },
    });

    const handleLoad = vi.fn();
    const handleClose = vi.fn();

    const TestComponent = () => {
      const [isOpen, setIsOpen] = React.useState(true);
      return (
        <FavoritesModal
          open={isOpen}
          onClose={() => {
            setIsOpen(false);
            handleClose();
          }}
          onLoadFavorite={handleLoad}
          onOpenAddFavorite={() => {}}
          isPrinting={false}
          systemPrinters={mockPrinters}
          customShortcuts={{}}
          onSetCustomShortcut={() => {}}
        />
      );
    };

    render(<TestComponent />);

    expect(screen.getByText('日报打印')).toBeDefined();
    expect(screen.getByText('1 个文件')).toBeDefined();
    expect(screen.getByText('Canon TS8300')).toBeDefined();
    expect(screen.getByText('彩色双面')).toBeDefined();

    const loadBtns = screen.getAllByRole('button', { name: /加载/ });
    fireEvent.click(loadBtns[0]);

    expect(handleLoad).toHaveBeenCalledWith(expect.objectContaining({ id: fav.id }));
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('triggers load using number key 1~9 in modal scope', () => {
    const fav = addFavorite({
      name: '快捷模板1',
      printer: null,
      printConfig: null,
      task: null,
    });

    const handleLoad = vi.fn();

    render(
      <FavoritesModal
        open={true}
        onClose={() => {}}
        onLoadFavorite={handleLoad}
        onOpenAddFavorite={() => {}}
        isPrinting={false}
        systemPrinters={mockPrinters}
        customShortcuts={{}}
        onSetCustomShortcut={() => {}}
      />,
    );

    // Press '1'
    fireEvent.keyDown(window, { key: '1' });
    expect(handleLoad).toHaveBeenCalledWith(expect.objectContaining({ id: fav.id }));
  });

  it('filters favorites by search query and segmented filter', () => {
    addFavorite({
      name: '发票模板',
      printer: { name: 'Canon TS8300' },
      printConfig: null,
      task: null,
    });
    addFavorite({
      name: '离线测试模板',
      printer: { name: 'NonExistentPrinter' },
      printConfig: null,
      task: null,
    });

    render(
      <FavoritesModal
        open={true}
        onClose={() => {}}
        onLoadFavorite={() => {}}
        onOpenAddFavorite={() => {}}
        isPrinting={false}
        systemPrinters={mockPrinters}
        customShortcuts={{}}
        onSetCustomShortcut={() => {}}
      />,
    );

    expect(screen.getByText('发票模板')).toBeDefined();
    expect(screen.getByText('离线测试模板')).toBeDefined();

    // Search
    const searchInput = screen.getByPlaceholderText(/搜索收藏名称/);
    fireEvent.change(searchInput, { target: { value: '发票' } });

    expect(screen.getByText('发票模板')).toBeDefined();
    expect(screen.queryByText('离线测试模板')).toBeNull();
  });
});
