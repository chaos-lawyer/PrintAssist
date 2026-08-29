export interface PrintHistoryRecord {
  id: string;
  timestamp: number;
  printerName: string;
  totalFiles: number;
  succeededCount: number;
  failedCount: number;
  skippedCount: number;
  files: Array<{
    fileName: string;
    path: string;
    status: 'succeeded' | 'failed' | 'skipped';
    message?: string;
  }>;
}

const STORAGE_KEY = 'printassist_print_history';
const MAX_HISTORY_ITEMS = 200;

const memoryStorage: Record<string, string> = {};

function getStorage(): {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
} {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // ignore
  }

  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage;
    }
  } catch {
    // ignore
  }

  return {
    getItem: (k: string) => memoryStorage[k] ?? null,
    setItem: (k: string, v: string) => {
      memoryStorage[k] = v;
    },
    removeItem: (k: string) => {
      delete memoryStorage[k];
    },
  };
}

export function loadPrintHistory(): PrintHistoryRecord[] {
  try {
    const raw = getStorage().getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePrintHistoryRecord(record: Omit<PrintHistoryRecord, 'id' | 'timestamp'>): void {
  try {
    const history = loadPrintHistory();
    const newRecord: PrintHistoryRecord = {
      ...record,
      id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
    };
    const updated = [newRecord, ...history].slice(0, MAX_HISTORY_ITEMS);
    getStorage().setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn('Failed to save print history record', err);
  }
}

export function clearPrintHistory(): void {
  try {
    getStorage().removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
}
