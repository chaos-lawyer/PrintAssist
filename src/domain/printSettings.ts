import type {
  LoadedPrinterProfileResult,
  PrinterDriverSettings,
  SystemPrinter,
} from '../shared/contracts/printer';
import type { PageRangeInput } from './pageRange';

export type ColorMode = 'color' | 'monochrome';
export type SidesMode = 'simplex' | 'duplex';
export type FlipMode = 'longEdge' | 'shortEdge';
export type PageScaleMode = 'actualSize' | 'shrinkOversized' | 'fitPrintable';
export type CollateMode = 'byPage' | 'byDocument' | 'bySet';

export type OriginalPaperSizePreset = 'a4' | 'a3' | 'custom';
export type OutputPaperSizePreset = 'sameAsOriginal' | 'a4' | 'a3' | 'custom';

export interface CustomPaperDimensions {
  widthMm: number;
  heightMm: number;
}

export interface OriginalSizeSetting {
  preset: OriginalPaperSizePreset;
  custom?: CustomPaperDimensions;
}

export interface PaperSizeSetting {
  preset: OutputPaperSizePreset;
  custom?: CustomPaperDimensions;
}

export const MIN_CUSTOM_PAPER_MM = 50;
export const MAX_CUSTOM_PAPER_MM = 1200;

export const STANDARD_PAPER_DIMENSIONS_MM: Record<'a4' | 'a3', CustomPaperDimensions> = {
  a4: { widthMm: 210, heightMm: 297 },
  a3: { widthMm: 297, heightMm: 420 },
};

export const DEFAULT_CUSTOM_PAPER_DIMENSIONS: CustomPaperDimensions = {
  widthMm: 210,
  heightMm: 297,
};

export function createDefaultOriginalSize(): OriginalSizeSetting {
  return { preset: 'a4' };
}

export function createDefaultPaperSize(): PaperSizeSetting {
  return { preset: 'sameAsOriginal' };
}

export function clampCustomPaperMm(val: number, fallback: number): number {
  if (typeof val !== 'number' || Number.isNaN(val) || !Number.isFinite(val)) {
    return fallback;
  }
  return Math.max(MIN_CUSTOM_PAPER_MM, Math.min(MAX_CUSTOM_PAPER_MM, Math.round(val)));
}

export function resolveOriginalSizeDimensionsMm(
  originalSize?: OriginalSizeSetting,
): CustomPaperDimensions {
  const preset = originalSize?.preset ?? 'a4';
  if (preset === 'a3') {
    return { ...STANDARD_PAPER_DIMENSIONS_MM.a3 };
  }
  if (preset === 'custom') {
    return {
      widthMm: clampCustomPaperMm(
        originalSize?.custom?.widthMm ?? DEFAULT_CUSTOM_PAPER_DIMENSIONS.widthMm,
        DEFAULT_CUSTOM_PAPER_DIMENSIONS.widthMm,
      ),
      heightMm: clampCustomPaperMm(
        originalSize?.custom?.heightMm ?? DEFAULT_CUSTOM_PAPER_DIMENSIONS.heightMm,
        DEFAULT_CUSTOM_PAPER_DIMENSIONS.heightMm,
      ),
    };
  }
  return { ...STANDARD_PAPER_DIMENSIONS_MM.a4 };
}

export interface EffectivePaperSize {
  preset: 'a4' | 'a3' | 'custom';
  widthMm: number;
  heightMm: number;
}

export function resolveEffectivePaperSize(
  originalSize?: OriginalSizeSetting,
  paperSize?: PaperSizeSetting,
): EffectivePaperSize {
  const outputPreset = paperSize?.preset ?? 'sameAsOriginal';
  if (outputPreset === 'sameAsOriginal') {
    const origPreset = originalSize?.preset ?? 'a4';
    const dims = resolveOriginalSizeDimensionsMm(originalSize);
    return {
      preset: origPreset,
      widthMm: dims.widthMm,
      heightMm: dims.heightMm,
    };
  }
  if (outputPreset === 'a3') {
    return {
      preset: 'a3',
      ...STANDARD_PAPER_DIMENSIONS_MM.a3,
    };
  }
  if (outputPreset === 'custom') {
    return {
      preset: 'custom',
      widthMm: clampCustomPaperMm(
        paperSize?.custom?.widthMm ?? DEFAULT_CUSTOM_PAPER_DIMENSIONS.widthMm,
        DEFAULT_CUSTOM_PAPER_DIMENSIONS.widthMm,
      ),
      heightMm: clampCustomPaperMm(
        paperSize?.custom?.heightMm ?? DEFAULT_CUSTOM_PAPER_DIMENSIONS.heightMm,
        DEFAULT_CUSTOM_PAPER_DIMENSIONS.heightMm,
      ),
    };
  }
  return {
    preset: 'a4',
    ...STANDARD_PAPER_DIMENSIONS_MM.a4,
  };
}

export function formatOriginalSizeLabel(originalSize?: OriginalSizeSetting): string {
  const preset = originalSize?.preset ?? 'a4';
  if (preset === 'a3') return 'A3';
  if (preset === 'custom') {
    const dims = resolveOriginalSizeDimensionsMm(originalSize);
    return `${dims.widthMm}×${dims.heightMm}mm`;
  }
  return 'A4';
}

export function formatPaperSizeLabel(
  paperSize?: PaperSizeSetting,
  originalSize?: OriginalSizeSetting,
): string {
  const preset = paperSize?.preset ?? 'sameAsOriginal';
  if (preset === 'sameAsOriginal') {
    return `与原稿相同 (${formatOriginalSizeLabel(originalSize)})`;
  }
  if (preset === 'a3') return 'A3';
  if (preset === 'custom') {
    const dims = resolveEffectivePaperSize(originalSize, paperSize);
    return `${dims.widthMm}×${dims.heightMm}mm`;
  }
  return 'A4';
}

export interface NupLayout {
  cols: number;
  rows: number;
}

export type NupScope = 'perFile' | 'crossFile';

export interface NupTemplate {
  id: string;
  label: string;
  layout: NupLayout;
  description: string;
}

export const NUP_TEMPLATES: NupTemplate[] = [
  {
    id: '2x1',
    label: '2 × 1',
    layout: { cols: 2, rows: 1 },
    description: '两页并排，适合文档对照和讲义',
  },
  {
    id: '1x2',
    label: '1 × 2',
    layout: { cols: 1, rows: 2 },
    description: '两页上下排列，兼容纵排布局',
  },
  {
    id: '2x2',
    label: '2 × 2',
    layout: { cols: 2, rows: 2 },
    description: '常用均衡四格布局',
  },
  {
    id: '3x2',
    label: '3 × 2',
    layout: { cols: 3, rows: 2 },
    description: '密集审阅（自动横向纸张）',
  },
  {
    id: '3x3',
    label: '3 × 3',
    layout: { cols: 3, rows: 3 },
    description: '缩略总览',
  },
];

export const NUP_PRESETS: Array<{ label: string; layout: NupLayout }> = [
  { label: '不拼接', layout: { cols: 1, rows: 1 } },
  ...NUP_TEMPLATES.map((t) => ({ label: t.label, layout: t.layout })),
];

export function isNupActive(layout?: NupLayout): boolean {
  return Boolean(layout && layout.cols * layout.rows > 1);
}

export function findMatchingNupTemplate(layout?: NupLayout): NupTemplate | undefined {
  if (!layout) return undefined;
  return NUP_TEMPLATES.find(
    (t) => t.layout.cols === layout.cols && t.layout.rows === layout.rows
  );
}

export function clampNupDimension(val: number): number {
  if (!val || Number.isNaN(val)) return 1;
  return Math.max(1, Math.min(4, Math.floor(val)));
}

export function getLinkedNupMin(otherVal: number): number {
  return otherVal <= 1 ? 2 : 1;
}

export interface NupLayoutSummary {
  slots: number;
  slotsText: string;
  orientationHint: string;
  customLabel: string;
  matchingTemplate?: NupTemplate;
}

export function getNupLayoutSummary(layout?: NupLayout): NupLayoutSummary {
  const cols = clampNupDimension(layout?.cols ?? 1);
  const rows = clampNupDimension(layout?.rows ?? 1);
  const slots = cols * rows;
  const matchingTemplate = findMatchingNupTemplate({ cols, rows });

  let orientationHint = '预计保持纸张方向';
  if (cols > rows) {
    orientationHint = '预计横向纸张';
  } else if (cols < rows) {
    orientationHint = '预计纵向纸张';
  }

  const customLabel = matchingTemplate?.label ?? `自定义 ${cols} × ${rows}`;

  return {
    slots,
    slotsText: `${cols} × ${rows}，每个打印面容纳 ${slots} 页`,
    orientationHint,
    customLabel,
    matchingTemplate,
  };
}

export interface PrintSettings {
  printerName: string;
  colorMode: ColorMode;
  sidesMode: SidesMode;
  flipMode: FlipMode;
  crossFileDuplex?: boolean;
  copies: number;
  collateMode: CollateMode;
  collate: boolean;
  sourceCode?: number;
  sourceName?: string;
  originalSize?: OriginalSizeSetting;
  paperSize?: PaperSizeSetting;
  scaleMode?: PageScaleMode;
  nupLayout: NupLayout;
  nupScope: NupScope;
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
  collateMode?: CollateMode;
  collate?: boolean;
  sourceCode?: number;
  sourceName?: string;
  originalSize?: OriginalSizeSetting;
  paperSize?: PaperSizeSetting;
  scaleMode?: PageScaleMode;
  pageRange?: PageRangeInput;
}

export function createDefaultGlobalSettings(printerName = ''): PrintSettings {
  return {
    printerName,
    colorMode: 'monochrome',
    sidesMode: 'duplex',
    flipMode: 'longEdge',
    crossFileDuplex: false,
    copies: 1,
    collateMode: 'byDocument',
    collate: true,
    originalSize: createDefaultOriginalSize(),
    paperSize: createDefaultPaperSize(),
    scaleMode: 'actualSize',
    nupLayout: { cols: 1, rows: 1 },
    nupScope: 'perFile',
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

  if (driverSettings.collate !== undefined) {
    next.collate = driverSettings.collate;
    next.collateMode = driverSettings.collate ? 'byDocument' : 'byPage';
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
  const collateMode: CollateMode =
    fileOverride.collateMode ??
    (fileOverride.collate !== undefined
      ? fileOverride.collate
        ? 'byDocument'
        : 'byPage'
      : globalSettings.collateMode ??
        (globalSettings.collate ? 'byDocument' : 'byPage'));

  const collate: boolean =
    fileOverride.collateMode !== undefined
      ? fileOverride.collateMode !== 'byPage'
      : fileOverride.collate !== undefined
        ? fileOverride.collate
        : globalSettings.collateMode !== undefined
          ? globalSettings.collateMode !== 'byPage'
          : globalSettings.collate;

  return {
    printerName: globalSettings.printerName,
    colorMode: fileOverride.colorMode ?? globalSettings.colorMode,
    sidesMode: fileOverride.sidesMode ?? globalSettings.sidesMode,
    flipMode: fileOverride.flipMode ?? globalSettings.flipMode,
    crossFileDuplex: globalSettings.crossFileDuplex ?? false,
    copies: fileOverride.copies ?? globalSettings.copies,
    collateMode,
    collate,
    sourceCode: fileOverride.sourceCode !== undefined ? fileOverride.sourceCode : globalSettings.sourceCode,
    sourceName: fileOverride.sourceName !== undefined ? fileOverride.sourceName : globalSettings.sourceName,
    originalSize:
      fileOverride.originalSize ??
      globalSettings.originalSize ??
      createDefaultOriginalSize(),
    paperSize:
      fileOverride.paperSize ??
      globalSettings.paperSize ??
      createDefaultPaperSize(),
    scaleMode: fileOverride.scaleMode ?? globalSettings.scaleMode,
    nupLayout: globalSettings.nupLayout,
    nupScope: globalSettings.nupScope,
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
