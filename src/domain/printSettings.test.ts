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

  describe('single-file override and inheritance', () => {
    it('inherits global settings when override has no custom values', () => {
      const global = createDefaultGlobalSettings('HP LaserJet');
      global.colorMode = 'color';
      global.copies = 3;
      global.sidesMode = 'duplex';
      global.flipMode = 'shortEdge';

      const merged = mergePrintSettings(global, {});
      expect(merged.colorMode).toBe('color');
      expect(merged.copies).toBe(3);
      expect(merged.sidesMode).toBe('duplex');
      expect(merged.flipMode).toBe('shortEdge');
    });

    it('directly modifies field without solidifying other fields', () => {
      const global = createDefaultGlobalSettings('HP LaserJet');
      global.colorMode = 'monochrome';
      global.copies = 1;

      // Override only copies
      const override = { copies: 5 };
      const merged1 = mergePrintSettings(global, override);
      expect(merged1.copies).toBe(5);
      expect(merged1.colorMode).toBe('monochrome');

      // Now global color changes, file should inherit new color while keeping copies
      global.colorMode = 'color';
      const merged2 = mergePrintSettings(global, override);
      expect(merged2.colorMode).toBe('color');
      expect(merged2.copies).toBe(5);
    });

    it('resets individual field by deleting key from override', () => {
      const global = createDefaultGlobalSettings('HP LaserJet');
      global.colorMode = 'color';

      const override: { colorMode?: 'monochrome' | 'color'; copies?: number } = {
        colorMode: 'monochrome',
        copies: 4,
      };

      // Reset color back to global
      delete override.colorMode;
      const merged = mergePrintSettings(global, override);
      expect(merged.colorMode).toBe('color');
      expect(merged.copies).toBe(4);
    });

    it('all fields reset restores entire file to follow global', () => {
      const global = createDefaultGlobalSettings('HP LaserJet');
      global.colorMode = 'color';
      global.copies = 2;
      global.sidesMode = 'duplex';

      let override = {
        colorMode: 'monochrome' as const,
        copies: 10,
        sidesMode: 'simplex' as const,
      };

      // Reset all
      override = {} as typeof override;
      const merged = mergePrintSettings(global, override);
      expect(merged.colorMode).toBe('color');
      expect(merged.copies).toBe(2);
      expect(merged.sidesMode).toBe('duplex');
    });

    it('handles collateMode override and inheritance for byPage, byDocument, and bySet', () => {
      const global = createDefaultGlobalSettings('HP LaserJet');
      expect(global.collateMode).toBe('byDocument');
      expect(global.collate).toBe(true);

      // Inherit byDocument
      const merged1 = mergePrintSettings(global, {});
      expect(merged1.collateMode).toBe('byDocument');
      expect(merged1.collate).toBe(true);

      // Override with byPage
      const mergedPage = mergePrintSettings(global, { collateMode: 'byPage' });
      expect(mergedPage.collateMode).toBe('byPage');
      expect(mergedPage.collate).toBe(false);

      // Override with bySet
      const mergedSet = mergePrintSettings(global, { collateMode: 'bySet' });
      expect(mergedSet.collateMode).toBe('bySet');
      expect(mergedSet.collate).toBe(true);

      // Reset collateMode
      const override: { collateMode?: 'byPage' | 'byDocument' | 'bySet' } = { collateMode: 'bySet' };
      delete override.collateMode;
      const mergedReset = mergePrintSettings(global, override);
      expect(mergedReset.collateMode).toBe('byDocument');
      expect(mergedReset.collate).toBe(true);
    });
  });
});
