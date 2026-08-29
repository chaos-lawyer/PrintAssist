import {
  Button,
  Space,
  Table,
  Tag,
  Tooltip,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  File,
  FileCode,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Image,
  Loader2,
  Presentation,
  Settings2,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { showInFolder } from '../../api/nativeBridge';
import type { QueueItem } from '../../domain/queueTypes';
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
  onSelectionChange: (keys: React.Key[]) => void;
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
      return <FileCode size={16} className="file-kind-icon file-kind-text" />;
    default:
      return <File size={16} className="file-kind-icon" />;
  }
}

function kindLabel(kind: QueueItem['kind']): string {
  switch (kind) {
    case 'pdf':
      return 'PDF';
    case 'image':
      return '图片';
    case 'text':
      return '文本';
    case 'word':
      return 'Word';
    case 'excel':
      return 'Excel';
    case 'powerpoint':
      return 'PPT';
    default:
      return '文档';
  }
}

function getParentDirectoryName(fullPath: string): string {
  if (!fullPath) return '';
  const normalized = fullPath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length >= 2) {
    return parts[parts.length - 2];
  }
  return '';
}

export function PrintQueue({
  items,
  globalSettings,
  isPrinting,
  selectedRowKeys,
  onSelectionChange,
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
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Marquee state
  const [marqueeBox, setMarqueeBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const marqueeStartRef = useRef<{ x: number; y: number; ctrl: boolean; shift: boolean } | null>(null);
  const isDraggingMarquee = useRef(false);

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
      setActiveId(items[0]?.id ?? null);
    }
    if (rangeAnchorId && !items.some((i) => i.id === rangeAnchorId)) {
      setRangeAnchorId(null);
    }
  }, [items, activeId, rangeAnchorId]);

  const handleShowInFolder = async (path: string) => {
    try {
      await showInFolder(path);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '打开文件夹失败');
    }
  };

  // Row selection handler
  const handleRowClick = (id: string, index: number, event: React.MouseEvent) => {
    const isCtrl = event.ctrlKey || event.metaKey;
    const isShift = event.shiftKey;

    setActiveId(id);

    if (isShift) {
      const anchorId = rangeAnchorId ?? items[0]?.id ?? id;
      const anchorIndex = items.findIndex((item) => item.id === anchorId);
      const validAnchorIndex = anchorIndex >= 0 ? anchorIndex : index;
      const startIndex = Math.min(validAnchorIndex, index);
      const endIndex = Math.max(validAnchorIndex, index);
      const rangeIds = items.slice(startIndex, endIndex + 1).map((item) => item.id);
      onSelectionChange(rangeIds);
    } else if (isCtrl) {
      const currentSet = new Set(selectedRowKeys.map(String));
      if (currentSet.has(id)) {
        currentSet.delete(id);
      } else {
        currentSet.add(id);
      }
      setRangeAnchorId(id);
      onSelectionChange(Array.from(currentSet));
    } else {
      setRangeAnchorId(id);
      onSelectionChange([id]);
    }
  };

  const handleRowDoubleClick = (id: string) => {
    setActiveId(id);
    onOpenSettings(id);
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (items.length === 0) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const currentIndex = activeId ? items.findIndex((i) => i.id === activeId) : -1;
      let nextIndex = currentIndex;
      if (e.key === 'ArrowDown') {
        nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : items.length - 1;
      } else {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : 0;
      }

      const nextItem = items[nextIndex];
      if (!nextItem) return;

      setActiveId(nextItem.id);

      if (e.shiftKey) {
        const anchorId = rangeAnchorId ?? (currentIndex >= 0 ? items[currentIndex].id : nextItem.id);
        const anchorIndex = items.findIndex((i) => i.id === anchorId);
        const start = Math.min(anchorIndex >= 0 ? anchorIndex : nextIndex, nextIndex);
        const end = Math.max(anchorIndex >= 0 ? anchorIndex : nextIndex, nextIndex);
        onSelectionChange(items.slice(start, end + 1).map((i) => i.id));
      } else {
        setRangeAnchorId(nextItem.id);
        onSelectionChange([nextItem.id]);
      }
    } else if (e.key === ' ') {
      e.preventDefault();
      if (activeId) {
        const currentSet = new Set(selectedRowKeys.map(String));
        if (currentSet.has(activeId)) {
          currentSet.delete(activeId);
        } else {
          currentSet.add(activeId);
          setRangeAnchorId(activeId);
        }
        onSelectionChange(Array.from(currentSet));
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeId) {
        onOpenSettings(activeId);
      }
    } else if (e.key === 'Escape') {
      setMarqueeBox(null);
      isDraggingMarquee.current = false;
      marqueeStartRef.current = null;
    }
  };

  // Mouse marquee selection
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, a, .ant-checkbox-wrapper, .ant-dropdown-trigger, .ant-table-header')) {
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

  const columns: ColumnsType<QueueItem> = [
    {
      title: '文件',
      dataIndex: 'fileName',
      key: 'fileName',
      render: (fileName: string, record) => {
        const isDuplicate = (fileNameCounts[fileName] || 0) > 1;
        const parentDir = isDuplicate ? getParentDirectoryName(record.path) : '';

        return (
          <div className="queue-file-cell">
            {renderFileIcon(record.kind)}
            <div className="queue-file-info">
              <Tooltip title={record.path} placement="topLeft" mouseEnterDelay={0.3}>
                <span className="queue-file-name">{fileName}</span>
              </Tooltip>
              {isDuplicate && parentDir && (
                <div className="queue-file-disambiguation" title={record.path}>
                  来自：{parentDir}
                </div>
              )}
            </div>
          </div>
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
        className="queue-empty-container is-clickable"
        onClick={onAddFiles}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onAddFiles?.();
          }
        }}
      >
        <div className="queue-empty-inner">
          <div className="queue-empty-icon-wrap">
            <FilePlus2 size={36} />
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
      <Table
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
            if (target.closest('button, input, a, .ant-checkbox-wrapper, .ant-dropdown-trigger')) {
              return;
            }
            handleRowClick(record.id, rowIndex ?? 0, event);
          },
          onDoubleClick: (event: React.MouseEvent) => {
            const target = event.target as HTMLElement;
            if (target.closest('button, input, a, .ant-checkbox-wrapper, .ant-dropdown-trigger')) {
              return;
            }
            handleRowDoubleClick(record.id);
          },
        })}
      />
    </div>
  );
}
