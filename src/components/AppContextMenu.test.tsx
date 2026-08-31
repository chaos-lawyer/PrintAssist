// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContextMenu, type AppContextMenuItem } from './AppContextMenu';

describe('AppContextMenu', () => {
  beforeEach(() => {
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

  it('renders nothing when open is false or position is null', () => {
    const { container: c1 } = render(
      <AppContextMenu
        open={false}
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
        items={[{ key: '1', label: 'Item 1' }]}
      />,
    );
    expect(c1.querySelector('.app-context-menu')).toBeNull();

    const { container: c2 } = render(
      <AppContextMenu
        open={true}
        position={null}
        onClose={vi.fn()}
        items={[{ key: '1', label: 'Item 1' }]}
      />,
    );
    expect(c2.querySelector('.app-context-menu')).toBeNull();
  });

  it('renders menu items and dividers when open', () => {
    const items: AppContextMenuItem[] = [
      { key: 'open', label: '打开文件', shortcut: 'Enter' },
      { type: 'divider' },
      { key: 'delete', label: '删除', danger: true, shortcut: 'Delete' },
    ];

    render(
      <AppContextMenu
        open={true}
        position={{ x: 150, y: 200 }}
        onClose={vi.fn()}
        items={items}
      />,
    );

    expect(screen.getByText('打开文件')).toBeDefined();
    expect(screen.getByText('Enter')).toBeDefined();
    expect(screen.getByText('删除')).toBeDefined();
    expect(screen.getByText('Delete')).toBeDefined();
    expect(document.querySelector('.app-context-menu-divider')).toBeDefined();
  });

  it('calls onClose and item.onClick when an enabled item is clicked', () => {
    const handleClose = vi.fn();
    const handleAction = vi.fn();

    const items: AppContextMenuItem[] = [
      { key: 'action', label: '执行操作', onClick: handleAction },
    ];

    render(
      <AppContextMenu
        open={true}
        position={{ x: 100, y: 100 }}
        onClose={handleClose}
        items={items}
      />,
    );

    const button = screen.getByRole('menuitem', { name: /执行操作/ });
    fireEvent.click(button);

    expect(handleClose).toHaveBeenCalledTimes(1);
    expect(handleAction).toHaveBeenCalledTimes(1);
  });

  it('does not trigger onClick when a disabled item is clicked', () => {
    const handleClose = vi.fn();
    const handleAction = vi.fn();

    const items: AppContextMenuItem[] = [
      { key: 'disabled', label: '禁用项', disabled: true, onClick: handleAction },
    ];

    render(
      <AppContextMenu
        open={true}
        position={{ x: 100, y: 100 }}
        onClose={handleClose}
        items={items}
      />,
    );

    const button = screen.getByRole('menuitem', { name: /禁用项/ });
    fireEvent.click(button);

    expect(handleAction).not.toHaveBeenCalled();
  });

  it('closes on Escape key press', () => {
    const handleClose = vi.fn();

    render(
      <AppContextMenu
        open={true}
        position={{ x: 100, y: 100 }}
        onClose={handleClose}
        items={[{ key: '1', label: 'Item 1' }]}
      />,
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('closes on outside mouse down', () => {
    const handleClose = vi.fn();

    render(
      <div>
        <div data-testid="outside">Outside area</div>
        <AppContextMenu
          open={true}
          position={{ x: 100, y: 100 }}
          onClose={handleClose}
          items={[{ key: '1', label: 'Item 1' }]}
        />
      </div>,
    );

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('supports keyboard navigation with ArrowDown and ArrowUp', () => {
    const items: AppContextMenuItem[] = [
      { key: 'item1', label: 'Item 1' },
      { key: 'item2', label: 'Item 2' },
      { key: 'item3', label: 'Item 3' },
    ];

    render(
      <AppContextMenu
        open={true}
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
        items={items}
      />,
    );

    const btn1 = screen.getByRole('menuitem', { name: /Item 1/ });
    const btn2 = screen.getByRole('menuitem', { name: /Item 2/ });
    const btn3 = screen.getByRole('menuitem', { name: /Item 3/ });

    btn1.focus();
    expect(document.activeElement).toBe(btn1);

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(btn2);

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(btn3);

    // wrap around
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(btn1);

    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(btn3);
  });
});
