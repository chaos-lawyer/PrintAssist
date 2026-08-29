import type { ColorMode, FlipMode, PageScaleMode, SidesMode } from '../../domain/printSettings';

export type { PageScaleMode };

export interface ResolvedPrintSettingsPayload {
  printerName: string;
  colorMode: ColorMode;
  sidesMode: SidesMode;
  flipMode: FlipMode;
  copies: number;
  sourceCode?: number;
  sourceName?: string;
  scaleMode?: PageScaleMode;
  pageRangeMode: 'all' | 'custom';
  pageRangeExpression: string;
  collate?: boolean;
  driverProfileId?: string;
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
}

export interface PrintBatchResultItem {
  queueItemId: string;
  path: string;
  fileName: string;
  status: 'succeeded' | 'failed' | 'skipped';
  message?: string;
}

export interface PrintBatchResult {
  succeeded: number;
  failed: number;
  skipped: number;
  results: PrintBatchResultItem[];
}
