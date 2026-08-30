import {
  Button,
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
  FileSpreadsheet,
  FileText,
  FolderOpen,
  GripVertical,
  Image,
  Loader2,
  MinusCircle,
  Presentation,
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
import { showInFolder } from '../../api/nativeBridge';
import type { BatchPhase, QueueItem, QueueOrder } from '../../domain/queueTypes';
import { describePageRange } from '../../domain/pageRange';
import {
  hasFileOverride,
  mergePrintSettings,
  type PrintSettings,
} from '../../domain/printSettings';
import { normalizeLocalPath } from './duplicateDetection';
import type { QueueItemSnapshot } from './queueReducer';

let queueClipboard: QueueItemSnapshot[] = [];

interface PrintQueueProps {
  items: QueueItem[];
  globalSettings: PrintSettings;
  isPrinting: boolean;
  phase?: BatchPhase;
  selectedRowKeys: React.Key[];
  sortOrder?: QueueOrder;
  onSelectionChange: (keys: React.Key[]) => void;
  onToggleSort?: () => void;
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

function getParentDirectoryName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length >= 2) {
    return parts[parts.length - 2];
  }
  return '';
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
}: {
  record: QueueItem;
  isDuplicate: boolean;
  parentDir: string;
  duplicateStat?: { index: number; total: number };
  isPrinting: boolean;
  onKeyboardMove: (id: string, e: React.KeyboardEvent) => void;
  onSelectDuplicates?: (id: string) => void;
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
          <Tooltip
            title={
              <div style={{ wordBreak: 'break-all' }}>
                <div style={{ fontWeight: 600 }}>{record.fileName}</div>
                {record.path && record.path !== record.fileName && (
                  <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>{record.path}</div>
                )}
              </div>
            }
            placement="topLeft"
            mouseEnterDelay={0.3}
          >
            <span className="queue-file-name">{record.fileName}</span>
          </Tooltip>
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
  onAddFiles,
  activeId: propsActiveId,
  onActiveIdChange,
}: PrintQueueProps) {
  const isCompleted = phase === 'completed';
  const isLocked = isPrinting || isCompleted;
  const [internalActiveId, setInternalActiveId] = useState<string | null>(null);
  const activeId = propsActiveId !== undefined ? propsActiveId : internalActiveId;
  const setActiveId = (id: string | null) => {
    setInternalActiveId(id);
    onActiveIdChange?.(id);
  };

  const [rangeAnchorId, setRangeAnchorId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string>('');
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Marquee and reordering mutual exclusion refs
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
    [items, activeId, selectedRowKeys, onSelectionChange],
  );

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
        e.preventDefault();
      } else if (e.key.toLowerCase() === 'v') {
        if (isLocked) {
          message.warning(isPrinting ? '打印进行中，暂不可修改队列' : '当前批次已完成，请先开始新批次');
          e.preventDefault();
          return;
        }
        if (queueClipboard.length === 0) {
          return;
        }
        const targetId = activeId || (items.length > 0 ? items[items.length - 1].id : null);
        const newIds = onPasteSnapshots?.(queueClipboard, targetId);
        if (newIds && newIds.length > 0) {
          onSelectionChange(newIds);
          setActiveId(newIds[newIds.length - 1]);
        }
        message.success(`已粘贴 ${queueClipboard.length} 个文件`);
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleGlobalCopyPaste);
    return () => {
      window.removeEventListener('keydown', handleGlobalCopyPaste);
    };
  }, [items, selectedRowKeys, activeId, isLocked, isPrinting, onPasteSnapshots, onSelectionChange, handleSelectAllDuplicates]);

  // Synchronize activeId and rangeAnchorId if files were removed
  useEffect(() => {
    if (activeId && !items.some((i) => i.id === activeId)) {
      const nextActive = items.length > 0 ? items[0].id : null;
      setActiveId(nextActive);
      setRangeAnchorId(nextActive);
    }
  }, [items, activeId]);

  const handleShowInFolder = async (filePath: string) => {
    try {
      await showInFolder(filePath);
    } catch (error) {
      console.error('Failed to show file in folder', error);
    }
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

  const handleRowDoubleClick = (id: string) => {
    if (isLocked) return;
    onOpenSettings(id);
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
      title: (
        <div className="queue-th-sort-wrapper">
          <span>文件</span>
          {sortOrder?.mode === 'fileName' ? (
            sortOrder.direction === 'asc' ? (
              <ArrowUp size={13} className="queue-sort-icon is-active" />
            ) : (
              <ArrowDown size={13} className="queue-sort-icon is-active" />
            )
          ) : (
            <ArrowUpDown size={13} className="queue-sort-icon is-inactive" />
          )}
        </div>
      ),
      dataIndex: 'fileName',
      key: 'fileName',
      className: 'queue-col-file',
      onHeaderCell: () => ({
        onClick: () => onToggleSort?.(),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleSort?.();
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
          />
        );
      },
    },
    {
      title: '类型',
      dataIndex: 'kind',
      key: 'kind',
      width: 80,
      align: 'center',
      render: (kind: QueueItem['kind']) => (
        <span className="queue-type-badge">{kindLabel(kind)}</span>
      ),
    },
    {
      title: '设置',
      key: 'settings',
      width: 220,
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
          <div className="queue-setting-summary">
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
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 70,
      align: 'center',
      render: (status: QueueItem['status'], record) => renderStatusIcon(status, record.errorMessage),
    },
    {
      title: '操作',
      key: 'actions',
      width: 100,
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

  if (items.length === 0) {
    return (
      <div
        className={`queue-empty-container${!isPrinting ? ' is-clickable' : ''}`}
        onClick={() => {
          if (!isPrinting) {
            onAddFiles?.();
          }
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
            columns={columns}
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
              onDoubleClick: (event: React.MouseEvent) => {
                const target = event.target as HTMLElement;
                if (
                  target.closest(
                    'button, input, a, .ant-checkbox-wrapper, .ant-dropdown-trigger, .queue-drag-handle',
                  )
                ) {
                  return;
                }
                handleRowDoubleClick(record.id);
              },
            })}
          />
        </SortableContext>
      </DndContext>
    </div>
  );
}
