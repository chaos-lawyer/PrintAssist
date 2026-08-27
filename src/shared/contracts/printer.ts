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
  driverExtraBytes: number;
}

export interface PrinterPropertiesResult {
  status: PrinterPropertiesStatus;
  profileId?: string;
  settings?: PrinterDriverSettings;
}
