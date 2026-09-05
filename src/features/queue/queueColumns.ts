import type { QueueSortField } from '../../domain/queueTypes';

export type QueueColumnKey =
  | 'fileName'
  | 'path'
  | 'createdAt'
  | 'modifiedAt'
  | 'fileSize'
  | 'kind'
  | 'pageCount'
  | 'settings'
  | 'status'
  | 'actions';

export type QueueResizableColumnKey = QueueColumnKey;

export const DEFAULT_COLUMN_WIDTHS: Record<QueueColumnKey, number> = {
  fileName: 240,
  path: 240,
  createdAt: 155,
  modifiedAt: 155,
  fileSize: 100,
  kind: 80,
  pageCount: 90,
  settings: 220,
  status: 70,
  actions: 100,
};

export const COLUMN_WIDTHS_STORAGE_KEY = 'printassist_queue_column_widths';
export const COLUMN_VISIBILITY_STORAGE_KEY = 'printassist_queue_visible_columns';

export const DEFAULT_VISIBLE_COLUMNS: QueueColumnKey[] = [
  'fileName',
  'path',
  'createdAt',
  'modifiedAt',
  'fileSize',
  'kind',
  'pageCount',
  'settings',
  'status',
  'actions',
];

export const COLUMN_LABELS: Record<QueueColumnKey, string> = {
  fileName: '文件名',
  path: '文件路径',
  createdAt: '创建时间',
  modifiedAt: '修改时间',
  fileSize: '文件大小',
  kind: '类型',
  pageCount: '参考页数',
  settings: '设置',
  status: '状态',
  actions: '操作',
};

export interface SortableColumnDefinition {
  field: QueueSortField;
  label: string;
}

export const SORTABLE_COLUMNS_MAP: Record<string, SortableColumnDefinition> = {
  fileName: { field: 'fileName', label: '文件名' },
  path: { field: 'path', label: '文件路径' },
  createdAt: { field: 'createdAt', label: '创建时间' },
  modifiedAt: { field: 'modifiedAt', label: '修改时间' },
  fileSize: { field: 'fileSize', label: '文件大小' },
  pageCount: { field: 'pageCount', label: '参考页数' },
};

export interface VisibleSortableColumn {
  field: QueueSortField;
  key: QueueColumnKey;
  label: string;
  shortcutNumber: number;
}

export function getStoredVisibleColumns(): QueueColumnKey[] {
  try {
    const value = localStorage.getItem(COLUMN_VISIBILITY_STORAGE_KEY);
    if (value) {
      const saved = JSON.parse(value) as unknown;
      if (Array.isArray(saved)) {
        const hasExplicitActions =
          saved.includes('actions') ||
          Boolean(localStorage.getItem('printassist_queue_actions_explicit'));
        const hasExplicitFileName =
          saved.includes('fileName') ||
          Boolean(localStorage.getItem('printassist_queue_filename_explicit'));
        const hasExplicitPageCount =
          saved.includes('pageCount') ||
          Boolean(localStorage.getItem('printassist_queue_pagecount_explicit'));
        return DEFAULT_VISIBLE_COLUMNS.filter((key) => {
          if (key === 'actions' && !hasExplicitActions) return true;
          if (key === 'fileName' && !hasExplicitFileName) return true;
          if (key === 'pageCount' && !hasExplicitPageCount) return true;
          return saved.includes(key);
        });
      }
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_VISIBLE_COLUMNS;
}

export function getVisibleSortableColumns(
  visibleColumns: QueueColumnKey[],
): VisibleSortableColumn[] {
  const result: VisibleSortableColumn[] = [];
  let num = 1;
  for (const colKey of DEFAULT_VISIBLE_COLUMNS) {
    if (visibleColumns.includes(colKey) && colKey in SORTABLE_COLUMNS_MAP) {
      result.push({
        key: colKey,
        field: SORTABLE_COLUMNS_MAP[colKey].field,
        label: SORTABLE_COLUMNS_MAP[colKey].label,
        shortcutNumber: num++,
      });
    }
  }
  return result;
}
