import { Button, Modal, Space, Tooltip, Typography } from 'antd';
import { AlertCircle, FileText } from 'lucide-react';
import React from 'react';
import { extractBaseFileName } from './duplicateDetection';

export type DuplicateDecision = 'new-only' | 'all' | 'cancel';

export interface DuplicateConfirmModalProps {
  open: boolean;
  totalCount: number;
  duplicatePaths: string[];
  newCount: number;
  onDecision: (decision: DuplicateDecision) => void;
}

export function DuplicateConfirmModal({
  open,
  totalCount,
  duplicatePaths,
  newCount,
  onDecision,
}: DuplicateConfirmModalProps) {
  const displayedDuplicates = duplicatePaths.slice(0, 5);
  const remainingCount = duplicatePaths.length - displayedDuplicates.length;

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertCircle size={18} style={{ color: '#faad14' }} />
          <span>检测到重复文件</span>
        </div>
      }
      open={open}
      onCancel={() => onDecision('cancel')}
      width={480}
      centered
      maskClosable={false}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={() => onDecision('cancel')}>
            取消
          </Button>
          <Tooltip title={newCount === 0 ? '没有可添加的新文件' : undefined}>
            <span>
              <Button
                type="primary"
                disabled={newCount === 0}
                onClick={() => onDecision('new-only')}
              >
                仅添加未重复文件 ({newCount})
              </Button>
            </span>
          </Tooltip>
          <Button onClick={() => onDecision('all')}>
            仍然全部添加 ({totalCount})
          </Button>
        </div>
      }
    >
      <div style={{ paddingTop: 8, paddingBottom: 8 }}>
        <Typography.Paragraph style={{ marginBottom: 12 }}>
          本次选择 <strong>{totalCount}</strong> 个文件，其中{' '}
          <strong style={{ color: '#d46b08' }}>{duplicatePaths.length}</strong>{' '}
          个已在待打印列表中。重复文件可能会被打印多次。
        </Typography.Paragraph>

        <div
          style={{
            background: 'var(--color-bg-subtle, #f8fafc)',
            border: '1px solid var(--color-border-soft, #e2e8f0)',
            borderRadius: 6,
            padding: '8px 12px',
            maxHeight: 180,
            overflowY: 'auto',
          }}
        >
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            {displayedDuplicates.map((filePath, idx) => {
              const fileName = extractBaseFileName(filePath);
              return (
                <Tooltip key={`${filePath}::${idx}`} title={filePath} placement="topLeft">
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      color: 'var(--color-text-secondary, #475569)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    <FileText size={13} style={{ flexShrink: 0, opacity: 0.7 }} />
                    <span
                      style={{
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {fileName}
                    </span>
                  </div>
                </Tooltip>
              );
            })}
            {remainingCount > 0 && (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--color-text-muted, #94a3b8)',
                  paddingTop: 2,
                }}
              >
                另有 {remainingCount} 个重复文件…
              </div>
            )}
          </Space>
        </div>
      </div>
    </Modal>
  );
}
