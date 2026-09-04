// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultGlobalSettings, type PrintSettings } from '../../domain/printSettings';
import { NupSettings } from './NupSettings';

describe('NupSettings component', () => {
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

    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('renders only tier-1 mode switch when N-up is disabled', () => {
    const settings = createDefaultGlobalSettings();
    render(<NupSettings settings={settings} onChange={() => {}} />);

    // Segmented mode options
    expect(screen.getByText('不拼接')).toBeDefined();
    expect(screen.getByText('拼接')).toBeDefined();

    // Nested panel should NOT be visible
    expect(screen.queryByLabelText('拼接布局设置')).toBeNull();
    expect(screen.queryByLabelText('快捷模板')).toBeNull();
    expect(screen.queryByLabelText('横向页数（列）')).toBeNull();
  });

  it('toggles from "不拼接" to "拼接" with default 2x1 layout', () => {
    const settings = createDefaultGlobalSettings();
    const handleChange = vi.fn();

    render(<NupSettings settings={settings} onChange={handleChange} />);

    // Click "拼接"
    const nupSegmentOption = screen.getByText('拼接');
    fireEvent.click(nupSegmentOption);

    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        nupLayout: { cols: 2, rows: 1 },
      })
    );
  });

  it('renders inputs and scope when N-up is active', () => {
    const settings: PrintSettings = {
      ...createDefaultGlobalSettings(),
      nupLayout: { cols: 2, rows: 1 },
    };

    render(<NupSettings settings={settings} onChange={() => {}} />);

    // Nested panel and submenu classes
    const panel = screen.getByLabelText('拼接布局设置');
    expect(panel).toBeDefined();
    expect(panel.classList.contains('setting-submenu')).toBe(true);
    expect(panel.classList.contains('setting-submenu-wide')).toBe(true);
    expect(panel.classList.contains('nup-config-panel')).toBe(true);
    expect(screen.queryByLabelText('快捷模板')).toBeNull();

    // Inputs
    const colsInput = screen.getByLabelText('横向页数（列）');
    const rowsInput = screen.getByLabelText('纵向页数（行）');
    expect(colsInput).toBeDefined();
    expect(rowsInput).toBeDefined();

    // Scope
    expect(screen.getByText('文件独立')).toBeDefined();
    expect(screen.getByText('跨文件拼接')).toBeDefined();
  });

  it('updates layout when modifying col and row inputs', () => {
    const settings: PrintSettings = {
      ...createDefaultGlobalSettings(),
      nupLayout: { cols: 2, rows: 1 },
    };
    const handleChange = vi.fn();

    render(<NupSettings settings={settings} onChange={handleChange} />);

    const rowsInput = screen.getByLabelText('纵向页数（行）');
    fireEvent.change(rowsInput, { target: { value: '2' } });

    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        nupLayout: { cols: 2, rows: 2 },
      })
    );
  });

  it('restores last valid layout when toggling off and on within session', () => {
    let currentSettings: PrintSettings = {
      ...createDefaultGlobalSettings(),
      nupLayout: { cols: 3, rows: 2 },
    };
    const handleChange = vi.fn((next) => {
      currentSettings = next;
    });

    const { rerender } = render(
      <NupSettings settings={currentSettings} onChange={handleChange} />
    );

    // Toggle to "不拼接"
    fireEvent.click(screen.getByText('不拼接'));
    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        nupLayout: { cols: 1, rows: 1 },
      })
    );

    rerender(<NupSettings settings={currentSettings} onChange={handleChange} />);

    // Toggle back to "拼接"
    fireEvent.click(screen.getByText('拼接'));
    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        nupLayout: { cols: 3, rows: 2 },
      })
    );
  });

  it('preserves legacy 1x2 layout without overwriting', () => {
    const settings1x2: PrintSettings = {
      ...createDefaultGlobalSettings(),
      nupLayout: { cols: 1, rows: 2 },
    };

    render(<NupSettings settings={settings1x2} onChange={() => {}} />);

    expect((screen.getByLabelText('横向页数（列）') as HTMLInputElement).value).toBe('1');
    expect((screen.getByLabelText('纵向页数（行）') as HTMLInputElement).value).toBe('2');
  });

  it('changes nupScope when selecting scope options', () => {
    const settings: PrintSettings = {
      ...createDefaultGlobalSettings(),
      nupLayout: { cols: 2, rows: 2 },
      nupScope: 'perFile',
    };
    const handleChange = vi.fn();

    render(<NupSettings settings={settings} onChange={handleChange} />);

    const crossFileOption = screen.getByText('跨文件拼接');
    fireEvent.click(crossFileOption);

    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        nupScope: 'crossFile',
      })
    );
  });
});
