import type {
  ColorMode,
  FlipMode,
  NupLayout,
  NupScope,
  OriginalSizeSetting,
  PageScaleMode,
  PaperSizeSetting,
  SidesMode,
} from '../../domain/printSettings';

export type { NupLayout, NupScope, OriginalSizeSetting, PageScaleMode, PaperSizeSetting };

export interface ResolvedPrintSettingsPayload {
  printerName: string;
  colorMode: ColorMode;
  sidesMode: SidesMode;
  flipMode: FlipMode;
  copies: number;
  sourceCode?: number;
  sourceName?: string;
  originalSize?: OriginalSizeSetting;
  paperSize?: PaperSizeSetting;
  scaleMode?: PageScaleMode;
  nupLayout?: NupLayout;
  nupScope?: NupScope;
  pageRangeMode: 'all' | 'custom';
  pageRangeExpression: string;
  collate?: boolean;
  driverProfileId?: string;
  crossFileDuplex?: boolean;
}

export interface PrintQueueItemPayload {
  queueItemId: string;
  path: string;
  fileName: string;
  settings: ResolvedPrintSettingsPayload;
  allowAssociationFallback: boolean;
}

export interface PrintBatchRequest {
  items: PrintQueueItemPayload[];
  nupLayout?: NupLayout;
  nupScope?: NupScope;
  crossFileDuplex?: boolean;
}

export interface PrintBatchResultItem {
  queueItemId: string;
  path: string;
  fileName: string;
  status: 'succeeded' | 'failed' | 'skipped';
  message?: string;
  errorKind?: string;
}

export interface PrintBatchResult {
  succeeded: number;
  failed: number;
  skipped: number;
  results: PrintBatchResultItem[];
}
