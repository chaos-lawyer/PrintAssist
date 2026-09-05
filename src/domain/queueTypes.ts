import type { FileSettingsOverride } from './printSettings';

export type QueueItemStatus =
  | 'pending'
  | 'analyzing'
  | 'ready'
  | 'printing'
  | 'succeeded'
  | 'failed'
  | 'skipped';

export type SupportedDocumentKind =
  | 'pdf'
  | 'image'
  | 'text'
  | 'word'
  | 'excel'
  | 'powerpoint'
  | 'unknown';

export type ReferencePageCountStatus =
  | 'pending'
  | 'loading'
  | 'available'
  | 'unavailable'
  | 'unsupported';

export type ReferencePageCountSource = 'docxMetadata' | 'pdfPageTree' | null;

export type ReferencePageCountReason =
  | 'missingAttribute'
  | 'fileTooLarge'
  | 'corruptZip'
  | 'corruptXml'
  | 'corruptPdf'
  | 'encryptedPdf'
  | 'invalidNumber'
  | 'zeroPages'
  | 'accessDenied'
  | 'fileNotFound'
  | 'ioError'
  | 'unsupportedFormat'
  | string;

export interface QueueItem {
  id: string;
  path: string;
  fileName: string;
  kind: SupportedDocumentKind;
  pageCount: number | null;
  pageCountStatus?: ReferencePageCountStatus;
  pageCountSource?: ReferencePageCountSource;
  pageCountReason?: ReferencePageCountReason;
  pageCountFileVersion?: string;
  status: QueueItemStatus;
  override: FileSettingsOverride;
  errorMessage?: string;
  addedAt: number;
  fileSize?: number;
  createdAt?: number;
  modifiedAt?: number;
  metadataLoaded?: boolean;
}

export interface PrintJobResultItem {
  queueItemId: string;
  path: string;
  fileName: string;
  status: 'succeeded' | 'failed' | 'skipped';
  message?: string;
}

export interface PrintJobSummary {
  succeeded: number;
  failed: number;
  skipped: number;
  results: PrintJobResultItem[];
}

export type QueueSortField =
  | 'fileName'
  | 'path'
  | 'createdAt'
  | 'modifiedAt'
  | 'fileSize'
  | 'pageCount';

export type QueueOrder =
  | { mode: 'manual' }
  | { mode: QueueSortField; direction: 'asc' | 'desc' };

export type BatchPhase =
  | 'empty'
  | 'editing'
  | 'printing'
  | 'pausing'
  | 'paused'
  | 'terminating'
  | 'completed';

export interface QueueState {
  items: QueueItem[];
  isPrinting: boolean;
  lastSummary: PrintJobSummary | null;
  order: QueueOrder;
  phase: BatchPhase;
}

export function createEmptyQueueState(): QueueState {
  return {
    items: [],
    isPrinting: false,
    lastSummary: null,
    order: { mode: 'manual' },
    phase: 'empty',
  };
}
