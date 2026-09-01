import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Modal, Button, Typography, Space, Tag, message } from 'antd';
import { RotateCcw, Keyboard, Edit3, Check } from 'lucide-react';
import type { SavedPrinterProfileSummary, SystemPrinter } from '../../shared/contracts/printer';
import type { VisibleSortableColumn } from '../queue/queueColumns';
import {
  SHORTCUT_DEFINITIONS,
  ShortcutDefinition,
  loadCustomShortcuts,
  saveCustomShortcuts,
  resetCustomShortcuts,
  getEffectiveShortcuts,
} from './shortcutRegistry';

interface ShortcutHelpModalProps {
  open: boolean;
  onClose: () => void;
  /** 保留以兼容历史调用；映射预览已不再展示。 */
  savedProfiles?: SavedPrinterProfileSummary[];
  activeProfileId?: string;
  printerName?: string;
  visiblePrinters?: SystemPrinter[];
  sortableColumns?: VisibleSortableColumn[];
  customShortcuts?: Record<string, string[]>;
  onCustomShortcutsChange?: (custom: Record<string, string[]>) => void;
}

function formatKeyFromEvent(event: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) {
    return null;
  }
  if (event.code === 'Minus' || event.code === 'NumpadSubtract' || event.key === '-') return '-';
  if (event.code === 'Equal' || event.code === 'NumpadAdd' || event.key === '=') return '=';
  if (event.code === 'BracketLeft' || event.key === '[') return '[';
  if (event.code === 'BracketRight' || event.key === ']') return ']';
  if (event.code === 'Comma' || event.key === ',') return ',';
  if (event.code === 'Period' || event.key === '.') return '.';
  if (event.code === 'Slash' || event.key === '/') return '/';
  if (event.code === 'Backquote' || event.key === '`') return '`';
  if (event.key === 'ArrowUp') return '↑';
  if (event.key === 'ArrowDown') return '↓';
  if (event.key === 'ArrowLeft') return '←';
  if (event.key === 'ArrowRight') return '→';
  if (event.key === ' ') return 'Space';
  if (event.key === 'Enter') return 'Enter';
  if (event.key === 'Delete') return 'Delete';
  if (event.key === 'Backspace') return 'Backspace';
  if (event.key === 'Tab') return 'Tab';
  if (event.key === 'Home') return 'Home';
  if (event.key === 'End') return 'End';
  if (event.key === 'PageUp') return 'PageUp';
  if (event.key === 'PageDown') return 'PageDown';
  if (event.key.length === 1) return event.key.toUpperCase();
  return event.key;
}

export function ShortcutHelpModal({
  open,
  onClose,
  sortableColumns,
  customShortcuts: externalCustomShortcuts,
  onCustomShortcutsChange,
}: ShortcutHelpModalProps) {
  const [internalCustom, setInternalCustom] = useState<Record<string, string[]>>(loadCustomShortcuts);
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [recordingId, setRecordingId] = useState<string | null>(null);

  const customMap = externalCustomShortcuts ?? internalCustom;

  useEffect(() => {
    if (open) {
      setInternalCustom(loadCustomShortcuts());
      setIsCustomizing(false);
      setRecordingId(null);
    }
  }, [open]);

  const effectiveShortcuts = useMemo(
    () => getEffectiveShortcuts(customMap),
    [customMap],
  );

  const handleResetDefaults = () => {
    resetCustomShortcuts();
    setInternalCustom({});
    onCustomShortcutsChange?.({});
    setRecordingId(null);
    message.success('已恢复全部默认快捷键');
  };

  const handleUpdateShortcut = useCallback(
    (id: string, newKeys: string[]) => {
      const nextCustom = { ...customMap, [id]: newKeys };
      saveCustomShortcuts(nextCustom);
      setInternalCustom(nextCustom);
      onCustomShortcutsChange?.(nextCustom);
    },
    [customMap, onCustomShortcutsChange],
  );

  const handleResetSingleShortcut = useCallback(
    (id: string) => {
      const nextCustom = { ...customMap };
      delete nextCustom[id];
      saveCustomShortcuts(nextCustom);
      setInternalCustom(nextCustom);
      onCustomShortcutsChange?.(nextCustom);
    },
    [customMap, onCustomShortcutsChange],
  );

  // Keyboard listener during recording mode
  useEffect(() => {
    if (!recordingId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setRecordingId(null);
        return;
      }

      if (e.key === 'Backspace') {
        handleResetSingleShortcut(recordingId);
        const def = SHORTCUT_DEFINITIONS.find((d) => d.id === recordingId);
        message.info(`已恢复“${def?.name}”为默认快捷键`);
        setRecordingId(null);
        return;
      }

      const mainKey = formatKeyFromEvent(e);
      if (!mainKey) {
        return; // pure modifier key pressed, wait for combination
      }

      const keys: string[] = [];
      if (e.ctrlKey || e.metaKey) keys.push('Ctrl');
      if (e.shiftKey) keys.push('Shift');
      if (e.altKey) keys.push('Alt');
      keys.push(mainKey);

      const targetDef = SHORTCUT_DEFINITIONS.find((d) => d.id === recordingId);
      const conflictItem = effectiveShortcuts.find(
        (s) =>
          s.id !== recordingId &&
          s.keys.join('+').toUpperCase() === keys.join('+').toUpperCase(),
      );

      if (conflictItem) {
        message.warning(`该快捷键与“${conflictItem.name}”相同，已重新分配给“${targetDef?.name}”`);
        handleResetSingleShortcut(conflictItem.id);
      } else {
        message.success(`已将“${targetDef?.name}”快捷键设置为 ${keys.join(' + ')}`);
      }

      handleUpdateShortcut(recordingId, keys);
      setRecordingId(null);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [recordingId, effectiveShortcuts, handleResetSingleShortcut, handleUpdateShortcut]);

  // Group into three columns:
  const col1Items = effectiveShortcuts.filter((s) => s.category === 'file_queue');
  const col2Items = effectiveShortcuts.filter((s) => s.category === 'settings_config');
  const col3Items = effectiveShortcuts.filter(
    (s) =>
      s.category === 'print_control' ||
      s.category === 'nav_selection' ||
      s.category === 'help',
  );
  const renderShortcutRow = (item: ShortcutDefinition) => {
    const isCustomizable = item.customizable !== false;
    const isRecording = recordingId === item.id;

    if (item.id === 'sort_by_column' && sortableColumns && sortableColumns.length > 0) {
      return (
        <React.Fragment key={item.id}>
          {sortableColumns.map((col) => (
            <div key={`sort_col_${col.shortcutNumber}`} className="shortcut-compact-row">
              <span className="shortcut-compact-name">按{col.label}排序</span>
              <div className="shortcut-compact-keys">
                <Space size={2}>
                  <kbd className="shortcut-kbd">Ctrl</kbd>
                  <span className="shortcut-key-plus">+</span>
                  <kbd className="shortcut-kbd">{col.shortcutNumber}</kbd>
                </Space>
              </div>
            </div>
          ))}
        </React.Fragment>
      );
    }

    return (
      <div
        key={item.id}
        className={`shortcut-compact-row${isCustomizing && isCustomizable ? ' is-customizable' : ''}${isRecording ? ' is-recording' : ''}`}
        onClick={
          isCustomizing && isCustomizable
            ? () => setRecordingId(item.id)
            : undefined
        }
        title={
          isCustomizing && isCustomizable
            ? isRecording
              ? '请按下新的按键组合（按 Esc 取消，按 Backspace 恢复默认）'
              : '点击录制新快捷键'
            : undefined
        }
      >
        <span className="shortcut-compact-name">{item.name}</span>
        <div className="shortcut-compact-keys">
          {isRecording ? (
            <Tag color="warning" style={{ margin: 0, fontSize: 11 }}>
              按下按键...
            </Tag>
          ) : (
            <Space size={2}>
              {item.keys.map((k, idx) => (
                <React.Fragment key={idx}>
                  {idx > 0 && !k.startsWith('~') && !item.keys[idx - 1].endsWith('/') && (
                    <span className="shortcut-key-plus">+</span>
                  )}
                  <kbd className="shortcut-kbd">{k}</kbd>
                </React.Fragment>
              ))}
            </Space>
          )}
        </div>
      </div>
    );
  };

  return (
    <Modal
      open={open}
      onCancel={() => {
        setRecordingId(null);
        setIsCustomizing(false);
        onClose();
      }}
      title={
        <div className="shortcut-modal-title">
          <Keyboard size={18} className="shortcut-modal-title-icon" />
          <span>快捷键</span>
          {isCustomizing && (
            <Tag color="blue" bordered={false} style={{ marginLeft: 6 }}>
              自定义模式
            </Tag>
          )}
        </div>
      }
      width={780}
      className="shortcut-help-modal"
      footer={
        <div className="shortcut-modal-footer">
          <Space>
            <Button
              type={isCustomizing ? 'primary' : 'default'}
              icon={isCustomizing ? <Check size={14} /> : <Edit3 size={14} />}
              onClick={() => {
                setRecordingId(null);
                setIsCustomizing(!isCustomizing);
              }}
            >
              {isCustomizing ? '完成自定义' : '自定义快捷键'}
            </Button>
            <Button
              type="text"
              icon={<RotateCcw size={14} />}
              onClick={handleResetDefaults}
              className="shortcut-modal-reset-btn"
            >
              恢复默认
            </Button>
          </Space>
          <Button
            type="primary"
            onClick={() => {
              setRecordingId(null);
              setIsCustomizing(false);
              onClose();
            }}
          >
            关闭
          </Button>
        </div>
      }
    >
      {isCustomizing && (
        <div className="shortcut-custom-hint">
          <span>点击任意快捷键项进入按键录制状态，按下新组合键自动保存；按 <b>Backspace</b> 恢复单项默认，按 <b>Esc</b> 取消。</span>
        </div>
      )}

      <div className="shortcut-three-columns">
        {/* 第 1 栏：文件与队列 */}
        <div className="shortcut-column">
          <div className="shortcut-column-card">
            <Typography.Title level={5} className="shortcut-column-title">
              文件与队列
            </Typography.Title>
            <div className="shortcut-compact-list">
              {col1Items.map(renderShortcutRow)}
            </div>
          </div>
        </div>

        {/* 第 2 栏：设置与配置 */}
        <div className="shortcut-column">
          <div className="shortcut-column-card">
            <Typography.Title level={5} className="shortcut-column-title">
              设置与配置
            </Typography.Title>
            <div className="shortcut-compact-list">
              {col2Items.map(renderShortcutRow)}
            </div>
          </div>
        </div>

        {/* 第 3 栏：打印控制、导航选择与帮助 */}
        <div className="shortcut-column">
          <div className="shortcut-column-card">
            <Typography.Title level={5} className="shortcut-column-title">
              打印控制与导航
            </Typography.Title>
            <div className="shortcut-compact-list">
              {col3Items.map(renderShortcutRow)}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
