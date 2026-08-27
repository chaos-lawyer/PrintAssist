import { describe, expect, it } from 'vitest';
import type { PrinterDriverSettings } from '../shared/contracts/printer';
import {
  applyDriverSettings,
  applyLoadedPersistentProfile,
  createDefaultGlobalSettings,
  formatDriverSettingsSummary,
  isProfileDirty,
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

  describe('applyLoadedPersistentProfile', () => {
    it('applies loaded persistent profile and resets dirty flag', () => {
      const current = createDefaultGlobalSettings('HP LaserJet');
      const loadedResult = {
        persistentProfile: {
          id: 'persisted-uuid-1',
          name: '高清双面彩色',
          printerName: 'HP LaserJet',
          settings: {
            printerName: 'HP LaserJet',
            paperName: 'A4',
            sidesMode: 'duplex',
            flipMode: 'longEdge',
            colorMode: 'color',
            driverExtraBytes: 512,
          },
          summary: 'A4 · 双面（长边） · 彩色',
          isDefault: true,
          compatibility: 'compatible' as const,
          createdAt: '123',
          updatedAt: '123',
        },
        runtimeProfileId: 'runtime-prof-99',
        settings: {
          printerName: 'HP LaserJet',
          paperName: 'A4',
          sidesMode: 'duplex',
          flipMode: 'longEdge',
          colorMode: 'color',
          driverExtraBytes: 512,
        },
        compatibility: 'compatible' as const,
      };

      const applied = applyLoadedPersistentProfile(current, loadedResult);
      expect(applied.persistentProfileId).toBe('persisted-uuid-1');
      expect(applied.persistentProfileName).toBe('高清双面彩色');
      expect(applied.driverProfileId).toBe('runtime-prof-99');
      expect(applied.colorMode).toBe('color');
      expect(applied.sidesMode).toBe('duplex');
      expect(applied.profileDirty).toBe(false);
    });
  });

  describe('isProfileDirty', () => {
    it('detects dirty state when standard settings deviate from loaded snapshot', () => {
      const snapshot: PrinterDriverSettings = {
        printerName: 'HP LaserJet',
        sidesMode: 'duplex',
        flipMode: 'longEdge',
        colorMode: 'monochrome',
        driverExtraBytes: 256,
      };

      const base = {
        ...createDefaultGlobalSettings('HP LaserJet'),
        persistentProfileId: 'persisted-1',
        sidesMode: 'duplex' as const,
        flipMode: 'longEdge' as const,
        colorMode: 'monochrome' as const,
      };

      // Unmodified -> not dirty
      expect(isProfileDirty(base, snapshot)).toBe(false);

      // Changed color mode -> dirty
      expect(isProfileDirty({ ...base, colorMode: 'color' }, snapshot)).toBe(true);

      // Changed sides mode -> dirty
      expect(isProfileDirty({ ...base, sidesMode: 'simplex' }, snapshot)).toBe(true);

      // Changed flip mode -> dirty
      expect(isProfileDirty({ ...base, flipMode: 'shortEdge' }, snapshot)).toBe(true);
    });
  });
});
