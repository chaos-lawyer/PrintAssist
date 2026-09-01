import React, { useState, useEffect } from 'react';
import { Modal, Switch, Button, Typography, Space, Tag } from 'antd';
import { RotateCcw, Keyboard } from 'lucide-react';
import type { SavedPrinterProfileSummary, SystemPrinter } from '../../shared/contracts/printer';
import type { VisibleSortableColumn } from '../queue/queueColumns';
import {
  SHORTCUT_CATEGORIES,
  SHORTCUT_DEFINITIONS,
  ShortcutCategory,
  getSingleKeyShortcutsEnabled,
  setSingleKeyShortcutsEnabled,
} from './shortcutRegistry';

interface ShortcutHelpModalProps {
  open: boolean;
  onClose: () => void;
  savedProfiles?: SavedPrinterProfileSummary[];
  activeProfileId?: string;
  printerName?: string;
  visiblePrinters?: SystemPrinter[];
  sortableColumns?: VisibleSortableColumn[];
}

export function ShortcutHelpModal({
  open,
  onClose,
  savedProfiles = [],
  activeProfileId,
  printerName,
  visiblePrinters = [],
  sortableColumns,
}: ShortcutHelpModalProps) {
  const [singleKeyEnabled, setSingleKeyEnabledState] = useState(
    getSingleKeyShortcutsEnabled,
  );

  useEffect(() => {
    if (open) {
      setSingleKeyEnabledState(getSingleKeyShortcutsEnabled());
    }
  }, [open]);

  const handleToggleSingleKey = (checked: boolean) => {
    setSingleKeyEnabledState(checked);
    setSingleKeyShortcutsEnabled(checked);
  };

  const handleResetDefaults = () => {
    setSingleKeyEnabledState(true);
    setSingleKeyShortcutsEnabled(true);
  };

  // Group shortcuts
  const groupedCategories: {
    category: ShortcutCategory;
    label: string;
    items: typeof SHORTCUT_DEFINITIONS;
  }[] = (
    Object.entries(SHORTCUT_CATEGORIES) as [
      ShortcutCategory,
      { label: string; order: number },
    ][]
  )
    .sort((a, b) => a[1].order - b[1].order)
    .map(([category, { label }]) => ({
      category,
      label,
      items: SHORTCUT_DEFINITIONS.filter((item) => item.category === category),
    }));

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <div className="shortcut-modal-title">
          <Keyboard size={18} className="shortcut-modal-title-icon" />
          <span>快捷键</span>
        </div>
      }
      width={680}
      className="shortcut-help-modal"
      footer={
        <div className="shortcut-modal-footer">
          <Button
            type="text"
            icon={<RotateCcw size={14} />}
            onClick={handleResetDefaults}
            className="shortcut-modal-reset-btn"
          >
            恢复默认设置
          </Button>
          <Button type="primary" onClick={onClose}>
            关闭
          </Button>
        </div>
      }
    >
      <div className="shortcut-toggle-banner">
        <div className="shortcut-toggle-left">
          <div className="shortcut-toggle-title">启用单键快捷键</div>
          <div className="shortcut-toggle-desc">
            无需按下 Ctrl/Alt，单键即可快速操作。输入文本、打开弹窗或下拉菜单时会自动安全停用。
          </div>
        </div>
        <Switch
          checked={singleKeyEnabled}
          onChange={handleToggleSingleKey}
          checkedChildren="开启"
          unCheckedChildren="关闭"
        />
      </div>

      <div className="shortcut-groups-wrap">
        {groupedCategories.map(({ category, label, items }) => (
          <div key={category} className="shortcut-group-section">
            <Typography.Title level={5} className="shortcut-group-heading">
              {label}
            </Typography.Title>
            <div className="shortcut-group-table">
              {items.map((item) => {
                if (
                  item.id === 'sort_by_column' &&
                  sortableColumns &&
                  sortableColumns.length > 0
                ) {
                  return sortableColumns.map((col) => (
                    <div key={`sort_col_${col.shortcutNumber}`} className="shortcut-row">
                      <div className="shortcut-row-left">
                        <span className="shortcut-name">按{col.label}排序</span>
                        <span className="shortcut-desc">
                          按当前第 {col.shortcutNumber} 列（{col.label}）排序，按一下正序，再按一下逆序
                        </span>
                      </div>
                      <div className="shortcut-row-right">
                        <Space size={4}>
                          <kbd className="shortcut-kbd">Ctrl</kbd>
                          <span className="shortcut-key-plus">+</span>
                          <kbd className="shortcut-kbd">{col.shortcutNumber}</kbd>
                        </Space>
                      </div>
                    </div>
                  ));
                }
                return (
                  <div key={item.id} className="shortcut-row">
                    <div className="shortcut-row-left">
                      <span className="shortcut-name">{item.name}</span>
                      {item.description && (
                        <span className="shortcut-desc">{item.description}</span>
                      )}
                    </div>
                    <div className="shortcut-row-right">
                      <Space size={4}>
                        {item.keys.map((k, idx) => (
                          <React.Fragment key={idx}>
                            {idx > 0 &&
                              item.keys.length > 1 &&
                              !k.startsWith('~') &&
                              !item.keys[idx - 1].endsWith('/') && (
                                <span className="shortcut-key-plus">+</span>
                              )}
                            <kbd className="shortcut-kbd">{k}</kbd>
                          </React.Fragment>
                        ))}
                      </Space>
                    </div>
                  </div>
                );
              })}

              {/* 针对“设置与配置”中的 1-9 数字快捷键，展开显示当前打印机可用的配置项 */}
              {category === 'settings_config' && (
                <div className="shortcut-profiles-preview">
                  <div className="shortcut-profiles-preview-title">
                    当前打印机（{printerName || '未指定'}）可用数字配置映射：
                  </div>
                  {savedProfiles.length === 0 ? (
                    <div className="shortcut-profiles-empty">
                      暂无已保存的打印机配置（在右侧打印设置中保存配置后，按 1–9 即可直接切换）
                    </div>
                  ) : (
                    <div className="shortcut-profiles-grid">
                      {savedProfiles.slice(0, 9).map((p, idx) => {
                        const isCurrent = p.id === activeProfileId;
                        const isCompat = p.compatibility === 'compatible';
                        return (
                          <div
                            key={p.id}
                            className={`shortcut-profile-tag${
                              isCurrent ? ' is-active' : ''
                            }${!isCompat ? ' is-incompatible' : ''}`}
                            title={
                              isCompat
                                ? isCurrent
                                  ? '当前已应用'
                                  : `按数字键 ${idx + 1} 快速应用`
                                : '与当前打印机不兼容'
                            }
                          >
                            <kbd className="profile-shortcut-badge">{idx + 1}</kbd>
                            <span className="shortcut-profile-name">{p.name}</span>
                            {isCurrent && (
                              <Tag color="blue" bordered={false} style={{ margin: 0, fontSize: 10 }}>
                                当前
                              </Tag>
                            )}
                            {!isCompat && (
                              <Tag color="warning" bordered={false} style={{ margin: 0, fontSize: 10 }}>
                                不兼容
                              </Tag>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* 针对“设置与配置”中的 Shift+1~9 快捷键，展示当前可见打印机映射 */}
              {category === 'settings_config' && visiblePrinters.length > 0 && (
                <div className="shortcut-profiles-preview" style={{ marginTop: 10 }}>
                  <div className="shortcut-profiles-preview-title">
                    当前可见打印机数字映射（顺序可在右侧“打印机-管理”中拖动调整）：
                  </div>
                  <div className="shortcut-profiles-grid">
                    {visiblePrinters.slice(0, 9).map((p, idx) => {
                      const isCurrent = p.name === printerName;
                      return (
                        <div
                          key={p.name}
                          className={`shortcut-profile-tag${isCurrent ? ' is-active' : ''}`}
                          title={`按 Shift+${idx + 1} 快速切换至“${p.name}”`}
                        >
                          <kbd className="profile-shortcut-badge">Shift+{idx + 1}</kbd>
                          <span className="shortcut-profile-name">{p.name}</span>
                          {isCurrent && (
                            <Tag color="blue" bordered={false} style={{ margin: 0, fontSize: 10 }}>
                              当前
                            </Tag>
                          )}
                          {p.isDefault && (
                            <Tag color="default" bordered={false} style={{ margin: 0, fontSize: 10 }}>
                              默认
                            </Tag>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
