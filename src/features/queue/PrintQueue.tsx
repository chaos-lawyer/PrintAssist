import {
  Button,
  Space,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  GripVertical,
  Image,
  Loader2,
  Presentation,
  Settings2,
  Trash2,
} from 'lucide-react';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
import type { QueueItem, QueueOrder } from '../../domain/queueTypes';
import { describePageRange } from '../../domain/pageRange';
import {
  hasFileOverride,
  mergePrintSettings,
  type PrintSettings,
} from '../../domain/printSettings';

interface PrintQueueProps {
  items: QueueItem[];
  globalSettings: PrintSettings;
  isPrinting: boolean;
  selectedRowKeys: React.Key[];
  sortOrder?: QueueOrder;
  onSelectionChange: (keys: React.Key[]) => void;
  onToggleSort?: () => void;
  onReorderItems?: (
    movingIds: string[],
    targetId: string,
    position: 'before' | 'after',
  ) => void;
  onRemove: (id: string) => void;
  onOpenSettings: (id: string) => void;
  onAddFiles?: () => void;
  activeId?: string | null;
  onActiveIdChange?: (id: string | null) => void;
}

function statusTag(status: QueueItem['status']) {
  switch (status) {
    case 'ready':
    case 'pending':
      return <Tag color="blue">待打印</Tag>;
    case 'printing':
      return (
        <Tag
          color="processing"
          icon={
            <Loader2
              size={12}
              className="spin-icon"
              style={{ verticalAlign: -1, marginRight: 4 }}
            />
          }
        >
          打印中
        </Tag>
      );
    case 'succeeded':
      return <Tag color="success">成功</Tag>;
    case 'failed':
      return <Tag color="error">失败</Tag>;
    case 'skipped':
      return <Tag>跳过</Tag>;
    case 'analyzing':
      return <Tag color="gold">分析中</Tag>;
    default:
      return <Tag>{status}</Tag>;
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

  const rowStyle: React.CSSProperties = {
    ...style,
    transform: CSS.Translate.toString(transform),
    transition,
    ...(isDragging
      ? {
          position: 'relative',
          zIndex: 999,
          opacity: 0.5,
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
        }
      : {}),
  };

  return (
    <RowContext.Provider value={{ setActivatorNodeRef, listeners, attributes, isDragging }}>
      <tr
        {...restProps}
        ref={setNodeRef}
        className={`${className ?? ''}${isDragging ? ' is-dragging' : ''}`}
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
  isPrinting,
  onKeyboardMove,
}: {
  record: QueueItem;
  isDuplicate: boolean;
  parentDir: string;
  isPrinting: boolean;
  onKeyboardMove: (id: string, e: React.KeyboardEvent) => void;
}) {
  const { setActivatorNodeRef, attributes, listeners } = useContext(RowContext);

  return (
    <div className="queue-file-cell">
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="queue-drag-handle"
        title="拖动调整打印顺序（Alt+上下键键盘排序）"
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
        <Tooltip title={record.path} placement="topLeft" mouseEnterDelay={0.3}>
          <span className="queue-file-name">{record.fileName}</span>
        </Tooltip>
        {isDuplicate && parentDir && (
          <div className="queue-file-disambiguation" title={record.path}>
            来自：{parentDir}
          </div>
        )}
      </div>
    </div>
  );
}

export function PrintQueue({
  items,
  globalSettings,
  isPrinting,
  selectedRowKeys,
  sortOrder,
  onSelectionChange,
  onToggleSort,
  onReorderItems,
  onRemove,
  onOpenSettings,
  onAddFiles,
  activeId: propsActiveId,
  onActiveIdChange,
}: PrintQueueProps) {
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
    if (isPrinting) return;
    onOpenSettings(id);
  };

  // Keyboard navigation
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (items.length === 0) return;

    if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
      event.preventDefault();
      onSelectionChange(items.map((i) => i.id));
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (selectedRowKeys.length > 0 && !isPrinting) {
        event.preventDefault();
        return;
      }
    }

    if (event.key === 'Enter') {
      if (activeId && !isPrinting) {
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
  };

  const handleDragEnd = (event: DragEndEvent) => {
    isReordering.current = false;
    const { active, over } = event;
    if (!over || active.id === over.id || !onReorderItems) return;

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
    onReorderItems(movingIds, overId, position);

    const movedItem = items[oldIndex];
    if (movedItem) {
      setAnnouncement(`已将“${movedItem.fileName}”移动到第 ${newIndex + 1} 位`);
    }
  };

  // Keyboard reordering handler
  const handleKeyboardMove = (id: string, e: React.KeyboardEvent) => {
    if (!e.altKey || !onReorderItems || isPrinting) return;

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
        className: `queue-th-sortable${sortOrder?.mode === 'fileName' ? ' is-sorted' : ''}`,
      }),
      render: (fileName: string, record) => {
        const isDuplicate = (fileNameCounts[fileName] || 0) > 1;
        const parentDir = isDuplicate ? getParentDirectoryName(record.path) : '';

        return (
          <FileNameCell
            record={record}
            isDuplicate={isDuplicate}
            parentDir={parentDir}
            isPrinting={isPrinting}
            onKeyboardMove={handleKeyboardMove}
          />
        );
      },
    },
    {
      title: '类型',
      dataIndex: 'kind',
      key: 'kind',
      width: 75,
      align: 'center',
      render: (kind: QueueItem['kind']) => (
        <span className="queue-type-badge">{kindLabel(kind)}</span>
      ),
    },
    {
      title: '页数',
      dataIndex: 'pageCount',
      key: 'pageCount',
      width: 70,
      align: 'center',
      render: (pageCount: number | null) => (
        <span className="queue-page-count">{pageCount ?? '—'}</span>
      ),
    },
    {
      title: '设置',
      key: 'settings',
      width: 190,
      render: (_, record) => {
        const resolved = mergePrintSettings(globalSettings, record.override);
        const isOverridden = hasFileOverride(record.override);
        return (
          <div className="queue-setting-summary">
            <div className="queue-setting-primary">
              {resolved.colorMode === 'color' ? '彩色' : '黑白'} ·{' '}
              {resolved.sidesMode === 'duplex'
                ? `双面(${resolved.flipMode === 'longEdge' ? '长边' : '短边'})`
                : '单面'}{' '}
              · {resolved.copies}份
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
      width: 95,
      align: 'center',
      render: (status: QueueItem['status'], record) => (
        <div>
          {statusTag(status)}
          {record.errorMessage && (
            <div className="error-text" title={record.errorMessage}>
              {record.errorMessage}
            </div>
          )}
        </div>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 100,
      align: 'center',
      render: (_, record) => (
        <Space size={4}>
          <Button
            size="small"
            icon={<Settings2 size={13} />}
            disabled={isPrinting}
            onClick={(e) => {
              e.stopPropagation();
              onOpenSettings(record.id);
            }}
            title="设置此文件的打印参数（也可双击行打开）"
            aria-label="设置此文件参数"
          />
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
            disabled={isPrinting}
            onClick={(e) => {
              e.stopPropagation();
              onRemove(record.id);
            }}
            title="从列表中移除此文件"
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
            支持 PDF、图片及 Office 文档（Word、Excel、PPT），可继续批量追加
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
