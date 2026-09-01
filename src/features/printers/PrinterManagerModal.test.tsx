// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemPrinter } from '../../shared/contracts/printer';
import { PrinterManagerModal } from './PrinterManagerModal';
import type { PrinterPreferencesV1 } from './printerPreferences';

describe('PrinterManagerModal', () => {
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
    vi.restoreAllMocks();
  });

  const mockSystemPrinters: SystemPrinter[] = [
    {
      name: 'Printer A',
      portName: 'USB001',
      isDefault: false,
      state: 'ready',
      statusCode: 0,
      color: { support: 'supported', source: 'driver' },
      duplex: { support: 'supported', source: 'driver' },
    },
    {
      name: 'Printer B (Default)',
      portName: 'NET001',
      isDefault: true,
      state: 'ready',
      statusCode: 0,
      color: { support: 'supported', source: 'driver' },
      duplex: { support: 'supported', source: 'driver' },
    },
    {
      name: 'Printer C (Offline)',
      portName: 'WSD001',
      isDefault: false,
      state: 'offline',
      statusCode: 0,
      color: { support: 'unsupported', source: 'driver' },
      duplex: { support: 'unsupported', source: 'driver' },
    },
  ];

  const defaultPreferences: PrinterPreferencesV1 = {
    version: 1,
    orderedNames: ['Printer B (Default)', 'Printer A', 'Printer C (Offline)'],
    hiddenNames: [],
  };

  it('renders visible printers and tags correctly', () => {
    render(
      <PrinterManagerModal
        open={true}
        systemPrinters={mockSystemPrinters}
        preferences={defaultPreferences}
        currentPrinterName="Printer A"
        isPrinting={false}
        onSave={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText('显示的打印机（3）')).toBeDefined();
    expect(screen.getByText('Windows 默认')).toBeDefined();
    expect(screen.getByText('当前使用')).toBeDefined();
    expect(screen.getByText('Shift+1')).toBeDefined();
    expect(screen.getByText('Shift+2')).toBeDefined();
    expect(screen.getByText('Shift+3')).toBeDefined();
  });

  it('allows hiding a printer and moving it to hidden section', async () => {
    render(
      <PrinterManagerModal
        open={true}
        systemPrinters={mockSystemPrinters}
        preferences={defaultPreferences}
        currentPrinterName="Printer A"
        isPrinting={false}
        onSave={() => {}}
        onClose={() => {}}
      />,
    );

    const hideBtns = screen.getAllByRole('button', { name: /隐藏打印机/ });
    expect(hideBtns.length).toBe(3);

    // Hide Printer C (Offline)
    fireEvent.click(hideBtns[2]);

    expect(screen.getByText('显示的打印机（2）')).toBeDefined();
    expect(screen.getByText('已隐藏的打印机（1）')).toBeDefined();
  });

  it('prevents hiding the last visible printer', () => {
    const singlePrinterPrefs: PrinterPreferencesV1 = {
      version: 1,
      orderedNames: ['Printer A', 'Printer B (Default)', 'Printer C (Offline)'],
      hiddenNames: ['Printer B (Default)', 'Printer C (Offline)'],
    };

    render(
      <PrinterManagerModal
        open={true}
        systemPrinters={mockSystemPrinters}
        preferences={singlePrinterPrefs}
        currentPrinterName="Printer A"
        isPrinting={false}
        onSave={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText('显示的打印机（1）')).toBeDefined();
    const hideBtn = screen.getByRole('button', { name: '隐藏打印机 Printer A' });
    expect(hideBtn.hasAttribute('disabled')).toBe(true);
  });

  it('allows hiding offline printers in batch', () => {
    render(
      <PrinterManagerModal
        open={true}
        systemPrinters={mockSystemPrinters}
        preferences={defaultPreferences}
        currentPrinterName="Printer A"
        isPrinting={false}
        onSave={() => {}}
        onClose={() => {}}
      />,
    );

    const hideOfflineBtn = screen.getByRole('button', { name: /隐藏离线打印机/ });
    fireEvent.click(hideOfflineBtn);

    // Printer C is offline, so it should be hidden
    expect(screen.getByText('显示的打印机（2）')).toBeDefined();
    expect(screen.getByText('已隐藏的打印机（1）')).toBeDefined();
  });

  it('calls onSave with updated draft preferences upon clicking save', () => {
    const saveSpy = vi.fn();
    const closeSpy = vi.fn();

    render(
      <PrinterManagerModal
        open={true}
        systemPrinters={mockSystemPrinters}
        preferences={defaultPreferences}
        currentPrinterName="Printer A"
        isPrinting={false}
        onSave={saveSpy}
        onClose={closeSpy}
      />,
    );

    // Hide Printer C
    const hideBtns = screen.getAllByRole('button', { name: /隐藏打印机/ });
    fireEvent.click(hideBtns[2]);

    // Click Save
    const saveBtn = screen.getByRole('button', { name: /保\s*存/ });
    fireEvent.click(saveBtn);

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith({
      version: 1,
      orderedNames: ['Printer B (Default)', 'Printer A', 'Printer C (Offline)'],
      hiddenNames: ['Printer C (Offline)'],
    });
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('disables save button when isPrinting is true', () => {
    render(
      <PrinterManagerModal
        open={true}
        systemPrinters={mockSystemPrinters}
        preferences={defaultPreferences}
        currentPrinterName="Printer A"
        isPrinting={true}
        onSave={() => {}}
        onClose={() => {}}
      />,
    );

    const saveBtn = screen.getByRole('button', { name: /保\s*存/ });
    expect(saveBtn.hasAttribute('disabled')).toBe(true);
  });
});
