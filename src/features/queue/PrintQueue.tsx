import {
  Button,
  Checkbox,
  message,
  Space,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  CircleDot,
  Copy,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  GripVertical,
  Image,
  Loader2,
  MinusCircle,
  Presentation,
  RotateCcw,
  Settings2,
  Trash2,
} from 'lucide-react';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { openFile, showInFolder } from '../../api/nativeBridge';
import type { BatchPhase, QueueItem, QueueOrder, QueueSortField } from '../../domain/queueTypes';
import { describePageRange } from '../../domain/pageRange';
import {
  hasFileOverride,
  mergePrintSettings,
  type PrintSettings,
} from '../../domain/printSettings';
import { normalizeLocalPath } from './duplicateDetection';
import type { QueueItemSnapshot } from './queueReducer';
import { AppContextMenu, type AppContextMenuItem } from '../../components/AppContextMenu';
import { OverflowTooltipText } from '../../components/OverflowTooltipText';

let queueClipboard: QueueItemSnapshot[] = [];

interface PrintQueueProps {
  items: QueueItem[];
  globalSettings: PrintSettings;
  isPrinting: boolean;
  phase?: BatchPhase;
  selectedRowKeys: React.Key[];
  sortOrder?: QueueOrder;
  onSelectionChange: (keys: React.Key[]) => void;
  onToggleSort?: (field: QueueSortField) => void;
  onReorderItems?: (
    movingIds: string[],
    targetId: string,
    position: 'before' | 'after',
  ) => void;
  onCloneItems?: (
    movingIds: string[],
    targetId: string,
    position: 'before' | 'after',
  ) => void;
  onPasteSnapshots?: (
    snapshots: QueueItemSnapshot[],
    targetId: string | null,
  ) => string[] | void;
  onRemove: (id: string) => void;
  onOpenSettings: (id: string) => void;
  onBatchSettings?: () => void;
  onBatchRemove?: () => void;
  onAddFiles?: () => void;
  activeId?: string | null;
  onActiveIdChange?: (id: string | null) => void;
}

export function formatPrintErrorMessage(errorMessage?: string): string {
  if (!errorMessage) return '打印失败';
  const lower = errorMessage.toLowerCase();

  // 1. 未安装 Office / COM 损坏
  if (
    errorMessage.includes('请确认已安装桌面版 Office') ||
    errorMessage.includes('Word.Application') ||
    errorMessage.includes('Excel.Application') ||
    errorMessage.includes('PowerPoint.Application') ||
    errorMessage.includes('CLSIDFromProgID') ||
    errorMessage.includes('0x800401F3')
  ) {
    return '未检测到本机安装的桌面版 Office (Word/Excel/PPT)，请安装 Office 或另存为 PDF 后打印';
  }

  // 2. 文件被其他程序独占打开或受密码保护
  if (
    lower.includes('0x800a14bb') ||
    lower.includes('locked') ||
    errorMessage.includes('正在被另一进程使用') ||
    errorMessage.includes('被占用') ||
    errorMessage.includes('密码')
  ) {
    return '文件被其他程序占用或受密码保护，请关闭正在编辑该文件的软件后重试';
  }

  // 3. Office 导出 PDF 异常
  if (
    errorMessage.includes('未生成 PDF 文件') ||
    errorMessage.includes('ExportAsFixedFormat')
  ) {
    return 'Office 导出 PDF 异常，建议在 Office 中手动另存为 PDF 后打印';
  }

  // 4. Excel/PowerPoint 自定义页码
  if (errorMessage.includes('Excel/PowerPoint 自定义页码')) {
    return 'Excel/PPT 暂不支持自定义抽取单页，请转为 PDF 后指定页码打印';
  }

  return `打印失败：${errorMessage}`;
}

function renderStatusIcon(status: QueueItem['status'], errorMessage?: string) {
  switch (status) {
    case 'ready':
    case 'pending':
      return (
        <Tooltip title="待打印">
          <span className="queue-status-icon status-ready" aria-label="待打印">
            <CircleDot size={16} />
          </span>
        </Tooltip>
      );
    case 'printing':
      return (
        <Tooltip title="打印中…">
          <span className="queue-status-icon status-printing" aria-label="打印中">
            <Loader2 size={16} className="spin-icon" />
          </span>
        </Tooltip>
      );
    case 'succeeded':
      return (
        <Tooltip title="已打印">
          <span className="queue-status-icon status-succeeded" aria-label="已打印">
            <CheckCircle2 size={16} />
          </span>
        </Tooltip>
      );
    case 'failed':
      return (
        <Tooltip title={formatPrintErrorMessage(errorMessage)}>
          <span className="queue-status-icon status-failed" aria-label="打印失败">
            <AlertCircle size={16} />
          </span>
        </Tooltip>
      );
    case 'skipped':
      return (
        <Tooltip title="已跳过">
          <span className="queue-status-icon status-skipped" aria-label="已跳过">
            <MinusCircle size={16} />
          </span>
        </Tooltip>
      );
    case 'analyzing':
      return (
        <Tooltip title="分析中…">
          <span className="queue-status-icon status-analyzing" aria-label="分析中">
            <Loader2 size={16} className="spin-icon" />
          </span>
        </Tooltip>
      );
    default:
      return <span>{status}</span>;
  }
}

function renderFileIcon(kind: QueueItem['kind']) {
  switch (kind) {
    case 'pdf':
      return <FileText size={16} className="file-kind-icon file-kind-pdf" />;
    case 'image':
      return <Image size={16} className="file-kind-icon file-kind-image" />;
    case 'word':
      return <FileText size={16} className="file-kind-icon file-kind-word" />;
    case 'excel':
      return <FileSpreadsheet size={16} className="file-kind-icon file-kind-excel" />;
    case 'powerpoint':
      return <Presentation size={16} className="file-kind-icon file-kind-ppt" />;
    case 'text':
      return <FileText size={16} className="file-kind-icon file-kind-text" />;
    default:
      return <FileText size={16} className="file-kind-icon" />;
  }
}

function kindLabel(kind: QueueItem['kind']) {
  switch (kind) {
    case 'pdf':
      return 'PDF';
    case 'image':
      return '图片';
    case 'word':
      return 'Word';
    case 'excel':
      return 'Excel';
    case 'powerpoint':
      return 'PPT';
    case 'text':
      return '文本';
    default:
      return '未知';
  }
}

export function getDirectoryOnly(filePath: string): string {
  if (!filePath) return '—';
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (lastSlash === -1) return '—';
  if (lastSlash === 0) return '/';
  if (lastSlash === 2 && filePath[1] === ':') return filePath.slice(0, 3);
  return filePath.slice(0, lastSlash);
}

function getParentDirectoryName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length >= 2) {
    return parts[parts.length - 2];
  }
  return '';
}

export type QueueColumnKey =
  | 'path'
  | 'createdAt'
  | 'modifiedAt'
  | 'fileSize'
  | 'kind'
  | 'settings'
  | 'status'
  | 'actions';
export type QueueResizableColumnKey = QueueColumnKey | 'fileName';

export const DEFAULT_COLUMN_WIDTHS: Record<QueueResizableColumnKey, number> = {
  fileName: 240,
  path: 240,
  createdAt: 155,
  modifiedAt: 155,
  fileSize: 100,
  kind: 80,
  settings: 220,
  status: 70,
  actions: 100,
};

export const COLUMN_WIDTHS_STORAGE_KEY = 'printassist_queue_column_widths';
const COLUMN_VISIBILITY_STORAGE_KEY = 'printassist_queue_visible_columns';
const DEFAULT_VISIBLE_COLUMNS: QueueColumnKey[] = [
  'path',
  'createdAt',
  'modifiedAt',
  'fileSize',
  'kind',
  'settings',
  'status',
  'actions',
];
const COLUMN_LABELS: Record<QueueColumnKey, string> = {
  path: '文件路径',
  createdAt: '创建时间',
  modifiedAt: '修改时间',
  fileSize: '文件大小',
  kind: '类型',
  settings: '设置',
  status: '状态',
  actions: '操作',
};

function formatDateTime(timestamp?: number): string {
  return timestamp ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium' }).format(timestamp) : '—';
}

function formatFileSize(bytes?: number): string {
  if (bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

// ── Drag & Drop Context for Ant Design Table Rows ─────────────────────────────
interface RowContextProps {
  setActivatorNodeRef: (element: HTMLElement | null) => void;
  listeners?: Record<string, any>;
  attributes?: Record<string, any>;
  isDragging?: boolean;
  isCopyDragging?: boolean;
}

const RowContext = createContext<RowContextProps>({
  setActivatorNodeRef: () => {},
});

interface DraggableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  'data-row-key': string;
}

function DraggableRow({ className, style, ...restProps }: DraggableRowProps) {
  const rowKey = restProps['data-row-key'];
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: rowKey ?? '',
  });

  const { isCopyDragging } = useContext(RowContext);

  const rowStyle: React.CSSProperties = {
    ...style,
    transform: CSS.Translate.toString(transform),
    transition,
    ...(isDragging
      ? {
          position: 'relative',
          zIndex: 999,
          opacity: 0.6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          cursor: isCopyDragging ? 'copy' : 'grabbing',
        }
      : {}),
  };

  return (
    <RowContext.Provider
      value={{ setActivatorNodeRef, listeners, attributes, isDragging, isCopyDragging }}
    >
      <tr
        {...restProps}
        ref={setNodeRef}
        className={`${className ?? ''}${isDragging ? ' is-dragging' : ''}${
          isDragging && isCopyDragging ? ' is-copy-dragging' : ''
        }`}
        style={rowStyle}
      />
    </RowContext.Provider>
  );
}

// ── FileNameCell with integrated drag handle ──────────────────────────────────
function FileNameCell({
  record,
  isDuplicate,
  parentDir,
  duplicateStat,
  isPrinting,
  onKeyboardMove,
  onSelectDuplicates,
  onOpenFile,
}: {
  record: QueueItem;
  isDuplicate: boolean;
  parentDir: string;
  duplicateStat?: { index: number; total: number };
  isPrinting: boolean;
  onKeyboardMove: (id: string, e: React.KeyboardEvent) => void;
  onSelectDuplicates?: (id: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const { setActivatorNodeRef, attributes, listeners, isDragging, isCopyDragging } =
    useContext(RowContext);

  return (
    <div className="queue-file-cell">
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="queue-drag-handle"
        title="拖动调整打印顺序（按住 Ctrl 拖动为复制；Alt+上下键键盘排序）"
        aria-label={`拖动调整 ${record.fileName} 的顺序`}
        disabled={isPrinting}
        tabIndex={0}
        {...attributes}
        {...listeners}
        onKeyDown={(e) => onKeyboardMove(record.id, e)}
      >
        <GripVertical size={14} />
      </button>
      {renderFileIcon(record.kind)}
      <div className="queue-file-info">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <OverflowTooltipText
            text={record.fileName}
            className="queue-file-name queue-double-click-file"
            tooltipTitle={
              <div style={{ wordBreak: 'break-all' }}>
                <div style={{ fontWeight: 600 }}>{record.fileName}</div>
                {record.path && record.path !== record.fileName && (
                  <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>{record.path}</div>
                )}
              </div>
            }
            placement="topLeft"
            onDoubleClick={(event) => {
              event.stopPropagation();
              onOpenFile(record.path);
            }}
          />
          {isDragging && isCopyDragging && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                background: '#2563eb',
                color: '#fff',
                fontSize: 10,
                fontWeight: 600,
                padding: '1px 5px',
                borderRadius: 3,
              }}
            >
              <Copy size={11} /> 复制
            </span>
          )}
        </div>
        {duplicateStat ? (
          <Tooltip title={`快捷键 Ctrl+Shift+A 可快速选中本文件的全部 ${duplicateStat.total} 个副本（点击亦可选中）`}>
            <div
              className="queue-file-duplicate-badge"
              onClick={(e) => {
                e.stopPropagation();
                onSelectDuplicates?.(record.id);
              }}
            >
              <Tag
                color="orange"
                bordered={false}
                style={{
                  margin: '2px 0 0',
                  fontSize: 11,
                  lineHeight: '16px',
                  padding: '0 4px',
                  cursor: 'pointer',
                }}
              >
                重复 {duplicateStat.index}/{duplicateStat.total}
              </Tag>
            </div>
          </Tooltip>
        ) : (
          isDuplicate &&
          parentDir && (
            <div className="queue-file-disambiguation" title={record.path}>
              来自：{parentDir}
            </div>
          )
        )}
      </div>
    </div>
  );
}

export function PrintQueue({
  items,
  globalSettings,
  isPrinting,
  phase,
  selectedRowKeys,
  sortOrder,
  onSelectionChange,
  onToggleSort,
  onReorderItems,
  onCloneItems,
  onPasteSnapshots,
  onRemove,
  onOpenSettings,
  onBatchSettings,
  onBatchRemove,
  onAddFiles,
  activeId: propsActiveId,
  onActiveIdChange,
}: PrintQueueProps) {
  const isCompleted = phase === 'completed';
  const isLocked = isPrinting || isCompleted;
  const lockReason = isPrinting
    ? '打印进行中，暂不可修改队列'
    : isCompleted
      ? '当前批次已完成，请先开始新批次'
      : undefined;
  const [internalActiveId, setInternalActiveId] = useState<string | null>(null);
  const activeId = propsActiveId !== undefined ? propsActiveId : internalActiveId;
  const setActiveId = (id: string | null) => {
    setInternalActiveId(id);
    onActiveIdChange?.(id);
  };

  const [rangeAnchorId, setRangeAnchorId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string>('');
  const [visibleColumns, setVisibleColumns] = useState<QueueColumnKey[]>(() => {
    try {
      const value = localStorage.getItem(COLUMN_VISIBILITY_STORAGE_KEY);
      if (value) {
        const saved = JSON.parse(value) as unknown;
        if (Array.isArray(saved)) {
          const hasExplicitActions =
            saved.includes('actions') ||
            localStorage.getItem('printassist_queue_actions_explicit');
          return DEFAULT_VISIBLE_COLUMNS.filter((key) => {
            if (key === 'actions' && !hasExplicitActions) return true;
            return saved.includes(key);
          });
        }
      }
    } catch { /* use defaults */ }
    return DEFAULT_VISIBLE_COLUMNS;
  });
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    try {
      const value = localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY);
      if (value) {
        const saved = JSON.parse(value);
        if (saved && typeof saved === 'object') {
          return { ...DEFAULT_COLUMN_WIDTHS, ...saved };
        }
      }
    } catch {
      /* use defaults */
    }
    return DEFAULT_COLUMN_WIDTHS;
  });

  const handleColumnResizeStart = (
    colKey: string,
    defaultWidth: number,
    e: React.MouseEvent,
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startWidth = columnWidths[colKey] ?? defaultWidth;
    const minWidth = colKey === 'kind' || colKey === 'status' ? 60 : 80;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();
      const delta = moveEvent.clientX - startX;
      const nextWidth = Math.max(minWidth, startWidth + delta);
      setColumnWidths((prev) => ({
        ...prev,
        [colKey]: nextWidth,
      }));
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      setColumnWidths((latest) => {
        try {
          localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(latest));
        } catch {
          /* ignore */
        }
        return latest;
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleColumnReset = (
    colKey: string,
    defaultWidth: number,
    e: React.MouseEvent,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setColumnWidths((prev) => {
      const next = { ...prev, [colKey]: defaultWidth };
      try {
        localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [contextMenu, setContextMenu] = useState<
    | { type: 'row'; position: { x: number; y: number }; item: QueueItem }
    | { type: 'blank'; position: { x: number; y: number } }
    | { type: 'header'; position: { x: number; y: number } }
    | null
  >(null);
  const [marqueeBox, setMarqueeBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const marqueeStartRef = useRef<{ x: number; y: number; ctrl: boolean; shift: boolean } | null>(null);
  const isDraggingMarquee = useRef(false);
  const isReordering = useRef(false);

  // Ctrl tracking for copy drag
  const isCtrlKeyRef = useRef(false);
  const isCopyDraggingRef = useRef(false);
  const [, setIsCopyDraggingState] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') {
        isCtrlKeyRef.current = true;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') {
        isCtrlKeyRef.current = false;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Configure sensors for drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
  );

  // Count duplicate file names to provide disambiguation hints
  const fileNameCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of items) {
      counts[item.fileName] = (counts[item.fileName] || 0) + 1;
    }
    return counts;
  }, [items]);

  // Track occurrences of identical paths for compact "重复 X/Y" tags
  const duplicatePathStats = useMemo(() => {
    const pathMap: Record<string, string[]> = {};
    for (const item of items) {
      const key = normalizeLocalPath(item.path);
      if (!pathMap[key]) pathMap[key] = [];
      pathMap[key].push(item.id);
    }
    const stats: Record<string, { index: number; total: number }> = {};
    for (const ids of Object.values(pathMap)) {
      if (ids.length > 1) {
        ids.forEach((id, idx) => {
          stats[id] = { index: idx + 1, total: ids.length };
        });
      }
    }
    return stats;
  }, [items]);

  // Select all duplicate copies of the active or specified file (Ctrl+Shift+A)
  const handleSelectAllDuplicates = useCallback(
    (fromId?: string) => {
      if (items.length === 0) return;
      const targetId =
        fromId || activeId || (selectedRowKeys.length > 0 ? String(selectedRowKeys[0]) : null);
      if (!targetId) {
        message.info('请先选择一个文件');
        return;
      }
      const targetItem = items.find((i) => i.id === targetId);
      if (!targetItem) {
        message.info('请先选择一个文件');
        return;
      }
      const targetKey = normalizeLocalPath(targetItem.path);
      const duplicateIds = items
        .filter((i) => normalizeLocalPath(i.path) === targetKey)
        .map((i) => i.id);

      onSelectionChange(duplicateIds);
      setActiveId(targetItem.id);
      if (duplicateIds.length > 1) {
        message.success(`已选中“${targetItem.fileName}”的全部 ${duplicateIds.length} 个副本`);
      } else {
        message.info(`“${targetItem.fileName}”在列表中仅有 1 项（无其他副本）`);
      }
    },
    [items, activeId, selectedRowKeys, onSelectionChange, setActiveId],
  );

  const copySelection = useCallback(() => {
    if (selectedRowKeys.length === 0) {
      message.info('请先选择文件');
      return;
    }
    const selectedSet = new Set(selectedRowKeys.map(String));
    const toCopy = items.filter((i) => selectedSet.has(i.id));
    if (toCopy.length === 0) return;

    queueClipboard = toCopy.map((i) => ({
      path: i.path,
      fileName: i.fileName,
      kind: i.kind,
      pageCount: i.pageCount,
      override: { ...i.override },
    }));
    message.success(`已复制 ${queueClipboard.length} 个文件`);
  }, [items, selectedRowKeys]);

  const pasteAfterTarget = useCallback(
    (targetId: string | null) => {
      if (isLocked) {
        message.warning(isPrinting ? '打印进行中，暂不可修改队列' : '当前批次已完成，请先开始新批次');
        return;
      }
      if (queueClipboard.length === 0) {
        return;
      }
      const effectiveTargetId = targetId || activeId || (items.length > 0 ? items[items.length - 1].id : null);
      const newIds = onPasteSnapshots?.(queueClipboard, effectiveTargetId);
      if (newIds && newIds.length > 0) {
        onSelectionChange(newIds);
        setActiveId(newIds[newIds.length - 1]);
      }
      message.success(`已粘贴 ${queueClipboard.length} 个文件`);
    },
    [activeId, isLocked, isPrinting, items, onPasteSnapshots, onSelectionChange, setActiveId],
  );

  const selectDuplicates = useCallback(
    (targetPath: string) => {
      const norm = normalizeLocalPath(targetPath);
      const duplicateIds = items.filter((i) => normalizeLocalPath(i.path) === norm).map((i) => i.id);
      if (duplicateIds.length > 0) {
        onSelectionChange(duplicateIds);
        message.info(`已选中 ${duplicateIds.length} 个相同路径的文件`);
      }
    },
    [items, onSelectionChange],
  );

  const removeSelection = useCallback(() => {
    if (isLocked) {
      message.warning(isPrinting ? '打印进行中，暂不可修改队列' : '当前批次已完成，请先开始新批次');
      return;
    }
    if (selectedRowKeys.length > 1) {
      if (onBatchRemove) {
        onBatchRemove();
      } else {
        selectedRowKeys.forEach((k) => onRemove(String(k)));
        onSelectionChange([]);
      }
    } else if (selectedRowKeys.length === 1) {
      onRemove(String(selectedRowKeys[0]));
      onSelectionChange([]);
    }
  }, [isLocked, isPrinting, onBatchRemove, onRemove, onSelectionChange, selectedRowKeys]);

  // Global Ctrl+C / Ctrl+V / Ctrl+Shift+A keyboard shortcuts
  useEffect(() => {
    const handleGlobalCopyPaste = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.closest('.ant-modal') ||
          target.closest('.ant-drawer'))
      ) {
        return;
      }

      const isModKey = e.ctrlKey || e.metaKey;
      if (!isModKey) return;

      if (e.key.toLowerCase() === 'a' && e.shiftKey) {
        e.preventDefault();
        handleSelectAllDuplicates();
        return;
      }

      if (e.key.toLowerCase() === 'c') {
        copySelection();
        e.preventDefault();
      } else if (e.key.toLowerCase() === 'v') {
        pasteAfterTarget(activeId || null);
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleGlobalCopyPaste);
    return () => {
      window.removeEventListener('keydown', handleGlobalCopyPaste);
    };
  }, [handleSelectAllDuplicates, copySelection, pasteAfterTarget, activeId]);

  // Synchronize activeId and rangeAnchorId if files were removed
  useEffect(() => {
    if (activeId && !items.some((i) => i.id === activeId)) {
      const nextActive = items.length > 0 ? items[0].id : null;
      setActiveId(nextActive);
      setRangeAnchorId(nextActive);
    }
  }, [items, activeId, setActiveId]);

  const handleShowInFolder = async (filePath: string) => {
    try {
      await showInFolder(filePath);
    } catch (error) {
      console.error('Failed to show file in folder', error);
    }
  };

  const handleOpenFile = async (filePath: string) => {
    try {
      await openFile(filePath);
    } catch (error) {
      console.error('Failed to open file', error);
    }
  };

  const toggleColumn = (key: QueueColumnKey) => {
    if (key === 'actions') {
      try {
        localStorage.setItem('printassist_queue_actions_explicit', 'true');
      } catch {
        /* ignore */
      }
    }
    setVisibleColumns((previous) => {
      const next = previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key];
      try {
        localStorage.setItem(COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const handleHeaderContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      type: 'header',
      position: { x: e.clientX, y: e.clientY },
    });
  };

  const renderSortableTitle = (
    label: string,
    field: QueueSortField,
    colKey: string,
    defaultWidth: number,
  ) => (
    <div className="queue-th-sort-wrapper" onContextMenu={handleHeaderContextMenu}>
      <span>{label}</span>
      {sortOrder?.mode === field ? (
        sortOrder.direction === 'asc' ? (
          <ArrowUp size={13} className="queue-sort-icon is-active" />
        ) : (
          <ArrowDown size={13} className="queue-sort-icon is-active" />
        )
      ) : (
        <ArrowUpDown size={13} className="queue-sort-icon is-inactive" />
      )}
      <span
        className="queue-col-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={`调整 ${label} 列宽`}
        title="左右拖动调整列宽，双击恢复默认"
        onMouseDown={(e) => handleColumnResizeStart(colKey, defaultWidth, e)}
        onDoubleClick={(e) => handleColumnReset(colKey, defaultWidth, e)}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );

  const renderColumnMenuTitle = (
    label: string,
    colKey: string,
    defaultWidth: number,
  ) => (
    <div className="queue-th-title-wrapper" onContextMenu={handleHeaderContextMenu}>
      <span>{label}</span>
      <span
        className="queue-col-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={`调整 ${label} 列宽`}
        title="左右拖动调整列宽，双击恢复默认"
        onMouseDown={(e) => handleColumnResizeStart(colKey, defaultWidth, e)}
        onDoubleClick={(e) => handleColumnReset(colKey, defaultWidth, e)}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );

  const handleRowContextMenu = (record: QueueItem, event: React.MouseEvent) => {
    const isAlreadySelected = selectedRowKeys.map(String).includes(record.id);
    if (!isAlreadySelected) {
      onSelectionChange([record.id]);
      setActiveId(record.id);
      setRangeAnchorId(record.id);
    }
    setContextMenu({
      type: 'row',
      position: { x: event.clientX, y: event.clientY },
      item: record,
    });
  };

  const handleContainerContextMenu = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest('.ant-table-thead, [data-row-id]')) {
      return;
    }
    event.preventDefault();
    setContextMenu({
      type: 'blank',
      position: { x: event.clientX, y: event.clientY },
    });
  };

  const getContextMenuItems = (): AppContextMenuItem[] => {
    if (!contextMenu) return [];

    if (contextMenu.type === 'blank') {
      const itemsList: AppContextMenuItem[] = [
        {
          key: 'add-files',
          label: '选择文件',
          icon: <FilePlus2 size={14} />,
          onClick: () => onAddFiles?.(),
        },
      ];
      if (queueClipboard.length > 0) {
        itemsList.push({
          key: 'paste',
          label: `粘贴文件项（${queueClipboard.length} 项）`,
          icon: <Copy size={14} />,
          shortcut: 'Ctrl+V',
          disabled: isLocked,
          disabledReason: lockReason,
          onClick: () => pasteAfterTarget(null),
        });
      }
      return itemsList;
    }

    if (contextMenu.type === 'header') {
      return [
        ...(Object.keys(COLUMN_LABELS) as QueueColumnKey[]).map((key) => ({
          key,
          label: COLUMN_LABELS[key],
          checked: visibleColumns.includes(key),
          onClick: () => toggleColumn(key),
        })),
        { type: 'divider' as const },
        {
          key: 'reset-columns',
          label: '恢复默认列',
          icon: <RotateCcw size={14} />,
          onClick: () => {
            setVisibleColumns(DEFAULT_VISIBLE_COLUMNS);
            setColumnWidths(DEFAULT_COLUMN_WIDTHS);
            try {
              localStorage.removeItem('printassist_queue_actions_explicit');
              localStorage.setItem(
                COLUMN_VISIBILITY_STORAGE_KEY,
                JSON.stringify(DEFAULT_VISIBLE_COLUMNS),
              );
              localStorage.setItem(
                COLUMN_WIDTHS_STORAGE_KEY,
                JSON.stringify(DEFAULT_COLUMN_WIDTHS),
              );
            } catch {
              /* ignore */
            }
          },
        },
      ];
    }

    // contextMenu.type === 'row'
    const isMulti = selectedRowKeys.length > 1;
    const isBatchSettingsDisabled =
      isLocked || (globalSettings.collateMode === 'bySet' && globalSettings.copies > 1);
    const batchSettingsDisabledReason =
      lockReason ||
      (globalSettings.collateMode === 'bySet' && globalSettings.copies > 1
        ? '全局已设置为逐套打印，禁止批量修改配置'
        : undefined);

    if (isMulti) {
      const itemsList: AppContextMenuItem[] = [
        {
          key: 'batch-settings',
          label: `批量设置（${selectedRowKeys.length} 项）`,
          icon: <Settings2 size={14} />,
          disabled: isBatchSettingsDisabled,
          disabledReason: batchSettingsDisabledReason,
          onClick: () => onBatchSettings?.(),
        },
        {
          key: 'copy',
          label: `复制文件项（${selectedRowKeys.length} 项）`,
          icon: <Copy size={14} />,
          shortcut: 'Ctrl+C',
          onClick: copySelection,
        },
      ];

      if (queueClipboard.length > 0) {
        itemsList.push({
          key: 'paste-after',
          label: `粘贴到此项之后（${queueClipboard.length} 项）`,
          icon: <Copy size={14} />,
          shortcut: 'Ctrl+V',
          disabled: isLocked,
          disabledReason: lockReason,
          onClick: () => pasteAfterTarget(contextMenu.item.id),
        });
      }

      itemsList.push(
        { type: 'divider' },
        {
          key: 'remove',
          label: `移除（${selectedRowKeys.length} 项）`,
          icon: <Trash2 size={14} />,
          shortcut: 'Delete',
          danger: true,
          disabled: isLocked,
          disabledReason: lockReason,
          onClick: removeSelection,
        },
      );

      return itemsList;
    }

    // Single item
    const itemsList: AppContextMenuItem[] = [
      {
        key: 'open-file',
        label: '打开文件',
        icon: <FileText size={14} />,
        onClick: () => void handleOpenFile(contextMenu.item.path),
      },
      {
        key: 'show-in-folder',
        label: '在文件夹中显示',
        icon: <FolderOpen size={14} />,
        onClick: () => void handleShowInFolder(contextMenu.item.path),
      },
      {
        key: 'settings',
        label: '文件打印设置',
        icon: <Settings2 size={14} />,
        disabled: isLocked,
        disabledReason: lockReason,
        onClick: () => onOpenSettings(contextMenu.item.id),
      },
      { type: 'divider' },
      {
        key: 'select-duplicates',
        label: '选择此文件的全部副本',
        icon: <CircleDot size={14} />,
        onClick: () => selectDuplicates(contextMenu.item.path),
      },
      {
        key: 'copy',
        label: '复制文件项',
        icon: <Copy size={14} />,
        shortcut: 'Ctrl+C',
        onClick: copySelection,
      },
    ];

    if (queueClipboard.length > 0) {
      itemsList.push({
        key: 'paste-after',
        label: `粘贴到此项之后（${queueClipboard.length} 项）`,
        icon: <Copy size={14} />,
        shortcut: 'Ctrl+V',
        disabled: isLocked,
        disabledReason: lockReason,
        onClick: () => pasteAfterTarget(contextMenu.item.id),
      });
    }

    itemsList.push(
      { type: 'divider' },
      {
        key: 'remove',
        label: '移除',
        icon: <Trash2 size={14} />,
        shortcut: 'Delete',
        danger: true,
        disabled: isLocked,
        disabledReason: lockReason,
        onClick: () => {
          onRemove(contextMenu.item.id);
          onSelectionChange(selectedRowKeys.filter((k) => k !== contextMenu.item.id));
        },
      },
    );

    return itemsList;
  };

  // Row selection logic
  const handleRowClick = (id: string, index: number, event: React.MouseEvent) => {
    const isMultiKey = event.ctrlKey || event.metaKey;
    const isRangeKey = event.shiftKey;

    if (isRangeKey && rangeAnchorId) {
      const anchorIndex = items.findIndex((i) => i.id === rangeAnchorId);
      if (anchorIndex !== -1) {
        const start = Math.min(anchorIndex, index);
        const end = Math.max(anchorIndex, index);
        const rangeIds = items.slice(start, end + 1).map((i) => i.id);

        if (isMultiKey) {
          const merged = Array.from(new Set([...selectedRowKeys.map(String), ...rangeIds]));
          onSelectionChange(merged);
        } else {
          onSelectionChange(rangeIds);
        }
        setActiveId(id);
        return;
      }
    }

    if (isMultiKey) {
      const stringKeys = selectedRowKeys.map(String);
      const isSelected = stringKeys.includes(id);
      const nextKeys = isSelected
        ? stringKeys.filter((k) => k !== id)
        : [...stringKeys, id];

      onSelectionChange(nextKeys);
      setActiveId(id);
      setRangeAnchorId(id);
      return;
    }

    onSelectionChange([id]);
    setActiveId(id);
    setRangeAnchorId(id);
  };

  // Keyboard navigation
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (items.length === 0) return;

    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      handleSelectAllDuplicates();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      onSelectionChange(items.map((i) => i.id));
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (selectedRowKeys.length > 0 && !isLocked) {
        event.preventDefault();
        return;
      }
    }

    if (event.key === 'Enter') {
      if (activeId && !isLocked) {
        event.preventDefault();
        onOpenSettings(activeId);
      }
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // Don't handle if Alt is pressed (that's reordering)
      if (event.altKey) return;

      event.preventDefault();
      const currentIndex = activeId ? items.findIndex((i) => i.id === activeId) : -1;
      let nextIndex = currentIndex;

      if (event.key === 'ArrowDown') {
        nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : currentIndex;
      } else {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : 0;
      }

      if (nextIndex >= 0 && nextIndex < items.length) {
        const nextItem = items[nextIndex];
        setActiveId(nextItem.id);

        if (event.shiftKey && rangeAnchorId) {
          const anchorIndex = items.findIndex((i) => i.id === rangeAnchorId);
          if (anchorIndex !== -1) {
            const start = Math.min(anchorIndex, nextIndex);
            const end = Math.max(anchorIndex, nextIndex);
            onSelectionChange(items.slice(start, end + 1).map((i) => i.id));
          }
        } else {
          setRangeAnchorId(nextItem.id);
          onSelectionChange([nextItem.id]);
        }
      }
    }

    if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
      const targetId = activeId || (selectedRowKeys.length > 0 ? String(selectedRowKeys[0]) : null);
      if (targetId) {
        const item = items.find((i) => i.id === targetId);
        if (item) {
          event.preventDefault();
          const rowEl = containerRef.current?.querySelector(`[data-row-id="${targetId}"]`) as HTMLElement | null;
          const rect = rowEl?.getBoundingClientRect();
          setContextMenu({
            type: 'row',
            position: rect
              ? { x: rect.left + Math.min(160, rect.width / 2), y: rect.top + rect.height / 2 }
              : { x: 200, y: 200 },
            item,
          });
        }
      }
      return;
    }

    if (event.key === 'Escape') {
      marqueeStartRef.current = null;
      isDraggingMarquee.current = false;
      setMarqueeBox(null);
    }
  };

  // Drag & drop sorting handler
  const handleDragStart = (_event: DragStartEvent) => {
    isReordering.current = true;
    marqueeStartRef.current = null;
    isDraggingMarquee.current = false;
    setMarqueeBox(null);

    const isCopy = Boolean(
      isCtrlKeyRef.current ||
        (window.event as MouseEvent | undefined)?.ctrlKey ||
        (window.event as MouseEvent | undefined)?.metaKey,
    );
    isCopyDraggingRef.current = isCopy;
    setIsCopyDraggingState(isCopy);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const wasCopy = isCopyDraggingRef.current;
    isCopyDraggingRef.current = false;
    setIsCopyDraggingState(false);
    isReordering.current = false;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    const oldIndex = items.findIndex((i) => i.id === activeId);
    const newIndex = items.findIndex((i) => i.id === overId);
    if (oldIndex < 0 || newIndex < 0) return;

    const isSelected = selectedRowKeys.map(String).includes(activeId);
    let movingIds: string[];

    if (isSelected && selectedRowKeys.length > 1) {
      const selectedSet = new Set(selectedRowKeys.map(String));
      movingIds = items.filter((i) => selectedSet.has(i.id)).map((i) => i.id);
    } else {
      movingIds = [activeId];
      if (!isSelected) {
        onSelectionChange([activeId]);
        setActiveId(activeId);
      }
    }

    const position = newIndex > oldIndex ? 'after' : 'before';

    if (wasCopy) {
      if (onCloneItems) {
        onCloneItems(movingIds, overId, position);
        setAnnouncement(`已复制 ${movingIds.length} 个文件到第 ${newIndex + 1} 位`);
      }
    } else {
      if (onReorderItems) {
        onReorderItems(movingIds, overId, position);
        const movedItem = items[oldIndex];
        if (movedItem) {
          setAnnouncement(`已将“${movedItem.fileName}”移动到第 ${newIndex + 1} 位`);
        }
      }
    }
  };

  // Keyboard reordering handler
  const handleKeyboardMove = (id: string, e: React.KeyboardEvent) => {
    if (!e.altKey || !onReorderItems || isLocked) return;

    const currentIndex = items.findIndex((i) => i.id === id);
    if (currentIndex < 0) return;

    const isSelected = selectedRowKeys.map(String).includes(id);
    let movingIds: string[];

    if (isSelected && selectedRowKeys.length > 1) {
      const selectedSet = new Set(selectedRowKeys.map(String));
      movingIds = items.filter((i) => selectedSet.has(i.id)).map((i) => i.id);
    } else {
      movingIds = [id];
    }

    const movingSet = new Set(movingIds);
    const remaining = items.filter((i) => !movingSet.has(i.id));
    if (remaining.length === 0) return;

    let targetId: string;
    let position: 'before' | 'after';

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const firstMovingIdx = items.findIndex((i) => movingSet.has(i.id));
      if (firstMovingIdx <= 0) return;
      targetId = items[firstMovingIdx - 1].id;
      position = 'before';
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      let lastMovingIdx = -1;
      for (let i = items.length - 1; i >= 0; i--) {
        if (movingSet.has(items[i].id)) {
          lastMovingIdx = i;
          break;
        }
      }
      if (lastMovingIdx < 0 || lastMovingIdx >= items.length - 1) return;
      targetId = items[lastMovingIdx + 1].id;
      position = 'after';
    } else if (e.key === 'Home') {
      e.preventDefault();
      targetId = remaining[0].id;
      position = 'before';
    } else if (e.key === 'End') {
      e.preventDefault();
      targetId = remaining[remaining.length - 1].id;
      position = 'after';
    } else {
      return;
    }

    onReorderItems(movingIds, targetId, position);
    const currentItem = items[currentIndex];
    if (currentItem) {
      setAnnouncement(`已调整“${currentItem.fileName}”的顺序`);
    }
  };

  // Mouse marquee selection
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || isPrinting || isReordering.current) return;
    const target = e.target as HTMLElement;
    if (
      target.closest(
        'button, input, a, .ant-checkbox-wrapper, .ant-dropdown-trigger, .ant-table-header, .queue-drag-handle',
      )
    ) {
      return;
    }
    const container = containerRef.current;
    if (!container) return;

    marqueeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      ctrl: e.ctrlKey || e.metaKey,
      shift: e.shiftKey,
    };
    isDraggingMarquee.current = false;
  };

  useEffect(() => {
    const handleWindowMouseMove = (e: MouseEvent) => {
      if (isReordering.current) return;
      const start = marqueeStartRef.current;
      if (!start || !containerRef.current) return;

      const deltaX = Math.abs(e.clientX - start.x);
      const deltaY = Math.abs(e.clientY - start.y);

      if (!isDraggingMarquee.current) {
        if (deltaX > 4 || deltaY > 4) {
          isDraggingMarquee.current = true;
        } else {
          return;
        }
      }

      const containerRect = containerRef.current.getBoundingClientRect();
      const left = Math.min(start.x, e.clientX) - containerRect.left + containerRef.current.scrollLeft;
      const top = Math.min(start.y, e.clientY) - containerRect.top + containerRef.current.scrollTop;
      const width = Math.abs(e.clientX - start.x);
      const height = Math.abs(e.clientY - start.y);

      setMarqueeBox({ left, top, width, height });

      const boxRect = {
        left: Math.min(start.x, e.clientX),
        top: Math.min(start.y, e.clientY),
        right: Math.max(start.x, e.clientX),
        bottom: Math.max(start.y, e.clientY),
      };

      const rowElements = containerRef.current.querySelectorAll<HTMLElement>('[data-row-id]');
      const hitIds: string[] = [];
      rowElements.forEach((row) => {
        const rowRect = row.getBoundingClientRect();
        const intersects = !(
          boxRect.right < rowRect.left ||
          boxRect.left > rowRect.right ||
          boxRect.bottom < rowRect.top ||
          boxRect.top > rowRect.bottom
        );
        if (intersects) {
          const id = row.getAttribute('data-row-id');
          if (id) hitIds.push(id);
        }
      });

      if (start.ctrl || start.shift) {
        const currentSet = new Set(selectedRowKeys.map(String));
        hitIds.forEach((id) => currentSet.add(id));
        onSelectionChange(Array.from(currentSet));
      } else {
        onSelectionChange(hitIds);
      }
    };

    const handleWindowMouseUp = () => {
      marqueeStartRef.current = null;
      isDraggingMarquee.current = false;
      setMarqueeBox(null);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    window.addEventListener('blur', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      window.removeEventListener('blur', handleWindowMouseUp);
    };
  }, [selectedRowKeys, onSelectionChange]);

  // Columns definition
  const columns: ColumnsType<QueueItem> = [
    {
      title: renderSortableTitle('文件', 'fileName', 'fileName', DEFAULT_COLUMN_WIDTHS.fileName),
      dataIndex: 'fileName',
      key: 'fileName',
      width: columnWidths.fileName ?? DEFAULT_COLUMN_WIDTHS.fileName,
      className: 'queue-col-file',
      onHeaderCell: () => ({
        onClick: (e: React.MouseEvent) => {
          if ((e.target as HTMLElement).closest('.queue-col-resizer')) return;
          onToggleSort?.('fileName');
        },
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleSort?.('fileName');
          }
        },
        tabIndex: 0,
        role: 'button',
        title: '点击排序列：文件名正序/倒序切换',
        'aria-sort':
          sortOrder?.mode === 'fileName'
            ? sortOrder.direction === 'asc'
              ? 'ascending'
              : 'descending'
            : 'none',
        className: `queue-th-sortable queue-col-file${sortOrder?.mode === 'fileName' ? ' is-sorted' : ''}`,
      }),
      onCell: () => ({
        className: 'queue-col-file',
      }),
      render: (fileName: string, record) => {
        const isDuplicate = (fileNameCounts[fileName] || 0) > 1;
        const parentDir = isDuplicate ? getParentDirectoryName(record.path) : '';
        const duplicateStat = duplicatePathStats[record.id];

        return (
          <FileNameCell
            record={record}
            isDuplicate={isDuplicate}
            parentDir={parentDir}
            duplicateStat={duplicateStat}
            isPrinting={isLocked}
            onKeyboardMove={handleKeyboardMove}
            onSelectDuplicates={(id) => handleSelectAllDuplicates(id)}
            onOpenFile={(path) => void handleOpenFile(path)}
          />
        );
      },
    },
    {
      title: renderSortableTitle('文件路径', 'path', 'path', DEFAULT_COLUMN_WIDTHS.path),
      dataIndex: 'path',
      key: 'path',
      width: columnWidths.path ?? DEFAULT_COLUMN_WIDTHS.path,
      onHeaderCell: () => ({
        onClick: (e: React.MouseEvent) => {
          if ((e.target as HTMLElement).closest('.queue-col-resizer')) return;
          onToggleSort?.('path');
        },
        className: 'queue-th-sortable',
      }),
      render: (_: string, record) => {
        const dirOnly = getDirectoryOnly(record.path);
        return (
          <OverflowTooltipText
            text={dirOnly}
            className="queue-path-cell queue-double-click-path"
            tooltipTitle={
              <div style={{ wordBreak: 'break-all', maxWidth: 450 }}>
                {dirOnly}
              </div>
            }
            placement="topLeft"
            onDoubleClick={(event) => {
              event.stopPropagation();
              void handleShowInFolder(record.path);
            }}
          />
        );
      },
    },
    {
      title: renderSortableTitle('创建时间', 'createdAt', 'createdAt', DEFAULT_COLUMN_WIDTHS.createdAt),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: columnWidths.createdAt ?? DEFAULT_COLUMN_WIDTHS.createdAt,
      onHeaderCell: () => ({
        onClick: (e: React.MouseEvent) => {
          if ((e.target as HTMLElement).closest('.queue-col-resizer')) return;
          onToggleSort?.('createdAt');
        },
        className: 'queue-th-sortable',
      }),
      render: (value) => formatDateTime(value),
    },
    {
      title: renderSortableTitle('修改时间', 'modifiedAt', 'modifiedAt', DEFAULT_COLUMN_WIDTHS.modifiedAt),
      dataIndex: 'modifiedAt',
      key: 'modifiedAt',
      width: columnWidths.modifiedAt ?? DEFAULT_COLUMN_WIDTHS.modifiedAt,
      onHeaderCell: () => ({
        onClick: (e: React.MouseEvent) => {
          if ((e.target as HTMLElement).closest('.queue-col-resizer')) return;
          onToggleSort?.('modifiedAt');
        },
        className: 'queue-th-sortable',
      }),
      render: (value) => formatDateTime(value),
    },
    {
      title: renderSortableTitle('文件大小', 'fileSize', 'fileSize', DEFAULT_COLUMN_WIDTHS.fileSize),
      dataIndex: 'fileSize',
      key: 'fileSize',
      width: columnWidths.fileSize ?? DEFAULT_COLUMN_WIDTHS.fileSize,
      align: 'right',
      onHeaderCell: () => ({
        onClick: (e: React.MouseEvent) => {
          if ((e.target as HTMLElement).closest('.queue-col-resizer')) return;
          onToggleSort?.('fileSize');
        },
        className: 'queue-th-sortable',
      }),
      render: (value) => formatFileSize(value),
    },
    {
      title: renderColumnMenuTitle('类型', 'kind', DEFAULT_COLUMN_WIDTHS.kind),
      dataIndex: 'kind',
      key: 'kind',
      width: columnWidths.kind ?? DEFAULT_COLUMN_WIDTHS.kind,
      align: 'center',
      render: (kind: QueueItem['kind']) => (
        <span className="queue-type-badge">{kindLabel(kind)}</span>
      ),
    },
    {
      title: renderColumnMenuTitle('设置', 'settings', DEFAULT_COLUMN_WIDTHS.settings),
      key: 'settings',
      width: columnWidths.settings ?? DEFAULT_COLUMN_WIDTHS.settings,
      align: 'center',
      render: (_, record) => {
        const resolved = mergePrintSettings(globalSettings, record.override);
        const isOverridden = hasFileOverride(record.override);
        const collateLabel =
          resolved.copies > 1
            ? resolved.collateMode === 'byPage'
              ? ' · 逐页'
              : resolved.collateMode === 'bySet'
                ? ' · 逐套'
                : ' · 逐份'
            : '';
        return (
          <div className="queue-setting-summary queue-double-click-settings" title="双击打开文件配置" onDoubleClick={(event) => { event.stopPropagation(); if (!isLocked) onOpenSettings(record.id); }}>
            <div className="queue-setting-primary">
              {resolved.colorMode === 'color' ? '彩色' : '黑白'} ·{' '}
              {resolved.sidesMode === 'duplex'
                ? `双面(${resolved.flipMode === 'longEdge' ? '长边' : '短边'})`
                : '单面'}{' '}
              · {resolved.copies}份{collateLabel}
            </div>
            <div className="queue-setting-sub">
              {describePageRange(resolved.pageRange)}
              {isOverridden ? (
                <span className="queue-override-tag"> · 单独配置</span>
              ) : null}
            </div>
          </div>
        );
      },
    },
    {
      title: renderColumnMenuTitle('状态', 'status', DEFAULT_COLUMN_WIDTHS.status),
      dataIndex: 'status',
      key: 'status',
      width: columnWidths.status ?? DEFAULT_COLUMN_WIDTHS.status,
      align: 'center',
      render: (status: QueueItem['status'], record) => renderStatusIcon(status, record.errorMessage),
    },
    {
      title: renderColumnMenuTitle('操作', 'actions', DEFAULT_COLUMN_WIDTHS.actions),
      key: 'actions',
      width: columnWidths.actions ?? DEFAULT_COLUMN_WIDTHS.actions,
      align: 'center',
      render: (_, record) => (
        <Space size={4}>
          <Tooltip
            title={
              isPrinting
                ? '打印中暂不支持修改配置'
                : isCompleted
                  ? '当前批次已完成，请在下方开始新批次或重试'
                  : '设置此文件的打印参数（也可双击行打开）'
            }
          >
            <span>
              <Button
                size="small"
                icon={<Settings2 size={13} />}
                disabled={isLocked}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenSettings(record.id);
                }}
                aria-label="设置此文件参数"
              />
            </span>
          </Tooltip>
          <Button
            size="small"
            icon={<FolderOpen size={13} />}
            onClick={(e) => {
              e.stopPropagation();
              void handleShowInFolder(record.path);
            }}
            title="在系统资源管理器中打开并定位文件"
            aria-label="在文件夹中显示"
          />
          <Button
            size="small"
            danger
            icon={<Trash2 size={13} />}
            disabled={isLocked}
            onClick={(e) => {
              e.stopPropagation();
              onRemove(record.id);
            }}
            title={isCompleted ? '当前批次已完成' : '从列表中移除此文件'}
            aria-label="移除文件"
          />
        </Space>
      ),
    },
  ];

  const displayedColumns = columns.filter(
    (column) =>
      !column.key ||
      !Object.prototype.hasOwnProperty.call(COLUMN_LABELS, String(column.key)) ||
      visibleColumns.includes(column.key as QueueColumnKey),
  );

  const totalScrollWidth = useMemo(() => {
    return displayedColumns.reduce((sum, col) => {
      const w = typeof col.width === 'number' ? col.width : 200;
      return sum + w;
    }, 60);
  }, [displayedColumns]);

  if (items.length === 0) {
    return (
      <div
        className={`queue-empty-container${!isPrinting ? ' is-clickable' : ''}`}
        onClick={() => {
          if (!isPrinting) {
            onAddFiles?.();
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({
            type: 'blank',
            position: { x: e.clientX, y: e.clientY },
          });
        }}
      >
        <div className="queue-empty-inner">
          <div className="queue-empty-icon-wrap">
            <FileText size={36} />
          </div>
          <div className="queue-empty-title">将文件或文件夹拖到此处，或点击添加</div>
          <div className="queue-empty-desc">
            支持 PDF、图片及 Office 文档（Word、Excel、PPT）
          </div>
        </div>
        <AppContextMenu
          open={Boolean(contextMenu)}
          position={contextMenu ? contextMenu.position : null}
          onClose={() => setContextMenu(null)}
          items={getContextMenuItems()}
        />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`queue-table-wrap${marqueeBox ? ' is-marquee-active' : ''}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContainerContextMenu}
    >
      <div
        aria-live="polite"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
        }}
      >
        {announcement}
      </div>

      {marqueeBox && (
        <div
          className="queue-marquee-box"
          style={{
            left: marqueeBox.left,
            top: marqueeBox.top,
            width: marqueeBox.width,
            height: marqueeBox.height,
          }}
        />
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          isReordering.current = false;
          isCopyDraggingRef.current = false;
          setIsCopyDraggingState(false);
        }}
      >
        <SortableContext
          items={items.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          <Table
            components={{
              body: {
                row: DraggableRow,
              },
            }}
            rowKey="id"
            size="small"
            pagination={false}
            columns={displayedColumns}
            scroll={{ x: Math.max(1000, totalScrollWidth) }}
            dataSource={items}
            className="queue-compact-table"
            rowSelection={{
              selectedRowKeys,
              onChange: (newKeys) => {
                onSelectionChange(newKeys);
                if (newKeys.length > 0) {
                  const lastKey = String(newKeys[newKeys.length - 1]);
                  setActiveId(lastKey);
                  setRangeAnchorId(lastKey);
                }
              },
              getCheckboxProps: (record) => ({
                disabled: isPrinting,
                'aria-label': `选择 ${record.fileName}`,
              }),
            }}
            onRow={(record, rowIndex) => ({
              'data-row-id': record.id,
              className: `queue-table-row${
                selectedRowKeys.includes(record.id) ? ' is-selected' : ''
              }${activeId === record.id ? ' is-active' : ''}`,
              onClick: (event: React.MouseEvent) => {
                const target = event.target as HTMLElement;
                if (
                  target.closest(
                    'button, input, a, .ant-checkbox-wrapper, .ant-dropdown-trigger, .queue-drag-handle',
                  )
                ) {
                  return;
                }
                handleRowClick(record.id, rowIndex ?? 0, event);
              },
              onContextMenu: (event: React.MouseEvent) => {
                event.preventDefault();
                event.stopPropagation();
                handleRowContextMenu(record, event);
              },
            })}
          />
        </SortableContext>
      </DndContext>

      <AppContextMenu
        open={Boolean(contextMenu)}
        position={contextMenu ? contextMenu.position : null}
        onClose={() => setContextMenu(null)}
        items={getContextMenuItems()}
      />
    </div>
  );
}
