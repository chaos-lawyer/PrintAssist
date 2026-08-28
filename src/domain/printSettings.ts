import type {
  LoadedPrinterProfileResult,
  PrinterDriverSettings,
  SystemPrinter,
} from '../shared/contracts/printer';
import type { PageRangeInput } from './pageRange';

export type ColorMode = 'color' | 'monochrome';
export type SidesMode = 'simplex' | 'duplex';
export type FlipMode = 'longEdge' | 'shortEdge';

export interface PrintSettings {
  printerName: string;
  colorMode: ColorMode;
  sidesMode: SidesMode;
  flipMode: FlipMode;
  copies: number;
  sourceCode?: number;
  sourceName?: string;
  pageRange: PageRangeInput;
  driverProfileId?: string;
  driverSummary?: string;
  persistentProfileId?: string;
  persistentProfileName?: string;
  profileDirty?: boolean;
}

export interface FileSettingsOverride {
  colorMode?: ColorMode;
  sidesMode?: SidesMode;
  flipMode?: FlipMode;
  copies?: number;
  sourceCode?: number;
  sourceName?: string;
  pageRange?: PageRangeInput;
}

export function createDefaultGlobalSettings(printerName = ''): PrintSettings {
  return {
    printerName,
    colorMode: 'monochrome',
    sidesMode: 'duplex',
    flipMode: 'longEdge',
    copies: 1,
    pageRange: {
      mode: 'all',
      expression: '',
    },
  };
}

export function formatDriverSettingsSummary(settings: PrinterDriverSettings): string {
  const parts: string[] = [];

  if (settings.paperName) {
    parts.push(settings.paperName);
  } else if (settings.paperCode) {
    parts.push(`纸张代码 ${settings.paperCode}`);
  }

  if (settings.sourceName) {
    parts.push(settings.sourceName);
  } else if (settings.sourceCode) {
    parts.push(`纸盘代码 ${settings.sourceCode}`);
  }

  if (settings.sidesMode === 'duplex') {
    if (settings.flipMode === 'shortEdge') {
      parts.push('双面（短边）');
    } else {
      parts.push('双面（长边）');
    }
  } else if (settings.sidesMode === 'simplex') {
    parts.push('单面');
  }

  if (settings.colorMode === 'color') {
    parts.push('彩色');
  } else if (settings.colorMode === 'monochrome') {
    parts.push('黑白');
  }

  return parts.length > 0 ? parts.join(' · ') : '驱动自定义设置';
}

export function applyDriverSettings(
  currentSettings: PrintSettings,
  driverSettings: PrinterDriverSettings,
  profileId: string,
): PrintSettings {
  const next: PrintSettings = {
    ...currentSettings,
    driverProfileId: profileId,
    driverSummary: formatDriverSettingsSummary(driverSettings),
  };

  if (driverSettings.colorMode === 'color' || driverSettings.colorMode === 'monochrome') {
    next.colorMode = driverSettings.colorMode;
  }

  if (driverSettings.sidesMode === 'duplex') {
    next.sidesMode = 'duplex';
    if (driverSettings.flipMode === 'shortEdge' || driverSettings.flipMode === 'longEdge') {
      next.flipMode = driverSettings.flipMode;
    }
  } else if (driverSettings.sidesMode === 'simplex') {
    next.sidesMode = 'simplex';
  }

  return next;
}

export function applyLoadedPersistentProfile(
  currentSettings: PrintSettings,
  result: LoadedPrinterProfileResult,
): PrintSettings {
  const next = applyDriverSettings(currentSettings, result.settings, result.runtimeProfileId);
  return {
    ...next,
    persistentProfileId: result.persistentProfile.id,
    persistentProfileName: result.persistentProfile.name,
    profileDirty: false,
  };
}

export function isProfileDirty(
  current: PrintSettings,
  profileSettingsSnapshot?: PrinterDriverSettings,
): boolean {
  if (!current.persistentProfileId || !profileSettingsSnapshot) {
    return false;
  }
  if (profileSettingsSnapshot.colorMode && current.colorMode !== profileSettingsSnapshot.colorMode) {
    return true;
  }
  if (profileSettingsSnapshot.sidesMode && current.sidesMode !== profileSettingsSnapshot.sidesMode) {
    return true;
  }
  if (
    current.sidesMode === 'duplex' &&
    profileSettingsSnapshot.flipMode &&
    current.flipMode !== profileSettingsSnapshot.flipMode
  ) {
    return true;
  }
  return false;
}

export function mergePrintSettings(
  globalSettings: PrintSettings,
  fileOverride: FileSettingsOverride = {},
): PrintSettings {
  return {
    printerName: globalSettings.printerName,
    colorMode: fileOverride.colorMode ?? globalSettings.colorMode,
    sidesMode: fileOverride.sidesMode ?? globalSettings.sidesMode,
    flipMode: fileOverride.flipMode ?? globalSettings.flipMode,
    copies: fileOverride.copies ?? globalSettings.copies,
    sourceCode: fileOverride.sourceCode !== undefined ? fileOverride.sourceCode : globalSettings.sourceCode,
    sourceName: fileOverride.sourceName !== undefined ? fileOverride.sourceName : globalSettings.sourceName,
    pageRange: fileOverride.pageRange ?? globalSettings.pageRange,
    driverProfileId: globalSettings.driverProfileId,
    driverSummary: globalSettings.driverSummary,
    persistentProfileId: globalSettings.persistentProfileId,
    persistentProfileName: globalSettings.persistentProfileName,
    profileDirty: globalSettings.profileDirty,
  };
}

export function hasFileOverride(fileOverride: FileSettingsOverride): boolean {
  return Object.keys(fileOverride).length > 0;
}

export interface SettingAvailability {
  colorEnabled: boolean;
  duplexEnabled: boolean;
  flipEnabled: boolean;
  printEnabled: boolean;
  reasons: string[];
}

export function evaluateSettingAvailability(
  printer: SystemPrinter | undefined,
): SettingAvailability {
  if (!printer) {
    return {
      colorEnabled: false,
      duplexEnabled: false,
      flipEnabled: false,
      printEnabled: false,
      reasons: ['尚未选择打印机'],
    };
  }

  const reasons: string[] = [];
  const colorEnabled = printer.color.support === 'supported';
  const duplexEnabled = printer.duplex.support === 'supported';
  const flipEnabled = duplexEnabled;
  const printEnabled = printer.state !== 'offline' && printer.state !== 'error';

  if (printer.state === 'offline') {
    reasons.push('打印机离线');
  } else if (printer.state === 'error') {
    reasons.push('打印机处于错误状态');
  }

  if (printer.color.support === 'unsupported') {
    reasons.push('当前打印机不支持彩色');
  } else if (printer.color.support === 'unknown') {
    reasons.push(printer.color.detail ?? '彩色能力未知');
  }

  if (printer.duplex.support === 'unsupported') {
    reasons.push('当前打印机不支持双面');
  } else if (printer.duplex.support === 'unknown') {
    reasons.push(printer.duplex.detail ?? '双面能力未知');
  }

  if (printer.error) {
    reasons.push(printer.error);
  }

  return {
    colorEnabled,
    duplexEnabled,
    flipEnabled,
    printEnabled,
    reasons,
  };
}

export function sanitizeSettingsForPrinter(
  settings: PrintSettings,
  printer: SystemPrinter | undefined,
): PrintSettings {
  const availability = evaluateSettingAvailability(printer);
  const nextSettings = { ...settings };

  if (!availability.colorEnabled && nextSettings.colorMode === 'color') {
    nextSettings.colorMode = 'monochrome';
  }

  if (!availability.duplexEnabled && nextSettings.sidesMode === 'duplex') {
    nextSettings.sidesMode = 'simplex';
  }

  return nextSettings;
}
