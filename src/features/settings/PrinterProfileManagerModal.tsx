import {
  Alert,
  Button,
  Drawer,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  Check,
  Copy,
  Download,
  Edit2,
  FileCheck,
  RefreshCw,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import { useState } from 'react';
import {
  deletePrinterProfile,
  duplicatePrinterProfile,
  exportPrinterProfile,
  importPrinterProfile,
  loadPrinterProfile,
  rebuildPrinterProfile,
  renamePrinterProfile,
  setDefaultPrinterProfile,
} from '../../api/nativeBridge';
import type {
  LoadedPrinterProfileResult,
  PrinterProfileCompatibility,
  SavedPrinterProfileSummary,
} from '../../shared/contracts/printer';

interface PrinterProfileManagerModalProps {
  open: boolean;
  currentPrinterName: string;
  profiles: SavedPrinterProfileSummary[];
  activeProfileId?: string;
  onClose: () => void;
  onRefreshProfiles: () => Promise<void>;
  onApplyProfile: (loaded: LoadedPrinterProfileResult) => void;
}

export function PrinterProfileManagerModal({
  open,
  currentPrinterName,
  profiles,
  activeProfileId,
  onClose,
  onRefreshProfiles,
  onApplyProfile,
}: PrinterProfileManagerModalProps) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [targetProfile, setTargetProfile] = useState<SavedPrinterProfileSummary | null>(null);
  const [newName, setNewName] = useState('');
  const [actionType, setActionType] = useState<'rename' | 'duplicate'>('rename');

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
    try {
      const defaultFileName = `${profile.printerName}-${profile.name}.paprofile`.replace(
        /[\\/:*?"<>|]/g,
        '_',
      );
      // We can use Tauri dialog or save to download/temp
      const targetPath = `${defaultFileName}`;
      await exportPrinterProfile(profile.id, targetPath);
      message.success(`已成功导出配置到 ${targetPath}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导出配置失败');
    }
  };

  const openRenameOrDuplicate = (
    profile: SavedPrinterProfileSummary,
    type: 'rename' | 'duplicate',
  ) => {
    setTargetProfile(profile);
    setActionType(type);
    setNewName(type === 'duplicate' ? `${profile.name} (副本)` : profile.name);
    setRenameModalVisible(true);
  };

  const handleConfirmName = async () => {
    if (!targetProfile || !newName.trim()) {
      return;
    }
    setLoadingAction('name-action');
    try {
      if (actionType === 'rename') {
        await renamePrinterProfile(targetProfile.id, newName.trim());
        message.success('重命名成功');
      } else {
        await duplicatePrinterProfile(targetProfile.id, newName.trim());
        message.success('配置复制成功');
      }
      setRenameModalVisible(false);
      await onRefreshProfiles();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <>
      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>打印机配置管理（{currentPrinterName}）</span>
          </div>
        }
        width={580}
        open={open}
        onClose={onClose}
        destroyOnClose
      >
        {profiles.length === 0 ? (
          <Empty description="当前打印机暂未保存任何配置，可在主面板调整参数后点击“保存”" />
        ) : (
          <div className="profile-manager-list">
            {profiles.map((profile) => {
              const isActive = activeProfileId === profile.id;
              const isCompatible = profile.compatibility === 'compatible';
              const isDriverChanged = profile.compatibility === 'driverChanged';

              return (
                <div
                  key={profile.id}
                  className={`profile-card${isActive ? ' is-active' : ''}${
                    !isCompatible ? ' is-incompatible' : ''
                  }`}
                >
                  <div className="profile-card-header">
                    <div className="profile-card-title-row">
                      <span className="profile-card-name">{profile.name}</span>
                      {profile.isDefault && <Tag color="gold">默认</Tag>}
                      {isActive && <Tag color="processing">正在使用</Tag>}
                      {renderCompatibilityTag(profile.compatibility)}
                    </div>
                    <div className="profile-card-actions">
                      <Button
                        size="small"
                        type={isActive ? 'default' : 'primary'}
                        disabled={!isCompatible}
                        loading={loadingAction === `apply-${profile.id}`}
                        onClick={() => void handleApply(profile)}
                      >
                        {isActive ? '已应用' : '应用'}
                      </Button>

                      <Button
                        size="small"
                        icon={<Star size={13} fill={profile.isDefault ? '#faad14' : 'none'} />}
                        loading={loadingAction === `default-${profile.id}`}
                        onClick={() => void handleToggleDefault(profile)}
                        title={profile.isDefault ? '取消默认' : '设为默认'}
                      />

                      <Button
                        size="small"
                        icon={<Edit2 size={13} />}
                        onClick={() => openRenameOrDuplicate(profile, 'rename')}
                        title="重命名"
                      />

                      <Button
                        size="small"
                        icon={<Copy size={13} />}
                        onClick={() => openRenameOrDuplicate(profile, 'duplicate')}
                        title="复制配置"
                      />

                      <Popconfirm
                        title="确定删除此配置？"
                        description={
                          profile.isDefault
                            ? '此配置为默认配置，删除后该打印机将恢复系统默认配置。'
                            : undefined
                        }
                        onConfirm={() => void handleDelete(profile)}
                        okText="删除"
                        cancelText="取消"
                        okButtonProps={{ danger: true }}
                      >
                        <Button
                          size="small"
                          danger
                          icon={<Trash2 size={13} />}
                          loading={loadingAction === `delete-${profile.id}`}
                          title="删除配置"
                        />
                      </Popconfirm>
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
                        onClick={() => void handleRebuild(profile)}
                      >
                        按标准字段重建
                      </Button>
                    </div>
                  )}

                  {profile.note && <div className="profile-card-note">备注：{profile.note}</div>}
                </div>
              );
            })}
          </div>
        )}
      </Drawer>

      <Modal
        title={actionType === 'rename' ? '重命名配置' : '复制配置'}
        open={renameModalVisible}
        confirmLoading={loadingAction === 'name-action'}
        onOk={() => void handleConfirmName()}
        onCancel={() => setRenameModalVisible(false)}
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
