// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { SystemPrinter } from '../../shared/contracts/printer';
import {
  PRINTER_PREFERENCES_STORAGE_KEY,
  applyPrinterPreferences,
  createDefaultPrinterPreferences,
  loadPrinterPreferences,
  savePrinterPreferences,
} from './printerPreferences';

const mockPrinters: SystemPrinter[] = [
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

describe('printerPreferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loads default preferences when localStorage is empty', () => {
    const prefs = loadPrinterPreferences();
    expect(prefs).toEqual(createDefaultPrinterPreferences());
  });

  it('saves and loads preferences correctly', () => {
    const prefs = {
      version: 1 as const,
      orderedNames: ['Printer C (Offline)', 'Printer A'],
      hiddenNames: ['Printer A'],
    };
    savePrinterPreferences(prefs);
    expect(loadPrinterPreferences()).toEqual(prefs);
  });

  it('gracefully handles corrupted JSON in localStorage', () => {
    localStorage.setItem(PRINTER_PREFERENCES_STORAGE_KEY, 'invalid json {[');
    expect(loadPrinterPreferences()).toEqual(createDefaultPrinterPreferences());
  });

  it('puts Windows default printer first when no custom order is defined', () => {
    const decorated = applyPrinterPreferences(mockPrinters, createDefaultPrinterPreferences());
    expect(decorated.map((p) => p.name)).toEqual([
      'Printer B (Default)',
      'Printer A',
      'Printer C (Offline)',
    ]);
    expect(decorated.every((p) => !p.hidden)).toBe(true);
  });

  it('applies custom order and appends new system printers at the end', () => {
    const prefs = {
      version: 1 as const,
      orderedNames: ['Printer C (Offline)', 'Printer A'],
      hiddenNames: [],
    };
    const decorated = applyPrinterPreferences(mockPrinters, prefs);
    expect(decorated.map((p) => p.name)).toEqual([
      'Printer C (Offline)',
      'Printer A',
      'Printer B (Default)',
    ]);
  });

  it('marks hidden printers correctly according to hiddenNames', () => {
    const prefs = {
      version: 1 as const,
      orderedNames: ['Printer A', 'Printer B (Default)', 'Printer C (Offline)'],
      hiddenNames: ['Printer C (Offline)'],
    };
    const decorated = applyPrinterPreferences(mockPrinters, prefs);
    expect(decorated.find((p) => p.name === 'Printer C (Offline)')?.hidden).toBe(true);
    expect(decorated.find((p) => p.name === 'Printer A')?.hidden).toBe(false);
  });

  it('guarantees at least one visible printer if all are hidden', () => {
    const prefs = {
      version: 1 as const,
      orderedNames: ['Printer A', 'Printer B (Default)', 'Printer C (Offline)'],
      hiddenNames: ['Printer A', 'Printer B (Default)', 'Printer C (Offline)'],
    };
    const decorated = applyPrinterPreferences(mockPrinters, prefs);
    const visibleCount = decorated.filter((p) => !p.hidden).length;
    expect(visibleCount).toBeGreaterThanOrEqual(1);
    expect(decorated[0].hidden).toBe(false);
  });

  it('preserves names of temporarily missing/offline printers in preferences', () => {
    const prefs = {
      version: 1 as const,
      orderedNames: ['Printer X (Disconnected)', 'Printer A', 'Printer B (Default)'],
      hiddenNames: ['Printer X (Disconnected)'],
    };
    savePrinterPreferences(prefs);
    // Only mockPrinters are currently online, Printer X is not in systemPrinters
    const decorated = applyPrinterPreferences(mockPrinters, prefs);
    expect(decorated.map((p) => p.name)).toEqual([
      'Printer A',
      'Printer B (Default)',
      'Printer C (Offline)',
    ]);
    // Preferences still retain Printer X in storage
    expect(loadPrinterPreferences().orderedNames).toContain('Printer X (Disconnected)');
  });
});
