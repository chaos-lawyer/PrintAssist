import type { FavoritePrintConfig, FavoriteTemplateV1 } from '../favorites/favoriteTypes';

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
  isFavorite?: boolean;
  printConfigSnapshot?: FavoritePrintConfig;
}

export const STORAGE_KEY = 'printassist_print_history';
export const MAX_HISTORY_ITEMS = 200;

const memoryStorage: Record<string, string> = {};

function getStorage(): {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
} {
  const isStorageLike = (value: unknown): value is {
    getItem: (k: string) => string | null;
    setItem: (k: string, v: string) => void;
    removeItem: (k: string) => void;
  } => {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Record<string, unknown>;
    return (
      typeof candidate.getItem === 'function' &&
      typeof candidate.setItem === 'function' &&
      typeof candidate.removeItem === 'function'
    );
  };

  try {
    if (typeof window !== 'undefined' && isStorageLike(window.localStorage)) {
      return window.localStorage;
    }
  } catch {
    // ignore
  }

  try {
    if (typeof localStorage !== 'undefined' && isStorageLike(localStorage)) {
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

export function _setRawStorageForTesting(value: string | null): void {
  const storage = getStorage();
  if (value === null) {
    storage.removeItem(STORAGE_KEY);
  } else {
    storage.setItem(STORAGE_KEY, value);
  }
}

export function loadPrintHistory(): PrintHistoryRecord[] {
  try {
    const raw = getStorage().getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item): PrintHistoryRecord => {
        const record = item as Partial<PrintHistoryRecord>;
        const files = Array.isArray(record.files)
          ? record.files.map((f) => ({
              fileName: typeof f?.fileName === 'string' && f.fileName.trim() ? f.fileName : '未命名文件',
              path: typeof f?.path === 'string' ? f.path : '',
              status: (f?.status === 'failed' || f?.status === 'skipped' ? f.status : 'succeeded') as
                | 'succeeded'
                | 'failed'
                | 'skipped',
              message: typeof f?.message === 'string' ? f.message : undefined,
            }))
          : [];

        return {
          id: typeof record.id === 'string' && record.id ? record.id : `hist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          timestamp: typeof record.timestamp === 'number' && !Number.isNaN(record.timestamp) ? record.timestamp : Date.now(),
          printerName: typeof record.printerName === 'string' && record.printerName ? record.printerName : '默认打印机',
          totalFiles: typeof record.totalFiles === 'number' ? record.totalFiles : files.length,
          succeededCount: typeof record.succeededCount === 'number' ? record.succeededCount : 0,
          failedCount: typeof record.failedCount === 'number' ? record.failedCount : 0,
          skippedCount: typeof record.skippedCount === 'number' ? record.skippedCount : 0,
          isFavorite: Boolean(record.isFavorite),
          files,
        };
      });
  } catch {
    return [];
  }
}

export function setPrintHistoryFavorite(id: string, isFavorite: boolean): boolean {
  try {
    const history = loadPrintHistory();
    const targetIndex = history.findIndex((record) => record.id === id);
    if (targetIndex === -1) {
      return false;
    }
    history[targetIndex] = {
      ...history[targetIndex],
      isFavorite,
    };
    getStorage().setItem(STORAGE_KEY, JSON.stringify(history));
    return true;
  } catch (err) {
    console.warn('Failed to update favorite status', err);
    return false;
  }
}

const MAX_FILES_PER_RECORD = 200;

export function savePrintHistoryRecord(record: Omit<PrintHistoryRecord, 'id' | 'timestamp'>): void {
  try {
    const history = loadPrintHistory();
    const sanitizedFiles = (record.files || []).slice(0, MAX_FILES_PER_RECORD).map((f) => ({
      fileName: (f.fileName || '未命名文件').slice(0, 150),
      path: (f.path || '').slice(0, 300),
      status: f.status,
      message: f.message ? f.message.slice(0, 300) : undefined,
    }));

    const newRecord: PrintHistoryRecord = {
      ...record,
      files: sanitizedFiles,
      id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      isFavorite: Boolean(record.isFavorite),
    };

    let updated = [newRecord, ...history];

    // Trimming policy: if exceeding MAX_HISTORY_ITEMS, prioritize removing oldest un-favorited records from existing history
    if (updated.length > MAX_HISTORY_ITEMS) {
      while (updated.length > MAX_HISTORY_ITEMS) {
        let removeIndex = -1;
        // Search among existing historical records (index >= 1) from oldest (end) to newest
        for (let i = updated.length - 1; i >= 1; i--) {
          if (!updated[i].isFavorite) {
            removeIndex = i;
            break;
          }
        }
        // If all existing records are favorited, remove the oldest historical record at the end
        if (removeIndex === -1) {
          removeIndex = updated.length - 1;
        }
        updated.splice(removeIndex, 1);
      }
    }

    const storage = getStorage();

    while (updated.length > 0) {
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(updated));
        break;
      } catch {
        if (updated.length === 1) break;
        updated = updated.slice(0, Math.max(1, Math.floor(updated.length / 2)));
      }
    }
  } catch (err) {
    console.warn('Failed to save print history record', err);
  }
}

export function deletePrintHistoryRecord(id: string): boolean {
  try {
    const history = loadPrintHistory();
    const updated = history.filter((r) => r.id !== id);
    if (updated.length === history.length) {
      return false;
    }
    getStorage().setItem(STORAGE_KEY, JSON.stringify(updated));
    return true;
  } catch (err) {
    console.warn('Failed to delete print history record', err);
    return false;
  }
}

export function clearPrintHistory(): void {
  try {
    getStorage().removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export function historyRecordToFavoriteTemplate(record: PrintHistoryRecord): FavoriteTemplateV1 {
  const dateStr = new Date(record.timestamp).toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  });
  const firstFile = record.files[0]?.fileName || '历史任务';
  const name = `${firstFile}（${dateStr}）`;

  return {
    schemaVersion: 1,
    id: `fav_hist_${record.id}`,
    name,
    createdAt: record.timestamp,
    updatedAt: record.timestamp,
    order: 0,
    task: {
      items: record.files.map((f) => ({
        path: f.path,
        fileName: f.fileName,
        kind: 'pdf',
        pageCount: null,
        override: {},
      })),
    },
    printer: record.printerName ? { name: record.printerName } : null,
    printConfig: record.printConfigSnapshot || null,
    source: 'history-migration',
  };
}

export function migrateOldHistoryFavorites(history: PrintHistoryRecord[]): FavoriteTemplateV1[] {
  const favoriteRecords = history.filter((h) => h.isFavorite);
  return favoriteRecords.map(historyRecordToFavoriteTemplate);
}
