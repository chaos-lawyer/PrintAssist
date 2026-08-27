import { describe, expect, it } from 'vitest';
import type { PrinterDriverSettings } from '../shared/contracts/printer';
import {
  applyDriverSettings,
  createDefaultGlobalSettings,
  formatDriverSettingsSummary,
  mergePrintSettings,
} from './printSettings';

describe('printSettings domain', () => {
  describe('formatDriverSettingsSummary', () => {
    it('formats complete driver settings into readable string', () => {
      const settings: PrinterDriverSettings = {
        printerName: 'Canon iR-ADV C5535',
        paperName: 'A4',
        sourceName: '自动选择纸盘',
        sidesMode: 'duplex',
        flipMode: 'longEdge',
        colorMode: 'color',
        driverExtraBytes: 1024,
      };
      const summary = formatDriverSettingsSummary(settings);
      expect(summary).toBe('A4 · 自动选择纸盘 · 双面（长边） · 彩色');
    });

    it('formats short edge duplex and monochrome', () => {
      const settings: PrinterDriverSettings = {
        printerName: 'HP LaserJet',
        paperName: 'A3',
        sourceName: '纸盒 2',
        sidesMode: 'duplex',
        flipMode: 'shortEdge',
        colorMode: 'monochrome',
        driverExtraBytes: 512,
      };
      const summary = formatDriverSettingsSummary(settings);
      expect(summary).toBe('A3 · 纸盒 2 · 双面（短边） · 黑白');
    });

    it('formats simplex mode without flip mode', () => {
      const settings: PrinterDriverSettings = {
        printerName: 'Epson L3150',
        paperName: 'A4',
        sidesMode: 'simplex',
        colorMode: 'color',
        driverExtraBytes: 256,
      };
      const summary = formatDriverSettingsSummary(settings);
      expect(summary).toBe('A4 · 单面 · 彩色');
    });

    it('falls back to code when names are missing', () => {
      const settings: PrinterDriverSettings = {
        printerName: 'Generic / Text Only',
        paperCode: 9,
        sourceCode: 15,
        driverExtraBytes: 0,
      };
      const summary = formatDriverSettingsSummary(settings);
      expect(summary).toBe('纸张代码 9 · 纸盘代码 15');
    });

    it('falls back to default description when empty', () => {
      const settings: PrinterDriverSettings = {
        printerName: 'Virtual',
        driverExtraBytes: 0,
      };
      const summary = formatDriverSettingsSummary(settings);
      expect(summary).toBe('驱动自定义设置');
    });
  });

  describe('applyDriverSettings', () => {
    it('applies driver properties to current settings and records profileId', () => {
      const current = createDefaultGlobalSettings('Canon iR-ADV C5535');
      const driverSettings: PrinterDriverSettings = {
        printerName: 'Canon iR-ADV C5535',
        paperName: 'A4',
        sourceName: '纸盘 1',
        sidesMode: 'duplex',
        flipMode: 'shortEdge',
        colorMode: 'color',
        driverExtraBytes: 1024,
      };

      const updated = applyDriverSettings(current, driverSettings, 'prof-12345');

      expect(updated.driverProfileId).toBe('prof-12345');
      expect(updated.colorMode).toBe('color');
      expect(updated.sidesMode).toBe('duplex');
      expect(updated.flipMode).toBe('shortEdge');
      expect(updated.driverSummary).toBe('A4 · 纸盘 1 · 双面（短边） · 彩色');
    });

    it('updates simplex mode correctly', () => {
      const current = createDefaultGlobalSettings('HP LaserJet');
      const driverSettings: PrinterDriverSettings = {
        printerName: 'HP LaserJet',
        sidesMode: 'simplex',
        colorMode: 'monochrome',
        driverExtraBytes: 128,
      };

      const updated = applyDriverSettings(current, driverSettings, 'prof-999');

      expect(updated.driverProfileId).toBe('prof-999');
      expect(updated.sidesMode).toBe('simplex');
      expect(updated.colorMode).toBe('monochrome');
    });
  });

  describe('mergePrintSettings', () => {
    it('preserves driverProfileId and driverSummary when overriding file properties', () => {
      const global = {
        ...createDefaultGlobalSettings('Canon iR-ADV C5535'),
        driverProfileId: 'prof-abc',
        driverSummary: 'A4 · 双面（长边） · 彩色',
      };

      const merged = mergePrintSettings(global, {
        colorMode: 'monochrome',
        copies: 3,
      });

      expect(merged.driverProfileId).toBe('prof-abc');
      expect(merged.driverSummary).toBe('A4 · 双面（长边） · 彩色');
      expect(merged.colorMode).toBe('monochrome');
      expect(merged.copies).toBe(3);
    });
  });
});
