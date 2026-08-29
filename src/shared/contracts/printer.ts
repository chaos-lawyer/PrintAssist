export type CapabilitySupport = 'supported' | 'unsupported' | 'unknown';

export type PrinterOperationalState = 'ready' | 'offline' | 'error' | 'unknown';

export interface PrinterCapability {
  support: CapabilitySupport;
  source: 'driver' | 'system' | 'unavailable';
  detail?: string;
}

export interface SystemPrinter {
  name: string;
  portName: string | null;
  isDefault: boolean;
  state: PrinterOperationalState;
  statusCode: number;
  color: PrinterCapability;
  duplex: PrinterCapability;
  error?: string;
}

export type PrinterPropertiesStatus = 'accepted' | 'cancelled';

export interface PaperSourceOption {
  code: number;
  name: string;
}

export interface PaperSourceCapability {
  status: 'available' | 'unsupported' | 'unavailable';
  sources: PaperSourceOption[];
  defaultSourceCode?: number;
  detail?: string;
}

export interface PrinterDriverSettings {
  printerName: string;
  paperCode?: number;
  paperName?: string;
  paperWidthTenthMm?: number;
  paperLengthTenthMm?: number;
  sourceCode?: number;
  sourceName?: string;
  colorMode?: string;
  sidesMode?: string;
  flipMode?: string;
  orientation?: string;
  printQuality?: number;
  collate?: boolean;
  driverExtraBytes: number;
}

export interface PrinterPropertiesResult {
  status: PrinterPropertiesStatus;
  profileId?: string;
  settings?: PrinterDriverSettings;
}

export type PrinterProfileCompatibility =
  | 'compatible'
  | 'printerUnavailable'
  | 'driverChanged'
  | 'corrupted'
  | 'unsupportedSchema';

export interface SavedPrinterProfileSummary {
  id: string;
  name: string;
  printerName: string;
  settings: PrinterDriverSettings;
  summary: string;
  isDefault: boolean;
  compatibility: PrinterProfileCompatibility;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  note?: string;
}

export interface SavePrinterProfileRequest {
  name: string;
  printerName: string;
  runtimeProfileId: string;
  overwritePersistentProfileId?: string;
  note?: string;
}

export interface LoadedPrinterProfileResult {
  persistentProfile: SavedPrinterProfileSummary;
  runtimeProfileId: string;
  settings: PrinterDriverSettings;
  compatibility: PrinterProfileCompatibility;
}
