import type {
  BatchPhase,
  PrintJobResultItem,
  PrintJobSummary,
  QueueItem,
  QueueState,
  SupportedDocumentKind,
  QueueOrder,
  QueueSortField,
} from '../../domain/queueTypes';
import { createEmptyQueueState } from '../../domain/queueTypes';
import type { FileSettingsOverride } from '../../domain/printSettings';

export type QueueAction =
  | { type: 'append_files'; paths: string[] }
  | { type: 'remove_item'; id: string }
  | { type: 'batch_remove'; ids: string[] }
  | { type: 'clear_queue' }
  | { type: 'start_new_batch' }
  | { type: 'prepare_reprint_all' }
  | { type: 'keep_failed_only' }
  | { type: 'restore_batch'; items: QueueItem[]; summary: PrintJobSummary | null; phase: BatchPhase }
  | { type: 'update_override'; id: string; override: FileSettingsOverride }
  | { type: 'batch_set_override'; ids: string[]; override: Partial<FileSettingsOverride> }
  | { type: 'toggle_sort'; field: QueueSortField }
  | { type: 'toggle_filename_sort' }
  | { type: 'set_file_metadata'; metadata: Record<string, { fileSize?: number; createdAt?: number; modifiedAt?: number }> }
  | { type: 'reorder_items'; movingIds: string[]; targetId: string; position: 'before' | 'after' }
  | { type: 'clone_items'; sourceIds: string[]; targetId: string; position: 'before' | 'after' }
  | { type: 'paste_snapshots'; snapshots: QueueItemSnapshot[]; targetId: string | null }
  | { type: 'insert_items'; items: QueueItem[]; targetId: string | null }
  | { type: 'set_item_status'; id: string; status: QueueItem['status']; errorMessage?: string }
  | { type: 'begin_print' }
  | { type: 'request_pause' }
  | { type: 'confirm_paused' }
  | { type: 'resume_print' }
  | { type: 'request_terminate' }
  | { type: 'finish_print'; summary: PrintJobSummary }
  | { type: 'retry_failed' }
  | { type: 'move_item'; id: string; direction: 'up' | 'down' };

export interface QueueItemSnapshot {
  path: string;
  fileName: string;
  kind: SupportedDocumentKind;
  pageCount: number | null;
  override: FileSettingsOverride;
  errorMessage?: string;
}

export { QueueOrder };

const SUPPORTED_EXTENSIONS: Record<string, SupportedDocumentKind> = {
  pdf: 'pdf',
  // 位图 / 常见照片
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  jpe: 'image',
  jfif: 'image',
  bmp: 'image',
  dib: 'image',
  tif: 'image',
  tiff: 'image',
  gif: 'image',
  webp: 'image',
  ico: 'image',
  // 现代/移动端格式（依赖系统编解码与关联程序）
  heic: 'image',
  heif: 'image',
  avif: 'image',
  // Windows 图元文件
  emf: 'image',
  wmf: 'image',
  txt: 'text',
  log: 'text',
  md: 'text',
  // Word / WPS 文字
  doc: 'word',
  docx: 'word',
  dot: 'word',
  dotx: 'word',
  dotm: 'word',
  docm: 'word',
  wps: 'word',
  wpt: 'word',
  // Excel / WPS 表格
  xls: 'excel',
  xlsx: 'excel',
  xlt: 'excel',
  xltx: 'excel',
  xltm: 'excel',
  xlsm: 'excel',
  et: 'excel',
  ett: 'excel',
  // PowerPoint / WPS 演示
  ppt: 'powerpoint',
  pptx: 'powerpoint',
  pot: 'powerpoint',
  potx: 'powerpoint',
  potm: 'powerpoint',
  pps: 'powerpoint',
  ppsx: 'powerpoint',
  ppsm: 'powerpoint',
  pptm: 'powerpoint',
  dps: 'powerpoint',
  dpt: 'powerpoint',
};

export function detectDocumentKind(filePath: string): SupportedDocumentKind {
  const extension = filePath.split('.').pop()?.toLowerCase() ?? '';
  return SUPPORTED_EXTENSIONS[extension] ?? 'unknown';
}

export function extractFileName(filePath: string): string {
  const normalizedPath = filePath.replace(/\//g, '\\');
  const segments = normalizedPath.split('\\');
  return segments[segments.length - 1] || filePath;
}

function createQueueItem(filePath: string): QueueItem {
  const kind = detectDocumentKind(filePath);
  return {
    id: `${filePath}::${Date.now()}::${Math.random().toString(36).slice(2, 8)}`,
    path: filePath,
    fileName: extractFileName(filePath),
    kind,
    pageCount: null,
    status: kind === 'unknown' ? 'failed' : 'ready',
    override: {},
    errorMessage: kind === 'unknown' ? '不支持的文件类型' : undefined,
    addedAt: Date.now(),
  };
}

export function createCloneItem(source: {
  path: string;
  fileName: string;
  kind: SupportedDocumentKind;
  pageCount: number | null;
  override?: FileSettingsOverride;
  errorMessage?: string;
}): QueueItem {
  return {
    id: `${source.path}::${Date.now()}::${Math.random().toString(36).slice(2, 8)}`,
    path: source.path,
    fileName: source.fileName,
    kind: source.kind,
    pageCount: source.pageCount,
    status: source.kind === 'unknown' ? 'failed' : 'ready',
    override: source.override ? { ...source.override } : {},
    errorMessage: source.kind === 'unknown' ? (source.errorMessage || '不支持的文件类型') : undefined,
    addedAt: Date.now(),
  };
}

function sortItems(items: QueueItem[], field: QueueSortField, direction: 'asc' | 'desc'): QueueItem[] {
  const sorted = [...items].sort((a, b) => {
    const cmp = field === 'fileName' || field === 'path'
      ? String(a[field]).localeCompare(String(b[field]), 'zh-Hans', { numeric: true, sensitivity: 'base' })
      : (a[field] ?? -1) - (b[field] ?? -1);
    return direction === 'desc' ? -cmp : cmp;
  });
  return sorted;
}

export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case 'append_files': {
      if (state.isPrinting || state.phase === 'completed') {
        return state;
      }
      const nextItems = [...state.items];
      for (const filePath of action.paths) {
        nextItems.push(createQueueItem(filePath));
      }

      const finalItems = state.order.mode !== 'manual'
        ? sortItems(nextItems, state.order.mode, state.order.direction)
        : nextItems;

      return {
        ...state,
        items: finalItems,
        lastSummary: null,
        phase: finalItems.length > 0 ? 'editing' : state.phase,
      };
    }

    case 'remove_item': {
      const nextItems = state.items.filter((item) => item.id !== action.id);
      return {
        ...state,
        items: nextItems,
        phase: nextItems.length === 0 ? 'empty' : state.phase,
      };
    }

    case 'batch_remove': {
      const idsToRemove = new Set(action.ids);
      const nextItems = state.items.filter((item) => !idsToRemove.has(item.id));
      return {
        ...state,
        items: nextItems,
        phase: nextItems.length === 0 ? 'empty' : state.phase,
      };
    }

    case 'clear_queue':
      return createEmptyQueueState();

    case 'start_new_batch':
      return createEmptyQueueState();

    case 'prepare_reprint_all':
      return {
        ...state,
        lastSummary: null,
        phase: 'editing',
        items: state.items.map((item) => ({
          ...item,
          status: item.kind === 'unknown' ? ('failed' as const) : ('ready' as const),
          errorMessage: item.kind === 'unknown' ? (item.errorMessage || '不支持的文件类型') : undefined,
        })),
      };

    case 'keep_failed_only': {
      const failedItems = state.items
        .filter((item) => item.status === 'failed' || item.status === 'skipped')
        .map((item) => ({
          ...item,
          status: item.kind === 'unknown' ? ('failed' as const) : ('ready' as const),
          errorMessage: item.kind === 'unknown' ? (item.errorMessage || '不支持的文件类型') : undefined,
        }));
      return {
        ...state,
        items: failedItems,
        lastSummary: null,
        phase: failedItems.length > 0 ? 'editing' : 'empty',
      };
    }

    case 'restore_batch':
      return {
        ...state,
        items: action.items,
        lastSummary: action.summary,
        phase: action.phase,
      };

    case 'update_override':
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.id
            ? {
                ...item,
                override: action.override,
              }
            : item,
        ),
      };

    case 'batch_set_override': {
      const targetIds = new Set(action.ids);
      return {
        ...state,
        items: state.items.map((item) => {
          if (!targetIds.has(item.id)) {
            return item;
          }
          return {
            ...item,
            override: {
              ...item.override,
              ...action.override,
            },
          };
        }),
      };
    }

    case 'toggle_sort':
    case 'toggle_filename_sort': {
      const field: QueueSortField = action.type === 'toggle_sort' ? action.field : 'fileName';
      const nextDirection: 'asc' | 'desc' =
        state.order.mode === field && state.order.direction === 'asc' ? 'desc' : 'asc';
      return {
        ...state,
        items: sortItems(state.items, field, nextDirection),
        order: { mode: field, direction: nextDirection },
      };
    }

    case 'set_file_metadata': {
      return {
        ...state,
        items: state.items.map((item) => {
          const metadata = action.metadata[item.path];
          return {
            ...item,
            ...(metadata ?? {}),
            metadataLoaded: true,
          };
        }),
      };
    }

    case 'reorder_items': {
      const { movingIds, targetId, position } = action;
      const movingSet = new Set(movingIds);
      // Extract moving items preserving their relative order
      const movingItems = state.items.filter((item) => movingSet.has(item.id));
      const remaining = state.items.filter((item) => !movingSet.has(item.id));
      if (movingItems.length === 0) return state;
      // Find target in remaining list
      const targetIndex = remaining.findIndex((item) => item.id === targetId);
      if (targetIndex < 0) return state;
      const insertAt = position === 'after' ? targetIndex + 1 : targetIndex;
      const nextItems = [
        ...remaining.slice(0, insertAt),
        ...movingItems,
        ...remaining.slice(insertAt),
      ];
      return {
        ...state,
        items: nextItems,
        order: { mode: 'manual' },
      };
    }

    case 'clone_items': {
      if (state.isPrinting || state.phase === 'completed' || action.sourceIds.length === 0) {
        return state;
      }
      const sourceSet = new Set(action.sourceIds);
      const sourceItems = state.items.filter((item) => sourceSet.has(item.id));
      if (sourceItems.length === 0) return state;

      const clones = sourceItems.map((item) => createCloneItem(item));
      const targetIndex = state.items.findIndex((item) => item.id === action.targetId);
      if (targetIndex < 0) {
        return {
          ...state,
          items: [...state.items, ...clones],
          order: { mode: 'manual' },
          lastSummary: null,
          phase: 'editing',
        };
      }

      const insertAt = action.position === 'after' ? targetIndex + 1 : targetIndex;
      const nextItems = [
        ...state.items.slice(0, insertAt),
        ...clones,
        ...state.items.slice(insertAt),
      ];

      return {
        ...state,
        items: nextItems,
        order: { mode: 'manual' },
        lastSummary: null,
        phase: 'editing',
      };
    }

    case 'paste_snapshots': {
      if (state.isPrinting || state.phase === 'completed' || action.snapshots.length === 0) {
        return state;
      }
      const clones = action.snapshots.map((snap) => createCloneItem(snap));
      let nextItems: QueueItem[];

      if (action.targetId) {
        const targetIndex = state.items.findIndex((item) => item.id === action.targetId);
        if (targetIndex >= 0) {
          const insertAt = targetIndex + 1;
          nextItems = [
            ...state.items.slice(0, insertAt),
            ...clones,
            ...state.items.slice(insertAt),
          ];
        } else {
          nextItems = [...state.items, ...clones];
        }
      } else {
        nextItems = [...state.items, ...clones];
      }

      return {
        ...state,
        items: nextItems,
        order: { mode: 'manual' },
        lastSummary: null,
        phase: 'editing',
      };
    }

    case 'insert_items': {
      if (state.isPrinting || state.phase === 'completed' || action.items.length === 0) {
        return state;
      }
      let nextItems: QueueItem[];
      if (action.targetId) {
        const targetIndex = state.items.findIndex((item) => item.id === action.targetId);
        if (targetIndex >= 0) {
          const insertAt = targetIndex + 1;
          nextItems = [
            ...state.items.slice(0, insertAt),
            ...action.items,
            ...state.items.slice(insertAt),
          ];
        } else {
          nextItems = [...state.items, ...action.items];
        }
      } else {
        nextItems = [...state.items, ...action.items];
      }
      return {
        ...state,
        items: nextItems,
        order: { mode: 'manual' },
        lastSummary: null,
        phase: 'editing',
      };
    }

    case 'set_item_status':
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.id
            ? {
                ...item,
                status: action.status,
                errorMessage: action.errorMessage,
              }
            : item,
        ),
      };

    case 'begin_print':
      return {
        ...state,
        isPrinting: true,
        phase: 'printing',
        lastSummary: null,
        items: state.items.map((item) =>
          item.status === 'failed' || item.status === 'succeeded' || item.status === 'skipped'
            ? item
            : { ...item, status: 'pending', errorMessage: undefined },
        ),
      };

    case 'request_pause':
      if (state.phase === 'printing') {
        return {
          ...state,
          phase: 'pausing',
        };
      }
      return state;

    case 'confirm_paused':
      if (state.phase === 'pausing') {
        return {
          ...state,
          phase: 'paused',
        };
      }
      return state;

    case 'resume_print':
      if (state.phase === 'paused' || state.phase === 'pausing') {
        return {
          ...state,
          phase: 'printing',
        };
      }
      return state;

    case 'request_terminate':
      if (state.isPrinting && state.phase !== 'completed') {
        return {
          ...state,
          phase: 'terminating',
        };
      }
      return state;

    case 'finish_print': {
      const resultById = new Map<string, PrintJobResultItem>();
      for (const resultItem of action.summary.results) {
        const existing = resultById.get(resultItem.queueItemId);
        if (!existing || resultItem.status === 'failed') {
          resultById.set(resultItem.queueItemId, resultItem);
        }
      }

      return {
        ...state,
        isPrinting: false,
        phase: 'completed',
        lastSummary: action.summary,
        items: state.items.map((item) => {
          const resultItem = resultById.get(item.id);
          if (!resultItem) {
            return item;
          }
          return {
            ...item,
            status: resultItem.status,
            errorMessage: resultItem.message,
          };
        }),
      };
    }

    case 'retry_failed':
      return {
        ...state,
        lastSummary: null,
        phase: 'editing',
        items: state.items.map((item) =>
          item.status === 'failed'
            ? {
                ...item,
                status: 'ready',
                errorMessage: undefined,
              }
            : item,
        ),
      };

    case 'move_item': {
      const currentIndex = state.items.findIndex((item) => item.id === action.id);
      if (currentIndex < 0) {
        return state;
      }

      const targetIndex =
        action.direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (targetIndex < 0 || targetIndex >= state.items.length) {
        return state;
      }

      const nextItems = [...state.items];
      const [movedItem] = nextItems.splice(currentIndex, 1);
      nextItems.splice(targetIndex, 0, movedItem);
      return {
        ...state,
        items: nextItems,
        order: { mode: 'manual' },
      };
    }

    default:
      return state;
  }
}

export function createPrintSummary(results: PrintJobResultItem[]): PrintJobSummary {
  return {
    succeeded: results.filter((resultItem) => resultItem.status === 'succeeded').length,
    failed: results.filter((resultItem) => resultItem.status === 'failed').length,
    skipped: results.filter((resultItem) => resultItem.status === 'skipped').length,
    results,
  };
}
