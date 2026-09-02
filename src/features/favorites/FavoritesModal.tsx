import {
  Button,
  Dropdown,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  Bookmark,
  BookmarkPlus,
  Copy,
  Download,
  Edit2,
  FileCheck2,
  FileText,
  FolderSync,
  MoreHorizontal,
  Play,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Sliders,
  Terminal,
  Trash2,
  Upload,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getAppExecutablePath } from '../../api/nativeBridge';
import type { SystemPrinter } from '../../shared/contracts/printer';
import { ShortcutBindingButton } from '../shortcuts/ShortcutBindingButton';
import { buildQuickerPrintCommand } from '../external/externalRequestHandler';
import {
  deleteFavorite,
  duplicateFavorite,
  exportFavoritesJson,
  importFavoritesJson,
  loadFavorites,
  recordFavoriteLoaded,
  reorderFavorites,
  restoreFavorite,
  updateFavorite,
} from './favoriteStorage';
import type { FavoriteTemplateV1 } from './favoriteTypes';

export interface FavoritesModalProps {
  open: boolean;
  onClose: () => void;
  onLoadFavorite: (favorite: FavoriteTemplateV1) => void;
  onOpenAddFavorite: () => void;
  isPrinting: boolean;
  systemPrinters: SystemPrinter[];
  customShortcuts: Record<string, string[]>;
  onSetCustomShortcut: (id: string, keys?: string[]) => void;
  onUpdateFavoriteToCurrent?: (favorite: FavoriteTemplateV1) => void;
}

export function FavoritesModal({
  open,
  onClose,
  onLoadFavorite,
  onOpenAddFavorite,
  isPrinting,
  systemPrinters,
  customShortcuts,
  onSetCustomShortcut,
  onUpdateFavoriteToCurrent,
}: FavoritesModalProps) {
  const [favorites, setFavorites] = useState<FavoriteTemplateV1[]>(() => (open ? loadFavorites() : []));
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'ready' | 'warning'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const reload = useCallback(() => {
    setFavorites(loadFavorites());
  }, []);

  useEffect(() => {
    if (open) {
      reload();
      setSearchQuery('');
      setFilterType('all');
      setEditingId(null);
    }
  }, [open, reload]);

  // Modal-level 1-9 shortcuts to load corresponding top favorites
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.getAttribute('contenteditable') === 'true')
      ) {
        return;
      }

      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 9 && num <= favorites.length) {
        const target = favorites[num - 1];
        if (target && !isPrinting) {
          e.preventDefault();
          e.stopPropagation();
          handleLoad(target);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, favorites, isPrinting]);

  const handleLoad = (fav: FavoriteTemplateV1) => {
    if (isPrinting) {
      message.warning('打印进行中，暂不可加载收藏');
      return;
    }
    recordFavoriteLoaded(fav.id);
    onLoadFavorite(fav);
    onClose();
  };

  const handleDuplicate = (id: string) => {
    try {
      const dup = duplicateFavorite(id);
      reload();
      message.success(`已创建副本“${dup.name}”`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '创建副本失败');
    }
  };

  const handleDelete = (fav: FavoriteTemplateV1) => {
    const deleted = deleteFavorite(fav.id);
    if (!deleted) return;
    reload();

    // Clean up shortcut binding if any
    onSetCustomShortcut(`favorite:${fav.id}`, undefined);

    // Show undo toast
    message.info({
      content: (
        <span className="undo-toast-content">
          <span>{`已删除收藏“${fav.name}”`}</span>
          <Button
            type="link"
            size="small"
            className="undo-toast-btn"
            onClick={() => {
              restoreFavorite(deleted);
              reload();
              message.destroy('fav_undo_toast');
              message.success(`已恢复收藏“${fav.name}”`);
            }}
          >
            撤销
          </Button>
        </span>
      ),
      key: 'fav_undo_toast',
      duration: 5,
    });
  };

  const handleStartRename = (fav: FavoriteTemplateV1) => {
    setEditingId(fav.id);
    setEditingName(fav.name);
  };

  const handleSaveRename = (id: string) => {
    const trimmed = editingName.trim();
    if (!trimmed) {
      message.error('收藏名称不能为空');
      return;
    }
    try {
      updateFavorite(id, { name: trimmed });
      reload();
      setEditingId(null);
      message.success('重命名成功');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '重命名失败');
    }
  };

  const handleExport = () => {
    try {
      const json = exportFavoritesJson();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `PrintAssist_Favorites_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      message.success('收藏备份已导出');
    } catch (err) {
      message.error('导出收藏失败');
    }
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const res = importFavoritesJson(text);
        reload();
        message.success(
          `导入完成：已导入 ${res.importedCount} 个收藏${res.skippedCount > 0 ? `，跳过 ${res.skippedCount} 个损坏项` : ''}`,
        );
      } catch (err) {
        message.error(err instanceof Error ? err.message : '导入失败');
      }
    };
    input.click();
  };

  // Check printer status
  const getPrinterStatus = (fav: FavoriteTemplateV1): { name: string; status: 'online' | 'offline' | 'missing' } => {
    if (!fav.printer?.name) {
      return { name: '不指定打印机', status: 'online' };
    }
    const found = systemPrinters.find((p) => p.name === fav.printer!.name);
    if (!found) {
      return { name: fav.printer.name, status: 'missing' };
    }
    if (found.statusCode !== 0) {
      return { name: found.name, status: 'offline' };
    }
    return { name: found.name, status: 'online' };
  };

  const filteredFavorites = useMemo(() => {
    return favorites.filter((fav) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const nameMatch = fav.name.toLowerCase().includes(q);
        const printerMatch = fav.printer?.name.toLowerCase().includes(q);
        const fileMatch = fav.task?.items.some((i) => i.fileName.toLowerCase().includes(q));
        if (!nameMatch && !printerMatch && !fileMatch) return false;
      }

      // Filter status
      if (filterType === 'ready') {
        const pStatus = getPrinterStatus(fav);
        if (pStatus.status === 'missing') return false;
      } else if (filterType === 'warning') {
        const pStatus = getPrinterStatus(fav);
        if (pStatus.status !== 'missing' && pStatus.status !== 'offline') return false;
      }

      return true;
    });
  }, [favorites, searchQuery, filterType, systemPrinters]);

  const columns: ColumnsType<FavoriteTemplateV1> = [
    {
      title: '序号',
      key: 'index',
      width: 54,
      align: 'center',
      render: (_, record, index) => {
        const globalIndex = favorites.findIndex((f) => f.id === record.id);
        return globalIndex < 9 ? (
          <kbd className="profile-shortcut-badge" title={`按数字键 ${globalIndex + 1} 直接加载`}>
            {globalIndex + 1}
          </kbd>
        ) : (
          <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{globalIndex + 1}</span>
        );
      },
    },
    {
      title: '收藏名称',
      dataIndex: 'name',
      key: 'name',
      render: (_, fav) => {
        if (editingId === fav.id) {
          return (
            <Space size={4} style={{ width: '100%' }}>
              <Input
                size="small"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onPressEnter={() => handleSaveRename(fav.id)}
                autoFocus
              />
              <Button size="small" type="primary" onClick={() => handleSaveRename(fav.id)}>
                保存
              </Button>
              <Button size="small" onClick={() => setEditingId(null)}>
                取消
              </Button>
            </Space>
          );
        }
        return (
          <div className="favorite-table-name-cell">
            <span className="favorite-table-name-text" title={fav.name}>
              {fav.name}
            </span>
            {fav.source === 'history-migration' && (
              <Tag style={{ fontSize: 10, lineHeight: '16px' }}>历史转存</Tag>
            )}
          </div>
        );
      },
    },
    {
      title: '待打印任务',
      key: 'task',
      width: 120,
      render: (_, fav) => {
        if (!fav.task || fav.task.items.length === 0) {
          return <Tag color="default">仅打印机与配置</Tag>;
        }
        return (
          <Tooltip title={fav.task.items.map((i) => i.fileName).join('\n')}>
            <span style={{ fontSize: 12 }}>
              <FileText size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
              {fav.task.items.length} 个文件
            </span>
          </Tooltip>
        );
      },
    },
    {
      title: '目标打印机',
      key: 'printer',
      width: 140,
      render: (_, fav) => {
        const pStatus = getPrinterStatus(fav);
        if (pStatus.status === 'missing') {
          return (
            <Tooltip title={`打印机“${pStatus.name}”未安装，加载时将保留当前打印机`}>
              <Tag color="error">{pStatus.name} (缺失)</Tag>
            </Tooltip>
          );
        }
        if (pStatus.status === 'offline') {
          return (
            <Tooltip title={`打印机“${pStatus.name}”当前离线`}>
              <Tag color="warning">{pStatus.name}</Tag>
            </Tooltip>
          );
        }
        return (
          <span style={{ fontSize: 12 }} title={pStatus.name}>
            <Printer size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
            {pStatus.name}
          </span>
        );
      },
    },
    {
      title: '配置',
      key: 'config',
      width: 120,
      render: (_, fav) => {
        if (!fav.printConfig) {
          return <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>-</span>;
        }
        if (fav.printConfig.persistentProfileName) {
          return <Tag color="blue">{fav.printConfig.persistentProfileName}</Tag>;
        }
        return <Tag>标准快照</Tag>;
      },
    },
    {
      title: '快捷键',
      key: 'shortcut',
      width: 80,
      align: 'center',
      render: (_, fav) => {
        const shortcutKey = `favorite:${fav.id}`;
        return (
          <ShortcutBindingButton
            label={fav.name}
            id={shortcutKey}
            keys={customShortcuts[shortcutKey]}
            customShortcuts={customShortcuts}
            onChange={(keys) => onSetCustomShortcut(shortcutKey, keys)}
          />
        );
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 130,
      align: 'right',
      render: (_, fav) => {
        const menuItems = [
          {
            key: 'rename',
            label: '重命名',
            icon: <Edit2 size={14} />,
            onClick: () => handleStartRename(fav),
          },
          {
            key: 'duplicate',
            label: '创建副本',
            icon: <Copy size={14} />,
            onClick: () => handleDuplicate(fav.id),
          },
          {
            key: 'copy_quicker_cmd',
            label: '复制 Quicker 打印命令',
            icon: <Terminal size={14} />,
            onClick: async () => {
              try {
                const exePath = await getAppExecutablePath();
                const cmd = buildQuickerPrintCommand(exePath, fav.id, {
                  duplicatePolicy: 'skip',
                  busyPolicy: 'reject',
                });
                await navigator.clipboard.writeText(cmd);
                message.success(`已复制收藏“${fav.name}”的 Quicker 直接打印命令`);
              } catch {
                message.error('复制命令失败');
              }
            },
          },
          ...(onUpdateFavoriteToCurrent
            ? [
                {
                  key: 'update_current',
                  label: '更新为当前工作区状态',
                  icon: <FolderSync size={14} />,
                  onClick: () => onUpdateFavoriteToCurrent(fav),
                },
              ]
            : []),
          { type: 'divider' as const },
          {
            key: 'delete',
            label: '删除收藏',
            icon: <Trash2 size={14} />,
            danger: true,
            onClick: () => handleDelete(fav),
          },
        ];

        return (
          <Space size={4}>
            <button
              type="button"
              className="ant-btn ant-btn-primary ant-btn-sm"
              disabled={isPrinting}
              onClick={() => handleLoad(fav)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <Play size={12} />
              <span>加载</span>
            </button>
            <Dropdown menu={{ items: menuItems }} trigger={['click']}>
              <Button size="small" type="text" icon={<MoreHorizontal size={14} />} aria-label="更多操作" />
            </Dropdown>
          </Space>
        );
      },
    },
  ];

  return (
    <Modal
      title={
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingRight: 40,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Bookmark size={18} color="var(--color-primary, #1557d0)" />
            <span>收藏中心</span>
          </div>
          <Space size={8}>
            <Button size="small" icon={<Plus size={13} />} type="primary" onClick={onOpenAddFavorite}>
              新建收藏
            </Button>
            <Button size="small" icon={<Download size={13} />} onClick={handleExport}>
              导出备份
            </Button>
            <Button size="small" icon={<Upload size={13} />} onClick={handleImport}>
              导入
            </Button>
          </Space>
        </div>
      }
      open={open}
      onCancel={onClose}
      width={880}
      centered
      destroyOnHidden
      footer={null}
      className="favorites-modal"
    >
      <div className="favorites-modal-body">
        {favorites.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无收藏模板。您可以将常用的文件列表、打印机和打印配置一键保存为模板。"
            style={{ marginTop: 48, marginBottom: 48 }}
          >
            <Button type="primary" icon={<Plus size={14} />} onClick={onOpenAddFavorite}>
              创建第一个收藏
            </Button>
          </Empty>
        ) : (
          <>
            <div className="favorites-toolbar">
              <div className="favorites-toolbar-left">
                <Input
                  className="favorites-search-input"
                  prefix={<Search size={14} style={{ color: 'var(--color-text-muted)' }} />}
                  placeholder="搜索收藏名称、打印机或文件名..."
                  allowClear
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <Segmented
                  value={filterType}
                  onChange={(val) => setFilterType(val as any)}
                  options={[
                    { label: '全部', value: 'all' },
                    { label: '可直接加载', value: 'ready' },
                    { label: '异常/缺失', value: 'warning' },
                  ]}
                />
              </div>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                共 {favorites.length} 个收藏（支持按数字键 1~9 直接加载）
              </span>
            </div>

            <div className="favorites-table-wrapper">
              <Table<FavoriteTemplateV1>
                className="favorites-table"
                rowKey="id"
                columns={columns}
                dataSource={filteredFavorites}
                size="middle"
                scroll={{ y: '52vh' }}
                pagination={false}
              />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
