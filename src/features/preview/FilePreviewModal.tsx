import { Button, Modal, Space, Tag, Typography } from 'antd';
import { ExternalLink, Eye, FileText, Image as ImageIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { QueueItem } from '../../domain/queueTypes';
import { isTauriRuntime, showInFolder } from '../../api/nativeBridge';

interface FilePreviewModalProps {
  open: boolean;
  item: QueueItem | null;
  onClose: () => void;
}

export function FilePreviewModal({ open, item, onClose }: FilePreviewModalProps) {
  const [assetUrl, setAssetUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !item) {
      setAssetUrl(null);
      return;
    }

    if (isTauriRuntime() && item.path) {
      void import('@tauri-apps/api/core')
        .then(({ convertFileSrc }) => {
          setAssetUrl(convertFileSrc(item.path));
        })
        .catch(() => {
          setAssetUrl(null);
        });
    } else {
      setAssetUrl(null);
    }
  }, [open, item]);

  if (!item) return null;

  const isImage = item.kind === 'image';
  const isPdf = item.kind === 'pdf';

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Eye size={18} />
          <span>文件预览</span>
        </div>
      }
      open={open}
      onOk={onClose}
      onCancel={onClose}
      footer={[
        <Button
          key="folder"
          icon={<ExternalLink size={13} />}
          onClick={() => void showInFolder(item.path)}
        >
          在文件夹中显示
        </Button>,
        <Button key="close" type="primary" onClick={onClose}>
          关闭
        </Button>,
      ]}
      width={680}
      destroyOnClose
    >
      <div style={{ marginBottom: 12 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          {item.fileName}
        </Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 12, wordBreak: 'break-all' }}>
          {item.path}
        </Typography.Text>
        <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
          <Tag color="blue">{item.kind.toUpperCase()}</Tag>
          {item.pageCount !== null && <Tag>{item.pageCount} 页</Tag>}
        </div>
      </div>

      <div
        style={{
          minHeight: 320,
          maxHeight: 480,
          background: '#f8fafc',
          border: '1px solid var(--color-border-soft, #e2e8f0)',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {isImage && assetUrl ? (
          <img
            src={assetUrl}
            alt={item.fileName}
            style={{
              maxWidth: '100%',
              maxHeight: 460,
              objectFit: 'contain',
            }}
          />
        ) : isPdf && assetUrl ? (
          <iframe
            src={assetUrl}
            title={item.fileName}
            style={{
              width: '100%',
              height: 460,
              border: 'none',
            }}
          />
        ) : (
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--color-text-muted)' }}>
            {isImage ? (
              <ImageIcon size={48} style={{ opacity: 0.4, marginBottom: 8 }} />
            ) : (
              <FileText size={48} style={{ opacity: 0.4, marginBottom: 8 }} />
            )}
            <div>
              {isPdf || isImage
                ? '正在加载预览或当前环境不支持内嵌渲染'
                : `${item.kind.toUpperCase()} 文档将在打印时由系统关联程序自动解析`}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
