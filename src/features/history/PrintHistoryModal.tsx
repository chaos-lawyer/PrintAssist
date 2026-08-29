import {
  Button,
  Collapse,
  Empty,
  Modal,
  Popconfirm,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  RotateCcw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { clearPrintHistory, loadPrintHistory, type PrintHistoryRecord } from './historyStorage';

interface PrintHistoryModalProps {
  open: boolean;
  onClose: () => void;
  onReloadFiles: (paths: string[]) => void;
}

export function PrintHistoryModal({
  open,
  onClose,
  onReloadFiles,
}: PrintHistoryModalProps) {
  const [history, setHistory] = useState<PrintHistoryRecord[]>([]);

  const reloadHistory = () => {
    setHistory(loadPrintHistory());
  };

  useEffect(() => {
    if (open) {
      reloadHistory();
    }
  }, [open]);

  const handleClear = () => {
    clearPrintHistory();
    setHistory([]);
    message.success('打印历史记录已清空');
  };

  const handleReloadRecordFiles = (record: PrintHistoryRecord) => {
    const validPaths = record.files.map((f) => f.path).filter(Boolean);
    if (validPaths.length === 0) {
      message.warning('该批次中没有有效的文件路径');
      return;
    }
    onReloadFiles(validPaths);
    message.success(`已载入 ${validPaths.length} 个文件到打印队列`);
    onClose();
  };

  const formatTime = (timestamp: number) => {
    const d = new Date(timestamp);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={18} />
            <span>打印历史</span>
          </div>
          {history.length > 0 && (
            <Popconfirm
              title="清空历史记录"
              description="确定要清空全部打印历史记录吗？"
              okText="清空"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={handleClear}
            >
              <Button size="small" danger icon={<Trash2 size={13} />}>
                清空历史
              </Button>
            </Popconfirm>
          )}
        </div>
      }
      open={open}
      onCancel={onClose}
      width={660}
      centered
      destroyOnClose
      maskClosable={false}
      footer={null}
      className="print-history-modal"
    >
      <div className="print-history-modal-body">
      {history.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无打印历史记录"
          style={{ marginTop: 60 }}
        />
      ) : (
        <div className="history-records-list">
          <Collapse
            defaultActiveKey={[history[0]?.id]}
            items={history.map((record) => {
              const isAllSuccess = record.failedCount === 0 && record.skippedCount === 0;
              const isPartial = record.failedCount > 0 && record.succeededCount > 0;
              const headerTag = isAllSuccess ? (
                <Tag color="success">全部成功</Tag>
              ) : isPartial ? (
                <Tag color="warning">部分失败</Tag>
              ) : (
                <Tag color="error">全部失败</Tag>
              );

              return {
                key: record.id,
                label: (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      paddingRight: 8,
                    }}
                  >
                    <div>
                      <Typography.Text strong style={{ fontSize: 13, marginRight: 8 }}>
                        {formatTime(record.timestamp)}
                      </Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {record.printerName || '默认打印机'}
                      </Typography.Text>
                    </div>
                    <Space size={6}>
                      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                        {record.totalFiles} 个文件
                      </span>
                      {headerTag}
                    </Space>
                  </div>
                ),
                children: (
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 10,
                        paddingBottom: 6,
                        borderBottom: '1px solid #f0f0f0',
                      }}
                    >
                      <Space size={12}>
                        <span style={{ fontSize: 12, color: '#52c41a' }}>
                          成功: {record.succeededCount}
                        </span>
                        {record.failedCount > 0 && (
                          <span style={{ fontSize: 12, color: '#ff4d4f' }}>
                            失败: {record.failedCount}
                          </span>
                        )}
                        {record.skippedCount > 0 && (
                          <span style={{ fontSize: 12, color: '#faad14' }}>
                            跳过: {record.skippedCount}
                          </span>
                        )}
                      </Space>
                      <Button
                        type="primary"
                        size="small"
                        icon={<RotateCcw size={12} />}
                        onClick={() => handleReloadRecordFiles(record)}
                      >
                        重新载入这批文件
                      </Button>
                    </div>

                    <div style={{ display: 'grid', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                      {record.files.map((file, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '4px 8px',
                            background: '#fafafa',
                            borderRadius: 4,
                            fontSize: 12,
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              minWidth: 0,
                              flex: 1,
                            }}
                          >
                            {file.status === 'succeeded' ? (
                              <CheckCircle2 size={14} color="#52c41a" style={{ flexShrink: 0 }} />
                            ) : (
                              <XCircle size={14} color="#ff4d4f" style={{ flexShrink: 0 }} />
                            )}
                            <Tooltip title={file.path}>
                              <span
                                style={{
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {file.fileName}
                              </span>
                            </Tooltip>
                          </div>
                          {file.message && (
                            <span
                              style={{
                                color: file.status === 'succeeded' ? '#52c41a' : '#ff4d4f',
                                fontSize: 11,
                                marginLeft: 8,
                                flexShrink: 0,
                              }}
                            >
                              {file.message}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ),
              };
            })}
          />
        </div>
      )}
      </div>
    </Modal>
  );
}
