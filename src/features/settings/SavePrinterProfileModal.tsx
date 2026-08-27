import { Alert, Form, Input, Modal, Radio, Space } from 'antd';
import { useEffect, useState } from 'react';
import { savePrinterProfile } from '../../api/nativeBridge';
import type { PrintSettings } from '../../domain/printSettings';
import type { SavedPrinterProfileSummary } from '../../shared/contracts/printer';

interface SavePrinterProfileModalProps {
  open: boolean;
  currentPrinterName: string;
  currentSettings: PrintSettings;
  runtimeProfileId?: string;
  currentPersistentProfile?: SavedPrinterProfileSummary | null;
  onCancel: () => void;
  onSaved: (saved: SavedPrinterProfileSummary) => void;
}

export function SavePrinterProfileModal({
  open,
  currentPrinterName,
  currentSettings,
  runtimeProfileId,
  currentPersistentProfile,
  onCancel,
  onSaved,
}: SavePrinterProfileModalProps) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saveMode, setSaveMode] = useState<'overwrite' | 'new'>('new');

  const generateDefaultName = () => {
    const parts: string[] = [];
    if (currentSettings.driverSummary) {
      return currentSettings.driverSummary;
    }
    parts.push(currentSettings.sidesMode === 'duplex' ? '双面' : '单面');
    parts.push(currentSettings.colorMode === 'color' ? '彩色' : '黑白');
    return parts.join(' ');
  };

  useEffect(() => {
    if (open) {
      setErrorMessage(null);
      if (currentPersistentProfile) {
        setSaveMode('overwrite');
        form.setFieldsValue({
          name: currentPersistentProfile.name,
          note: currentPersistentProfile.note || '',
        });
      } else {
        setSaveMode('new');
        form.setFieldsValue({
          name: generateDefaultName(),
          note: '',
        });
      }
    }
  }, [open, currentPersistentProfile]);

  const handleModeChange = (mode: 'overwrite' | 'new') => {
    setSaveMode(mode);
    if (mode === 'overwrite' && currentPersistentProfile) {
      form.setFieldsValue({
        name: currentPersistentProfile.name,
        note: currentPersistentProfile.note || '',
      });
    } else {
      form.setFieldsValue({
        name: `${currentPersistentProfile?.name || generateDefaultName()} (副本)`,
        note: '',
      });
    }
  };

  const handleOk = async () => {
    if (!runtimeProfileId) {
      setErrorMessage('未检测到驱动运行时配置数据，请先点击“打印机属性”调整并确认');
      return;
    }

    try {
      const values = await form.validateFields();
      setSaving(true);
      setErrorMessage(null);

      const overwriteId =
        saveMode === 'overwrite' && currentPersistentProfile
          ? currentPersistentProfile.id
          : undefined;

      const result = await savePrinterProfile({
        name: values.name.trim(),
        printerName: currentPrinterName,
        runtimeProfileId,
        overwritePersistentProfileId: overwriteId,
        note: values.note ? values.note.trim() : undefined,
      });

      onSaved(result);
    } catch (error) {
      if (error && typeof error === 'object' && 'message' in error) {
        setErrorMessage((error as Error).message);
      } else if (typeof error === 'string') {
        setErrorMessage(error);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="保存打印机配置"
      open={open}
      confirmLoading={saving}
      onOk={() => void handleOk()}
      onCancel={onCancel}
      okText="保存"
      cancelText="取消"
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        {errorMessage && (
          <Alert
            type="error"
            message={errorMessage}
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}

        {currentPersistentProfile && (
          <Form.Item label="保存方式">
            <Radio.Group
              value={saveMode}
              onChange={(e) => handleModeChange(e.target.value)}
            >
              <Space direction="vertical">
                <Radio value="overwrite">
                  覆盖当前配置（{currentPersistentProfile.name}）
                </Radio>
                <Radio value="new">另存为新配置</Radio>
              </Space>
            </Radio.Group>
          </Form.Item>
        )}

        <Form.Item
          label="配置名称"
          name="name"
          rules={[
            { required: true, message: '请输入配置名称' },
            { max: 60, message: '配置名称不能超过 60 个字符' },
            {
              validator: (_, value) => {
                if (value && (value.trim() === '系统默认' || value.trim() === '未保存的当前配置')) {
                  return Promise.reject(new Error('不能使用系统保留名称'));
                }
                return Promise.resolve();
              },
            },
          ]}
        >
          <Input placeholder="例如：日常双面 A4、高精度单面" maxLength={60} />
        </Form.Item>

        <Form.Item label="备注说明（可选）" name="note">
          <Input.TextArea
            placeholder="例如：专用于财务报表打印、默认纸盒 2"
            rows={3}
            maxLength={200}
          />
        </Form.Item>

        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
          当前参数：{currentSettings.driverSummary || '默认设置'}
        </div>
      </Form>
    </Modal>
  );
}
