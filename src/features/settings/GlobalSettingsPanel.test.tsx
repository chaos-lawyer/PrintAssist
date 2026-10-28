// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalSettingsPanel } from './GlobalSettingsPanel';
import { createDefaultGlobalSettings, type PrintSettings } from '../../domain/printSettings';
import type { SystemPrinter } from '../../shared/contracts/printer';

vi.mock('../../api/printerApi', () => ({
  listPrinterPaperSources: vi.fn().mockResolvedValue({ status: 'unsupported', sources: [] }),
}));

describe('GlobalSettingsPanel', () => {
  beforeEach(() => {
    window.matchMedia =
      window.matchMedia ||
      function () {
        return {
          matches: false,
          addListener: () => {},
          removeListener: () => {},
        };
      };
  });

  afterEach(() => {
    cleanup();
  });

  const mockPrinter: SystemPrinter = {
    name: 'Office-Duplex-Printer',
    portName: 'USB001',
    state: 'ready',
    statusCode: 0,
    isDefault: true,
    color: { support: 'supported', source: 'driver' },
    duplex: { support: 'supported', source: 'driver' },
  };

  const mockSimplexPrinter: SystemPrinter = {
    name: 'Simple-Simplex-Printer',
    portName: 'USB002',
    state: 'ready',
    statusCode: 0,
    isDefault: false,
    color: { support: 'supported', source: 'driver' },
    duplex: { support: 'unsupported', source: 'driver' },
  };

  it('renders cross-file duplex option defaulting to "否" when duplex is selected', () => {
    const settings: PrintSettings = {
      ...createDefaultGlobalSettings(mockPrinter.name),
      sidesMode: 'duplex',
      crossFileDuplex: false,
    };

    const { container } = render(
      <GlobalSettingsPanel
        printers={[mockPrinter]}
        settings={settings}
        loadingPrinters={false}
        onChange={vi.fn()}
      />,
    );

    const label = container.querySelector('#cross-file-duplex-label');
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe('跨文件双面');

    const segmented = container.querySelector('[aria-labelledby="cross-file-duplex-label"]');
    expect(segmented).not.toBeNull();
    const activeItem = segmented?.querySelector('.ant-segmented-item-selected');
    expect(activeItem?.textContent).toBe('否');
  });

  it('triggers onChange with crossFileDuplex true when user clicks "是"', () => {
    const onChange = vi.fn();
    const settings: PrintSettings = {
      ...createDefaultGlobalSettings(mockPrinter.name),
      sidesMode: 'duplex',
      crossFileDuplex: false,
    };

    const { container } = render(
      <GlobalSettingsPanel
        printers={[mockPrinter]}
        settings={settings}
        loadingPrinters={false}
        onChange={onChange}
      />,
    );

    const segmented = container.querySelector('[aria-labelledby="cross-file-duplex-label"]');
    expect(segmented).not.toBeNull();
    const yesLabel = Array.from(segmented?.querySelectorAll('.ant-segmented-item-label') ?? []).find(
      (el) => el.textContent === '是',
    );
    expect(yesLabel).toBeDefined();
    fireEvent.click(yesLabel!);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        sidesMode: 'duplex',
        crossFileDuplex: true,
      }),
    );
  });

  it('hides cross-file duplex option when sidesMode is simplex', () => {
    const settings: PrintSettings = {
      ...createDefaultGlobalSettings(mockPrinter.name),
      sidesMode: 'simplex',
      crossFileDuplex: false,
    };

    const { container } = render(
      <GlobalSettingsPanel
        printers={[mockPrinter]}
        settings={settings}
        loadingPrinters={false}
        onChange={vi.fn()}
      />,
    );

    expect(container.querySelector('#cross-file-duplex-label')).toBeNull();
  });

  it('hides cross-file duplex option when printer does not support duplex', () => {
    const settings: PrintSettings = {
      ...createDefaultGlobalSettings(mockSimplexPrinter.name),
      sidesMode: 'duplex',
      crossFileDuplex: false,
    };

    const { container } = render(
      <GlobalSettingsPanel
        printers={[mockSimplexPrinter]}
        settings={settings}
        loadingPrinters={false}
        onChange={vi.fn()}
      />,
    );

    expect(container.querySelector('#cross-file-duplex-label')).toBeNull();
  });
});
