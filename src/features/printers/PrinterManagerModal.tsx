import {
  Button,
  Empty,
  Input,
  Modal,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  GripVertical,
  RotateCcw,
  Search,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { SystemPrinter } from '../../shared/contracts/printer';
import { ShortcutBindingButton } from '../shortcuts/ShortcutBindingButton';
import {
  applyPrinterPreferences,
  type PrinterPreferencesV1,
} from './printerPreferences';

export interface PrinterManagerModalProps {
  open: boolean;
  systemPrinters: SystemPrinter[];
  preferences: PrinterPreferencesV1;
  currentPrinterName: string | null;
  isPrinting: boolean;
  shortcutMap?: Record<string, string[]>;
  onSetShortcut?: (printerName: string, keys?: string[]) => void;
  onSave: (nextPreferences: PrinterPreferencesV1) => void;
  onClose: () => void;
}

interface SortablePrinterItemProps {
  printer: SystemPrinter;
  index: number;
  isCurrent: boolean;
  canHide: boolean;
  shortcutKeys?: string[];
  shortcutMap?: Record<string, string[]>;
  onSetShortcut?: (keys?: string[]) => void;
  onHide: (name: string) => void;
  onKeyboardMove: (name: string, direction: 'up' | 'down') => void;
}

function SortablePrinterItem({
  printer,
  index,
  isCurrent,
  canHide,
  shortcutKeys,
  shortcutMap,
  onSetShortcut,
  onHide,
  onKeyboardMove,
}: SortablePrinterItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: printer.name });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : undefined,
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!e.altKey) return;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      onKeyboardMove(printer.name, 'up');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      onKeyboardMove(printer.name, 'down');
    }
  };

  const isReady = printer.state === 'ready';
  const isOffline = printer.state === 'offline';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`printer-manager-item${isCurrent ? ' is-current' : ''}${
        isDragging ? ' is-dragging' : ''
      }`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="printer-item-drag-handle" {...attributes} {...listeners} title="拖动调整顺序（支持 Alt+↑/↓）">
        <GripVertical size={15} />
      </div>

      <div className="printer-item-index">
        <span className="printer-index-number">{index + 1}</span>
      </div>

      <div className="printer-item-main">
        <div className="printer-item-title-row">
          <span className="printer-item-name" title={printer.name}>
            {printer.name}
          </span>
          <div className="printer-item-tags">
            {printer.isDefault && (
              <Tag color="blue" className="printer-tag-default">
                Windows 默认
              </Tag>
            )}
            {isCurrent && (
              <Tag color="purple" className="printer-tag-current">
                当前使用
              </Tag>
            )}
            {isReady ? (
              <Tag color="success">在线</Tag>
            ) : isOffline ? (
              <Tag color="default">离线</Tag>
            ) : (
              <Tag color="error">状态异常</Tag>
            )}
          </div>
        </div>
        {printer.portName ? (
          <div className="printer-item-meta">端口：{printer.portName}</div>
        ) : null}
      </div>

      <div className="printer-item-actions">
        {onSetShortcut && (
          <ShortcutBindingButton
            id={`printer:${printer.name}`}
            label={printer.name}
            keys={shortcutKeys}
            customShortcuts={shortcutMap}
            onChange={onSetShortcut}
          />
        )}
        <Tooltip title={canHide ? '从本软件选择列表中隐藏' : '至少保留一台可见打印机'}>
          <Button
            type="text"
            size="small"
            icon={<EyeOff size={14} />}
            disabled={!canHide}
            onClick={() => onHide(printer.name)}
            aria-label={`隐藏打印机 ${printer.name}`}
            className="printer-action-hide-btn"
          />
        </Tooltip>
      </div>
    </div>
  );
}

export function PrinterManagerModal({
  open,
  systemPrinters,
  preferences,
  currentPrinterName,
  isPrinting,
  shortcutMap,
  onSetShortcut,
  onSave,
  onClose,
}: PrinterManagerModalProps) {
  const [draftOrderedNames, setDraftOrderedNames] = useState<string[]>([]);
  const [draftHiddenNames, setDraftHiddenNames] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [hiddenSectionOpen, setHiddenSectionOpen] = useState(false);

  // Initialize draft when opened
  useEffect(() => {
    if (open) {
      const decorated = applyPrinterPreferences(systemPrinters, preferences);
      setDraftOrderedNames(decorated.map((p) => p.name));
      setDraftHiddenNames([...preferences.hiddenNames]);
      setSearchQuery('');
    }
  }, [open, systemPrinters, preferences]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
  );

  const printerMap = useMemo(() => {
    const map = new Map<string, SystemPrinter>();
    for (const p of systemPrinters) {
      map.set(p.name, p);
    }
    return map;
  }, [systemPrinters]);

  // Derived visible and hidden printers in draft order
  const { visiblePrinters, hiddenPrinters } = useMemo(() => {
    const hiddenSet = new Set(draftHiddenNames);
    const visible: SystemPrinter[] = [];
    const hidden: SystemPrinter[] = [];

    for (const name of draftOrderedNames) {
      const printer = printerMap.get(name);
      if (!printer) continue;
      if (hiddenSet.has(name)) {
        hidden.push(printer);
      } else {
        visible.push(printer);
      }
    }

    return { visiblePrinters: visible, hiddenPrinters: hidden };
  }, [draftOrderedNames, draftHiddenNames, printerMap]);

  // Filtered by search query
  const query = searchQuery.trim().toLowerCase();
  const filteredVisiblePrinters = useMemo(() => {
    if (!query) return visiblePrinters;
    return visiblePrinters.filter((p) => p.name.toLowerCase().includes(query));
  }, [visiblePrinters, query]);

  const filteredHiddenPrinters = useMemo(() => {
    if (!query) return hiddenPrinters;
    return hiddenPrinters.filter((p) => p.name.toLowerCase().includes(query));
  }, [hiddenPrinters, query]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = visiblePrinters.findIndex((p) => p.name === active.id);
    const newIndex = visiblePrinters.findIndex((p) => p.name === over.id);

    if (oldIndex !== -1 && newIndex !== -1) {
      const reorderedVisible = arrayMove(visiblePrinters, oldIndex, newIndex);
      // Rebuild draftOrderedNames: visible printers in new order + hidden printers
      const newVisibleNames = reorderedVisible.map((p) => p.name);
      const hiddenNamesList = hiddenPrinters.map((p) => p.name);
      setDraftOrderedNames([...newVisibleNames, ...hiddenNamesList]);
    }
  };

  const handleKeyboardMove = (name: string, direction: 'up' | 'down') => {
    const currentIndex = visiblePrinters.findIndex((p) => p.name === name);
    if (currentIndex === -1) return;

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= visiblePrinters.length) return;

    const reorderedVisible = arrayMove(visiblePrinters, currentIndex, targetIndex);
    const newVisibleNames = reorderedVisible.map((p) => p.name);
    const hiddenNamesList = hiddenPrinters.map((p) => p.name);
    setDraftOrderedNames([...newVisibleNames, ...hiddenNamesList]);
  };

  const handleHide = (name: string) => {
    if (visiblePrinters.length <= 1) {
      message.warning('至少保留一台可见打印机');
      return;
    }
    setDraftHiddenNames((prev) => Array.from(new Set([...prev, name])));
  };

  const handleRestore = (name: string) => {
    setDraftHiddenNames((prev) => prev.filter((n) => n !== name));
  };

  const handleRestoreAll = () => {
    setDraftHiddenNames([]);
    message.success('已全部恢复显示');
  };

  const handleHideOffline = () => {
    const offlinePrinters = visiblePrinters.filter((p) => p.state === 'offline' || p.state === 'error');
    if (offlinePrinters.length === 0) {
      message.info('当前没有需要隐藏的离线打印机');
      return;
    }
    // If all visible printers are offline, keep the first one visible
    const namesToHide = offlinePrinters.map((p) => p.name);
    if (namesToHide.length >= visiblePrinters.length) {
      namesToHide.shift(); // Keep at least one
    }
    if (namesToHide.length === 0) {
      message.warning('所有打印机均处于离线状态，已保留至少一台可见打印机');
      return;
    }
    setDraftHiddenNames((prev) => Array.from(new Set([...prev, ...namesToHide])));
    message.success(`已隐藏 ${namesToHide.length} 台离线打印机`);
  };

  const handleResetToSystemDefault = () => {
    // Reorder: Windows default first, then system enumeration order
    const defaultPrinter = systemPrinters.find((p) => p.isDefault);
    const others = systemPrinters.filter((p) => !p.isDefault);
    const defaultOrder = defaultPrinter ? [defaultPrinter, ...others] : [...systemPrinters];
    setDraftOrderedNames(defaultOrder.map((p) => p.name));
    message.success('已恢复系统默认排列顺序（已保留隐藏设置）');
  };

  const handleSave = () => {
    if (isPrinting) {
      message.warning('打印进行中，暂不可修改打印机列表');
      return;
    }
    if (visiblePrinters.length === 0) {
      message.error('至少需要保留一台可见打印机');
      return;
    }
    onSave({
      version: 1,
      orderedNames: draftOrderedNames,
      hiddenNames: draftHiddenNames,
    });
    message.success('打印机管理设置已保存');
    onClose();
  };

  return (
    <Modal
      title="打印机管理"
      open={open}
      onCancel={onClose}
      width={680}
      centered
      maskClosable={false}
      className="printer-manager-modal"
      footer={
        <div className="printer-manager-footer">
          <span className="printer-manager-footer-tip">
            排序与隐藏仅对本软件生效，不影响 Windows 系统设置
          </span>
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Tooltip title={isPrinting ? '打印进行中，暂不可修改打印机列表' : undefined}>
              <Button
                type="primary"
                onClick={handleSave}
                disabled={isPrinting || visiblePrinters.length === 0}
              >
                保存
              </Button>
            </Tooltip>
          </Space>
        </div>
      }
    >
      <div className="printer-manager-body" onContextMenu={(event) => event.preventDefault()}>
        {/* Search & batch actions */}
        <div className="printer-manager-toolbar">
          <Input
            placeholder="搜索打印机名称..."
            prefix={<Search size={14} style={{ color: 'var(--color-text-muted)' }} />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            allowClear
            className="printer-search-input"
          />
          <Space size={8}>
            <Tooltip title="一键将所有离线状态的打印机移至隐藏列表">
              <Button
                size="small"
                icon={<EyeOff size={13} />}
                onClick={handleHideOffline}
                disabled={visiblePrinters.length <= 1}
              >
                隐藏离线打印机
              </Button>
            </Tooltip>
            <Tooltip title="恢复 Windows 默认打印机置顶及系统默认排列，不影响隐藏项">
              <Button
                size="small"
                icon={<RotateCcw size={13} />}
                onClick={handleResetToSystemDefault}
              >
                恢复默认顺序
              </Button>
            </Tooltip>
          </Space>
        </div>

        {/* Section 1: Visible Printers */}
        <div className="printer-manager-section">
          <div className="printer-section-header">
            <Typography.Text strong>
              显示的打印机（{visiblePrinters.length}）
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              拖动手柄调整显示顺序
            </Typography.Text>
          </div>

          {filteredVisiblePrinters.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={searchQuery ? '未找到匹配的可见打印机' : '暂无可见打印机'}
            />
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={filteredVisiblePrinters.map((p) => p.name)}
                strategy={verticalListSortingStrategy}
              >
                <div className="printer-manager-list">
                  {filteredVisiblePrinters.map((printer, idx) => (
                    <SortablePrinterItem
                      key={printer.name}
                      printer={printer}
                      index={idx}
                      isCurrent={printer.name === currentPrinterName}
                      canHide={visiblePrinters.length > 1}
                      shortcutKeys={shortcutMap?.[`printer:${printer.name}`]}
                      shortcutMap={shortcutMap}
                      onSetShortcut={
                        onSetShortcut
                          ? (keys) => onSetShortcut(printer.name, keys)
                          : undefined
                      }
                      onHide={handleHide}
                      onKeyboardMove={handleKeyboardMove}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        {/* Section 2: Hidden Printers */}
        {hiddenPrinters.length > 0 && (
          <div className="printer-manager-section printer-hidden-section">
            <div
              className="printer-section-header printer-hidden-header"
              onClick={() => setHiddenSectionOpen((prev) => !prev)}
              role="button"
              tabIndex={0}
            >
              <Space size={6} align="center">
                {hiddenSectionOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <Typography.Text strong>
                  已隐藏的打印机（{hiddenPrinters.length}）
                </Typography.Text>
              </Space>
              <Button
                type="link"
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRestoreAll();
                }}
              >
                全部恢复显示
              </Button>
            </div>

            {hiddenSectionOpen && (
              <div className="printer-manager-list printer-hidden-list">
                {filteredHiddenPrinters.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="未找到匹配的隐藏打印机"
                  />
                ) : (
                  filteredHiddenPrinters.map((printer) => (
                    <div key={printer.name} className="printer-manager-item is-hidden-item">
                      <div className="printer-item-main">
                        <div className="printer-item-title-row">
                          <span className="printer-item-name" title={printer.name}>
                            {printer.name}
                          </span>
                          <div className="printer-item-tags">
                            {printer.isDefault && (
                              <Tag color="blue" className="printer-tag-default">
                                Windows 默认
                              </Tag>
                            )}
                            {printer.name === currentPrinterName && (
                              <Tag color="purple" className="printer-tag-current">
                                当前使用
                              </Tag>
                            )}
                            {printer.state === 'ready' ? (
                              <Tag color="success">在线</Tag>
                            ) : (
                              <Tag color="default">离线</Tag>
                            )}
                          </div>
                        </div>
                        {printer.portName ? (
                          <div className="printer-item-meta">端口：{printer.portName}</div>
                        ) : null}
                      </div>

                      <div className="printer-item-actions">
                        {onSetShortcut && (
                          <ShortcutBindingButton
                            id={`printer:${printer.name}`}
                            label={printer.name}
                            keys={shortcutMap?.[`printer:${printer.name}`]}
                            customShortcuts={shortcutMap}
                            onChange={(keys) => onSetShortcut(printer.name, keys)}
                          />
                        )}
                        <Button
                          type="text"
                          size="small"
                          icon={<Eye size={14} />}
                          onClick={() => handleRestore(printer.name)}
                          aria-label={`恢复显示打印机 ${printer.name}`}
                          className="printer-action-restore-btn"
                        >
                          恢复显示
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
