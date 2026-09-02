import type { SupportedDocumentKind } from '../../domain/queueTypes';
import type { FileSettingsOverride, PrintSettings } from '../../domain/printSettings';

export interface FavoriteTaskSnapshotItem {
  path: string;
  fileName: string;
  kind: SupportedDocumentKind;
  pageCount: number | null;
  override: FileSettingsOverride;
}

export interface FavoriteTaskSnapshot {
  items: FavoriteTaskSnapshotItem[];
}

export interface FavoritePrinterRef {
  name: string;
}

export type FavoriteStandardSettings = Omit<
  PrintSettings,
  | 'printerName'
  | 'driverProfileId'
  | 'driverSummary'
  | 'persistentProfileId'
  | 'persistentProfileName'
  | 'profileDirty'
>;

export interface FavoritePrintConfig {
  persistentProfileId?: string;
  persistentProfileName?: string;
  standardSettings: FavoriteStandardSettings;
}

export interface FavoriteTemplateV1 {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  lastLoadedAt?: number;
  order: number;
  task: FavoriteTaskSnapshot | null;
  printer: FavoritePrinterRef | null;
  printConfig: FavoritePrintConfig | null;
  source?: 'manual' | 'history-migration';
}
