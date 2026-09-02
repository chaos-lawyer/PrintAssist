import { Button, Modal, Space, Tooltip, Typography } from 'antd';
import { Keyboard, X } from 'lucide-react';
import { useEffect, useState, useMemo } from 'react';
import { findShortcutConflict, loadCustomShortcuts } from './shortcutRegistry';

interface ShortcutBindingButtonProps {
  label: string;
  keys?: string[];
  onChange: (keys?: string[]) => void;
  id?: string;
  customShortcuts?: Record<string, string[]>;
}

function toKeys(event: KeyboardEvent): string[] | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return null;
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  const keys: string[] = [];
  if (event.ctrlKey || event.metaKey) keys.push('Ctrl');
  if (event.shiftKey) keys.push('Shift');
  if (event.altKey) keys.push('Alt');
  keys.push(key);
  return keys;
}

export function ShortcutBindingButton({
  label,
  keys,
  onChange,
  id,
  customShortcuts,
}: ShortcutBindingButtonProps) {
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState<string[] | null>(null);

  const activeCustomMap = customShortcuts ?? loadCustomShortcuts();

  const conflict = useMemo(() => {
    if (!recording) return null;
    return findShortcutConflict(recording, activeCustomMap, id);
  }, [recording, activeCustomMap, id]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setOpen(false);
        return;
      }
      const next = toKeys(event);
      if (next) setRecording(next);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  return (
    <>
      <Tooltip title={keys?.join(' + ') || '设置快捷键'}>
        <Button
          size="small"
          type="text"
          icon={<Keyboard size={14} />}
          aria-label={`${label}：${keys?.join(' + ') || '设置快捷键'}`}
          onClick={() => {
            setRecording(null);
            setOpen(true);
          }}
        />
      </Tooltip>
      <Modal
        title={`设置快捷键：${label}`}
        open={open}
        destroyOnClose
        onCancel={() => setOpen(false)}
        okText="保存"
        okButtonProps={{ disabled: !recording }}
        onOk={() => {
          if (recording) onChange(recording);
          setOpen(false);
        }}
        footer={(_, { OkBtn, CancelBtn }) => (
          <Space>
            {keys && (
              <Button
                icon={<X size={14} />}
                onClick={() => {
                  onChange(undefined);
                  setOpen(false);
                }}
              >
                清除
              </Button>
            )}
            <CancelBtn />
            <OkBtn />
          </Space>
        )}
      >
        <Typography.Paragraph type="secondary">
          按下要绑定的按键组合（建议使用 Alt+1~9 或自定义组合键）。
        </Typography.Paragraph>
        <div style={{ margin: '16px 0' }}>
          <Typography.Text strong style={{ fontSize: 16 }}>
            {recording ? recording.join(' + ') : '等待按键…'}
          </Typography.Text>
        </div>
        {conflict && (
          <div style={{ marginTop: 8 }}>
            <Typography.Text type="warning" style={{ fontSize: 12 }}>
              ⚠️ 该按键组合当前已分配给“{conflict.conflictedName}”，保存将直接替换。
            </Typography.Text>
          </div>
        )}
      </Modal>
    </>
  );
}
