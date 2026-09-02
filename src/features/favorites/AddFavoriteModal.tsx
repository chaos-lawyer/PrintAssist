import { Checkbox, Form, Input, Modal, Space, Tag, Typography, Alert, message } from 'antd';
import { BookmarkPlus, FileText, Printer, Sliders } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import type { QueueItem } from '../../domain/queueTypes';
import type { PrintSettings } from '../../domain/printSettings';
import type {
  FavoriteTemplateV1,
  FavoriteTaskSnapshot,
  FavoritePrinterRef,
  FavoritePrintConfig,
  FavoriteStandardSettings,
} from './favoriteTypes';
import { getUniqueFavoriteName, isFavoriteNameUnique, MAX_NAME_LENGTH } from './favoriteStorage';

export interface AddFavoriteModalInitialData {
  name?: string;
  files?: Array<{
    path: string;
    fileName: string;
    kind: any;
    pageCount: number | null;
    override?: any;
  }>;
  printerName?: string;
  persistentProfileId?: string;
  persistentProfileName?: string;
  standardSettings?: any;
}

export interface AddFavoriteModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (favorite: Omit<FavoriteTemplateV1, 'id' | 'createdAt' | 'updatedAt' | 'order' | 'schemaVersion'>) => void;
  currentQueue: QueueItem[];
  currentPrinterName: string;
  currentProfileName?: string;
  currentPersistentProfileId?: string;
  currentSettings: PrintSettings;
  initialData?: AddFavoriteModalInitialData | null;
}

export function AddFavoriteModal({
  open,
  onClose,
  onSave,
  currentQueue,
  currentPrinterName,
  currentProfileName,
  currentPersistentProfileId,
  currentSettings,
  initialData,
}: AddFavoriteModalProps) {
  const [name, setName] = useState('');
  const [includeTask, setIncludeTask] = useState(true);
  const [includePrinter, setIncludePrinter] = useState(true);
  const [includeConfig, setIncludeConfig] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const effectiveFiles = useMemo(() => {
    if (initialData?.files && initialData.files.length > 0) {
      return initialData.files;
    }
    return currentQueue;
  }, [initialData, currentQueue]);

  const effectivePrinterName = initialData?.printerName ?? currentPrinterName;
  const effectiveProfileName = initialData?.persistentProfileName ?? currentProfileName;
  const effectiveProfileId = initialData?.persistentProfileId ?? currentPersistentProfileId;

  const defaultSuggestedName = useMemo(() => {
    if (initialData?.name) {
      return getUniqueFavoriteName(initialData.name);
    }
    if (effectiveFiles.length > 0) {
      const first = effectiveFiles[0].fileName.replace(/\.[^/.]+$/, '');
      return getUniqueFavoriteName(first || '新建收藏');
    }
    const printerPart = effectivePrinterName || '默认打印机';
    const configPart = effectiveProfileName || '标准配置';
    return getUniqueFavoriteName(`${printerPart} · ${configPart}`);
  }, [initialData, effectiveFiles, effectivePrinterName, effectiveProfileName]);

  useEffect(() => {
    if (open) {
      setName(defaultSuggestedName);
      setIncludeTask(effectiveFiles.length > 0);
      setIncludePrinter(true);
      setIncludeConfig(true);
      setErrorMsg(null);
    }
  }, [open, defaultSuggestedName, effectiveFiles.length]);

  const handleNameChange = (val: string) => {
    setName(val);
    const trimmed = val.trim();
    if (!trimmed) {
      setErrorMsg('收藏名称不能为空');
    } else if (trimmed.length > MAX_NAME_LENGTH) {
      setErrorMsg(`收藏名称不能超过 ${MAX_NAME_LENGTH} 个字符`);
    } else if (!isFavoriteNameUnique(trimmed)) {
      setErrorMsg(`已存在名为“${trimmed}”的收藏`);
    } else {
      setErrorMsg(null);
    }
  };

  const handleIncludeConfigChange = (checked: boolean) => {
    setIncludeConfig(checked);
    if (checked) {
      // Config requires printer
      setIncludePrinter(true);
    }
  };

  const handleIncludePrinterChange = (checked: boolean) => {
    setIncludePrinter(checked);
    if (!checked) {
      // Disabling printer also disables config
      setIncludeConfig(false);
    }
  };

  const canSubmit = useMemo(() => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > MAX_NAME_LENGTH) return false;
    if (!isFavoriteNameUnique(trimmed)) return false;
    return includeTask || includePrinter || includeConfig;
  }, [name, includeTask, includePrinter, includeConfig]);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      message.error('请输入收藏名称');
      return;
    }
    if (!isFavoriteNameUnique(trimmed)) {
      message.error(`已存在名为“${trimmed}”的收藏，请更换名称`);
      return;
    }
    if (!includeTask && !includePrinter && !includeConfig) {
      message.error('请至少勾选一项保存内容');
      return;
    }

    let task: FavoriteTaskSnapshot | null = null;
    if (includeTask && effectiveFiles.length > 0) {
      task = {
        items: effectiveFiles.map((it) => ({
          path: it.path,
          fileName: it.fileName,
          kind: it.kind as any,
          pageCount: it.pageCount,
          override: it.override ? { ...it.override } : {},
        })),
      };
    }

    let printer: FavoritePrinterRef | null = null;
    if (includePrinter && effectivePrinterName) {
      printer = { name: effectivePrinterName };
    }

    let printConfig: FavoritePrintConfig | null = null;
    if (includeConfig) {
      const stdSettings: FavoriteStandardSettings = {
        colorMode: currentSettings.colorMode,
        sidesMode: currentSettings.sidesMode,
        flipMode: currentSettings.flipMode,
        copies: currentSettings.copies,
        collateMode: currentSettings.collateMode,
        collate: currentSettings.collate,
        sourceCode: currentSettings.sourceCode,
        sourceName: currentSettings.sourceName,
        scaleMode: currentSettings.scaleMode,
        nupLayout: currentSettings.nupLayout,
        nupScope: currentSettings.nupScope,
        pageRange: currentSettings.pageRange,
      };

      printConfig = {
        persistentProfileId: effectiveProfileId,
        persistentProfileName: effectiveProfileName,
        standardSettings: stdSettings,
      };
    }

    onSave({
      name: trimmed,
      task,
      printer,
      printConfig,
      source: initialData ? 'history-migration' : 'manual',
    });

    onClose();
  };

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BookmarkPlus size={18} color="var(--color-primary, #1557d0)" />
          <span>保存为收藏模板</span>
        </div>
      }
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      okText="保存收藏"
      cancelText="取消"
      okButtonProps={{ disabled: !canSubmit }}
      centered
      destroyOnHidden
      width={480}
      className="add-favorite-modal"
    >
      <Form layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item
          label="收藏名称"
          required
          validateStatus={errorMsg ? 'error' : ''}
          help={errorMsg}
        >
          <Input
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="请输入收藏名称（1-60 个字符）"
            maxLength={MAX_NAME_LENGTH}
            autoFocus
          />
        </Form.Item>

        <Form.Item label="包含保存的内容">
          <Space direction="vertical" style={{ width: '100%' }} size={10}>
            <Checkbox
              checked={includeTask}
              disabled={effectiveFiles.length === 0}
              onChange={(e) => setIncludeTask(e.target.checked)}
            >
              <Space size={6}>
                <FileText size={15} style={{ color: 'var(--color-text-muted)' }} />
                <span>
                  当前待打印文件任务（{effectiveFiles.length} 个文件）
                </span>
                {effectiveFiles.length === 0 && (
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    （当前队列无文件）
                  </Typography.Text>
                )}
              </Space>
            </Checkbox>

            <Checkbox
              checked={includePrinter}
              onChange={(e) => handleIncludePrinterChange(e.target.checked)}
            >
              <Space size={6}>
                <Printer size={15} style={{ color: 'var(--color-text-muted)' }} />
                <span>目标打印机：{effectivePrinterName || '未指定'}</span>
              </Space>
            </Checkbox>

            <Checkbox
              checked={includeConfig}
              onChange={(e) => handleIncludeConfigChange(e.target.checked)}
            >
              <Space size={6}>
                <Sliders size={15} style={{ color: 'var(--color-text-muted)' }} />
                <span>
                  打印参数配置：
                  {effectiveProfileName ? (
                    <Tag color="blue">{effectiveProfileName}</Tag>
                  ) : (
                    <Tag>标准参数快照</Tag>
                  )}
                </span>
              </Space>
            </Checkbox>
          </Space>
        </Form.Item>

        {includeConfig && !effectiveProfileId && (
          <Alert
            type="info"
            showIcon
            style={{ fontSize: 12, marginTop: 8 }}
            message="当前未选择已保存的驱动配置，将保存标准参数快照（颜色、单双面、份数、缩放等）。"
          />
        )}
      </Form>
    </Modal>
  );
}
