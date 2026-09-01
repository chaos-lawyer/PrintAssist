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
  Copy,
  Download,
  Edit2,
  GripVertical,
  MoreHorizontal,
  RefreshCw,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
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
import { AppContextMenu, type AppContextMenuItem } from '../../components/AppContextMenu';
import {
  deletePrinterProfile,
  duplicatePrinterProfile,
  exportAllPrinterProfiles,
  exportPrinterProfile,
  importPrinterProfiles,
  loadPrinterProfile,
  pickImportProfileFiles,
  rebuildPrinterProfile,
  renamePrinterProfile,
  reorderPrinterProfiles,
  saveExportProfilePath,
  setDefaultPrinterProfile,
} from '../../api/nativeBridge';
import type {
  LoadedPrinterProfileResult,
  PrinterProfileCompatibility,
  SavedPrinterProfileSummary,
} from '../../shared/contracts/printer';
import { ShortcutBindingButton } from '../shortcuts/ShortcutBindingButton';

export function reorderProfileList(
  profiles: SavedPrinterProfileSummary[],
  sourceIndex: number,
  targetIndex: number,
): SavedPrinterProfileSummary[] {
  if (
    sourceIndex < 0 ||
    sourceIndex >= profiles.length ||
    targetIndex < 0 ||
    targetIndex >= profiles.length ||
    sourceIndex === targetIndex
  ) {
    return profiles;
  }
  const updated = [...profiles];
  const [removed] = updated.splice(sourceIndex, 1);
  updated.splice(targetIndex, 0, removed);
  return updated;
}

interface MenuState {
  profile: SavedPrinterProfileSummary;
  x: number;
  y: number;
}

interface PrinterProfileManagerModalProps {
  open: boolean;
  currentPrinterName: string;
  activeProfileId?: string;
  profiles: SavedPrinterProfileSummary[];
  onClose: () => void;
  onRefreshProfiles: () => Promise<unknown>;
  onApplyProfile: (loaded: LoadedPrinterProfileResult) => void;
  shortcutMap?: Record<string, string[]>;
  onSetShortcut?: (profileId: string, keys?: string[]) => void;
}

interface SortableProfileCardProps {
  profile: SavedPrinterProfileSummary;
  isActive: boolean;
  loadingAction: string | null;
  editingProfileId: string | null;
  editingName: string;
  onApply: (profile: SavedPrinterProfileSummary) => void;
  onToggleDefault: (profile: SavedPrinterProfileSummary) => void;
  onOpenMenu: (profile: SavedPrinterProfileSummary, e: React.MouseEvent<HTMLElement>) => void;
  onRebuild: (profile: SavedPrinterProfileSummary) => void;
  onKeyboardMove: (profile: SavedPrinterProfileSummary, direction: 'up' | 'down' | 'top' | 'bottom') => void;
  onStartInlineRename: (profile: SavedPrinterProfileSummary) => void;
  onChangeEditingName: (name: string) => void;
  onSaveInlineRename: (profileId: string) => void;
  onCancelInlineRename: () => void;
  renderCompatibilityTag: (compatibility: PrinterProfileCompatibility) => React.ReactNode;
  shortcutKeys?: string[];
  onSetShortcut?: (profileId: string, keys?: string[]) => void;
}

function SortableProfileCard({
  profile,
  isActive,
  loadingAction,
  editingProfileId,
  editingName,
  onApply,
  onToggleDefault,
  onOpenMenu,
  onRebuild,
  onKeyboardMove,
  onStartInlineRename,
  onChangeEditingName,
  onSaveInlineRename,
  onCancelInlineRename,
  renderCompatibilityTag,
  shortcutKeys,
  onSetShortcut,
}: SortableProfileCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: profile.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : undefined,
  };

  const isCompatible = profile.compatibility === 'compatible';
  const isDriverChanged = profile.compatibility === 'driverChanged';
  const isEditing = editingProfileId === profile.id;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!e.altKey) return;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      onKeyboardMove(profile, 'up');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      onKeyboardMove(profile, 'down');
    } else if (e.key === 'Home') {
      e.preventDefault();
      onKeyboardMove(profile, 'top');
    } else if (e.key === 'End') {
      e.preventDefault();
      onKeyboardMove(profile, 'bottom');
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`profile-card${isActive ? ' is-active' : ''}${
        !isCompatible ? ' is-incompatible' : ''
      }${isDragging ? ' is-dragging' : ''}`}
      onContextMenu={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest('button, input, a')) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        onOpenMenu(profile, e);
      }}
    >
      <div className="profile-card-header">
        <div className="profile-card-title-row">
          <button
            type="button"
            className="profile-drag-handle"
            title="拖动调整配置顺序（Alt+上下键键盘排序）"
            aria-label={`拖动调整配置“${profile.name}”的顺序`}
            onKeyDown={handleKeyDown}
            {...attributes}
            {...listeners}
          >
            <GripVertical size={14} />
          </button>

          {isEditing ? (
            <div className="profile-card-inline-rename" onClick={(e) => e.stopPropagation()}>
              <Input
                size="small"
                value={editingName}
                maxLength={60}
                autoFocus
                onChange={(e) => onChangeEditingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onSaveInlineRename(profile.id);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    onCancelInlineRename();
                  }
                }}
                style={{ width: 170 }}
              />
              <Button
                size="small"
                type="primary"
                loading={loadingAction === 'name-action'}
                onClick={() => onSaveInlineRename(profile.id)}
              >
                保存
              </Button>
              <Button size="small" onClick={onCancelInlineRename}>
                取消
              </Button>
            </div>
          ) : (
            <>
              <span
                className="profile-card-name"
                onDoubleClick={() => onStartInlineRename(profile)}
                title="双击可快速重命名"
              >
                {profile.name}
              </span>
              {profile.isDefault && <Tag color="gold">默认</Tag>}
              {isActive && <Tag color="processing">正在使用</Tag>}
              {renderCompatibilityTag(profile.compatibility)}
            </>
          )}
        </div>
      <div className="profile-card-actions">
        {onSetShortcut && (
          <ShortcutBindingButton
            label={profile.name}
            keys={shortcutKeys}
            onChange={(keys) => onSetShortcut(profile.id, keys)}
          />
        )}
          <Button
            size="small"
            type={isActive ? 'default' : 'primary'}
            disabled={!isCompatible || Boolean(loadingAction)}
            loading={loadingAction === `apply-${profile.id}`}
            onClick={() => onApply(profile)}
          >
            {isActive ? '已应用' : '应用'}
          </Button>

          <Button
            size="small"
            icon={<Star size={13} fill={profile.isDefault ? '#faad14' : 'none'} />}
            disabled={Boolean(loadingAction)}
            loading={loadingAction === `default-${profile.id}`}
            onClick={() => onToggleDefault(profile)}
            title={profile.isDefault ? '取消默认' : '设为默认'}
          />

          <Button
            size="small"
            icon={<MoreHorizontal size={13} />}
            disabled={Boolean(loadingAction)}
            title="更多操作"
            onClick={(e) => onOpenMenu(profile, e)}
          />
        </div>
      </div>

      <div className="profile-card-summary">{profile.summary}</div>

      {isDriverChanged && (
        <div className="profile-card-warning-box">
          <span>驱动已更新，旧私有数据不可用。</span>
          <Button
            size="small"
            type="link"
            icon={<RefreshCw size={12} />}
            loading={loadingAction === `rebuild-${profile.id}`}
            onClick={() => onRebuild(profile)}
          >
            按标准字段重建
          </Button>
        </div>
      )}

      {profile.note && <div className="profile-card-note">备注：{profile.note}</div>}
    </div>
  );
}

export function PrinterProfileManagerModal({
  open,
  currentPrinterName,
  activeProfileId,
  profiles,
  onClose,
  onRefreshProfiles,
  onApplyProfile,
  shortcutMap = {},
  onSetShortcut,
}: PrinterProfileManagerModalProps) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const isBusy = Boolean(loadingAction);
  const [duplicateModalVisible, setDuplicateModalVisible] = useState(false);
  const [targetProfile, setTargetProfile] = useState<SavedPrinterProfileSummary | null>(null);
  const [newName, setNewName] = useState('');
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [localProfiles, setLocalProfiles] = useState<SavedPrinterProfileSummary[]>(profiles);
  const [menuState, setMenuState] = useState<MenuState | null>(null);
  const [announcement, setAnnouncement] = useState<string>('');

  useEffect(() => {
    setLocalProfiles(profiles);
  }, [profiles]);

  // Close context menu and inline editing on modal close
  useEffect(() => {
    if (!open) {
      setMenuState(null);
      setEditingProfileId(null);
    }
  }, [open]);

  // Sensor configuration with activation distance of 5px
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
  );

  const renderCompatibilityTag = (compatibility: PrinterProfileCompatibility) => {
    switch (compatibility) {
      case 'compatible':
        return <Tag color="success">兼容</Tag>;
      case 'driverChanged':
        return <Tag color="warning">驱动已更新</Tag>;
      case 'printerUnavailable':
        return <Tag color="default">打印机离线</Tag>;
      case 'corrupted':
        return <Tag color="error">数据损坏</Tag>;
      case 'unsupportedSchema':
        return <Tag color="error">版本过旧</Tag>;
      default:
        return null;
    }
  };

  const handleApply = async (profile: SavedPrinterProfileSummary) => {
    setLoadingAction(`apply-${profile.id}`);
    try {
      const loaded = await loadPrinterProfile(profile.id);
      onApplyProfile(loaded);
      message.success(`已应用配置“${profile.name}”`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '应用配置失败');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleToggleDefault = async (profile: SavedPrinterProfileSummary) => {
    setLoadingAction(`default-${profile.id}`);
    try {
      const newDefaultId = profile.isDefault ? null : profile.id;
      await setDefaultPrinterProfile(currentPrinterName, newDefaultId);
      await onRefreshProfiles();
      message.success(
        profile.isDefault
          ? `已取消“${profile.name}”的默认设置`
          : `已将“${profile.name}”设为默认配置`,
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : '设置默认配置失败');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleDelete = async (profile: SavedPrinterProfileSummary) => {
    setLoadingAction(`delete-${profile.id}`);
    try {
      await deletePrinterProfile(profile.id);
      await onRefreshProfiles();
      message.success(`已删除配置“${profile.name}”`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除配置失败');
    } finally {
      setLoadingAction(null);
    }
  };

  const confirmDelete = (profile: SavedPrinterProfileSummary) => {
    setMenuState(null);
    Modal.confirm({
      title: `确定要删除配置“${profile.name}”吗？`,
      content: '删除后无法恢复。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      zIndex: 13500,
      onOk: () => handleDelete(profile),
    });
  };

  const handleRebuild = async (profile: SavedPrinterProfileSummary) => {
    setLoadingAction(`rebuild-${profile.id}`);
    try {
      const loaded = await rebuildPrinterProfile(profile.id);
      await onRefreshProfiles();
      onApplyProfile(loaded);
      message.success(`已成功使用当前驱动重建并应用“${profile.name}”`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '重建配置失败');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleExport = async (profile: SavedPrinterProfileSummary) => {
    setMenuState(null);
    try {
      const defaultFileName = `${profile.printerName}-${profile.name}.paprofile`.replace(
        /[\\/:*?"<>|]/g,
        '_',
      );
      const chosenPath = await saveExportProfilePath(defaultFileName);
      if (!chosenPath) {
        return;
      }
      await exportPrinterProfile(profile.id, chosenPath);
      message.success(`已成功导出配置到 ${chosenPath}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导出配置失败');
    }
  };

  const handleExportAll = async () => {
    if (localProfiles.length === 0) {
      message.warning('当前暂无配置可导出');
      return;
    }
    setMenuState(null);
    try {
      const defaultFileName = `${currentPrinterName}-全部配置.paprofile`.replace(
        /[\\/:*?"<>|]/g,
        '_',
      );
      const chosenPath = await saveExportProfilePath(defaultFileName);
      if (!chosenPath) {
        return;
      }
      setLoadingAction('export-all');
      const count = await exportAllPrinterProfiles(currentPrinterName, chosenPath);
      message.success(`已成功导出 ${count} 个配置到 ${chosenPath}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导出全部配置失败');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleImport = async () => {
    try {
      const chosenPaths = await pickImportProfileFiles();
      if (!chosenPaths || chosenPaths.length === 0) {
        return;
      }
      setLoadingAction('import');
      const imported = await importPrinterProfiles(chosenPaths, currentPrinterName);
      if (imported.length === 1) {
        message.success(`已成功导入配置“${imported[0].name}”`);
      } else if (imported.length > 1) {
        message.success(`已成功导入 ${imported.length} 个配置`);
      } else {
        message.info('未导入任何新配置');
      }
      await onRefreshProfiles();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导入配置失败');
    } finally {
      setLoadingAction(null);
    }
  };

  // Inline rename handlers (direct in-place editing, zero mask/modal hiding bugs)
  const handleStartInlineRename = (profile: SavedPrinterProfileSummary) => {
    setMenuState(null);
    setEditingProfileId(profile.id);
    setEditingName(profile.name);
  };

  const handleSaveInlineRename = async (profileId: string) => {
    const trimmed = editingName.trim();
    if (!trimmed) {
      setEditingProfileId(null);
      return;
    }
    setLoadingAction('name-action');
    try {
      await renamePrinterProfile(profileId, trimmed);
      message.success('重命名成功');
      setEditingProfileId(null);
      await onRefreshProfiles();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '重命名失败');
    } finally {
      setLoadingAction(null);
    }
  };

  // Duplicate handler
  const openDuplicateModal = (profile: SavedPrinterProfileSummary) => {
    setMenuState(null);
    setTargetProfile(profile);
    setNewName(`${profile.name} (副本)`);
    setDuplicateModalVisible(true);
  };

  const handleConfirmDuplicate = async () => {
    if (!targetProfile || !newName.trim()) return;
    setLoadingAction('name-action');
    try {
      await duplicatePrinterProfile(targetProfile.id, newName.trim());
      message.success('配置复制成功');
      setDuplicateModalVisible(false);
      await onRefreshProfiles();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
    } finally {
      setLoadingAction(null);
    }
  };

  const persistReorder = async (nextList: SavedPrinterProfileSummary[], profileName: string, newIdx: number) => {
    const previousList = localProfiles;
    setLocalProfiles(nextList);
    setAnnouncement(`已将“${profileName}”移动到第 ${newIdx + 1} 位`);

    try {
      const nextIds = nextList.map((p) => p.id);
      const authoritativeIds = await reorderPrinterProfiles(currentPrinterName, nextIds);
      const byId = new Map(nextList.map((p) => [p.id, p]));
      setLocalProfiles(
        authoritativeIds.map((id) => byId.get(id)).filter(Boolean) as SavedPrinterProfileSummary[],
      );
      await onRefreshProfiles();
    } catch (error) {
      setLocalProfiles(previousList);
      message.error(error instanceof Error ? error.message : '调整配置顺序失败');
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = localProfiles.findIndex((p) => p.id === active.id);
    const newIndex = localProfiles.findIndex((p) => p.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const movedProfile = localProfiles[oldIndex];
    const nextList = arrayMove(localProfiles, oldIndex, newIndex);
    void persistReorder(nextList, movedProfile.name, newIndex);
  };

  const handleKeyboardMove = (
    profile: SavedPrinterProfileSummary,
    direction: 'up' | 'down' | 'top' | 'bottom',
  ) => {
    const currentIndex = localProfiles.findIndex((p) => p.id === profile.id);
    if (currentIndex < 0) return;

    let targetIndex = currentIndex;
    if (direction === 'up') targetIndex = currentIndex - 1;
    else if (direction === 'down') targetIndex = currentIndex + 1;
    else if (direction === 'top') targetIndex = 0;
    else if (direction === 'bottom') targetIndex = localProfiles.length - 1;

    if (targetIndex === currentIndex || targetIndex < 0 || targetIndex >= localProfiles.length) {
      return;
    }

    const nextList = reorderProfileList(localProfiles, currentIndex, targetIndex);
    void persistReorder(nextList, profile.name, targetIndex);
  };

  const handleOpenMenu = (
    profile: SavedPrinterProfileSummary,
    e: React.MouseEvent<HTMLElement>,
  ) => {
    e.stopPropagation();
    let x = e.clientX;
    let y = e.clientY;
    if (e.currentTarget.classList.contains('profile-more-btn')) {
      const rect = e.currentTarget.getBoundingClientRect();
      x = rect.right - 180;
      y = rect.bottom + 4;
    }
    setMenuState({
      profile,
      x: Math.max(10, x),
      y: Math.max(10, y),
    });
  };

  const getProfileMenuItems = (): AppContextMenuItem[] => {
    if (!menuState) return [];

    const isBusy = Boolean(loadingAction);
    const isEditing = editingProfileId === menuState.profile.id;

    return [
      {
        key: 'rename',
        label: '重命名',
        icon: <Edit2 size={14} />,
        disabled: isBusy || isEditing,
        onClick: () => handleStartInlineRename(menuState.profile),
      },
      {
        key: 'duplicate',
        label: '复制配置',
        icon: <Copy size={14} />,
        disabled: isBusy,
        onClick: () => openDuplicateModal(menuState.profile),
      },
      {
        key: 'export',
        label: '导出配置',
        icon: <Download size={14} />,
        disabled: isBusy,
        onClick: () => void handleExport(menuState.profile),
      },
      { type: 'divider' },
      {
        key: 'delete',
        label: '删除配置',
        icon: <Trash2 size={14} />,
        danger: true,
        disabled: isBusy,
        onClick: () => confirmDelete(menuState.profile),
      },
    ];
  };

  return (
    <>
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 32 }}>
            <span>打印机配置管理（{currentPrinterName}）</span>
            <Space size={8}>
              <Tooltip title={localProfiles.length === 0 ? '当前暂无配置可导出' : '导出全部配置'}>
                <Button
                  size="small"
                  icon={<Download size={14} />}
                  onClick={handleExportAll}
                  disabled={localProfiles.length === 0 || isBusy}
                  loading={loadingAction === 'export-all'}
                  aria-label="导出全部配置"
                />
              </Tooltip>
              <Tooltip title="导入配置（支持多选）">
                <Button
                  size="small"
                  icon={<Upload size={14} />}
                  onClick={handleImport}
                  disabled={isBusy}
                  loading={loadingAction === 'import'}
                  aria-label="导入配置"
                />
              </Tooltip>
            </Space>
          </div>
        }
        width={640}
        open={open}
        onCancel={onClose}
        footer={null}
        destroyOnClose
        centered
        maskClosable={false}
        className="profile-manager-modal"
      >
        <div aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>
          {announcement}
        </div>

        <div className="profile-manager-modal-body">
          {localProfiles.length === 0 ? (
            <Empty description="当前打印机暂未保存任何配置，可在主面板调整参数后点击“保存”" />
          ) : (
            <div className="profile-manager-list">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={localProfiles.map((p) => p.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {localProfiles.map((profile) => (
                    <SortableProfileCard
                      key={profile.id}
                      profile={profile}
                      isActive={activeProfileId === profile.id}
                      loadingAction={loadingAction}
                      editingProfileId={editingProfileId}
                      editingName={editingName}
                      onApply={handleApply}
                      onToggleDefault={handleToggleDefault}
                      onOpenMenu={handleOpenMenu}
                      onRebuild={handleRebuild}
                      onKeyboardMove={handleKeyboardMove}
                      onStartInlineRename={handleStartInlineRename}
                      onChangeEditingName={setEditingName}
                      onSaveInlineRename={handleSaveInlineRename}
                      onCancelInlineRename={() => setEditingProfileId(null)}
                      renderCompatibilityTag={renderCompatibilityTag}
                      shortcutKeys={shortcutMap[`profile:${profile.id}`]}
                      onSetShortcut={onSetShortcut}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
          )}
        </div>
      </Modal>

      <AppContextMenu
        open={Boolean(menuState)}
        position={menuState ? { x: menuState.x, y: menuState.y } : null}
        onClose={() => setMenuState(null)}
        items={getProfileMenuItems()}
      />

      {/* Duplicate Modal: explicitly high z-index and centered */}
      <Modal
        title="复制配置"
        open={duplicateModalVisible}
        zIndex={13500}
        centered
        maskClosable={false}
        confirmLoading={loadingAction === 'name-action'}
        onOk={() => void handleConfirmDuplicate()}
        onCancel={() => setDuplicateModalVisible(false)}
        okText="确定"
        cancelText="取消"
      >
        <div style={{ marginTop: 16 }}>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="请输入配置名称"
            maxLength={60}
            autoFocus
          />
        </div>
      </Modal>
    </>
  );
}
