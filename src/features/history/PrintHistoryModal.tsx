import {
  Button,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Space,
  Table,
  Tag,
  Tooltip,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CheckCircle2,
  Clock,
  MinusCircle,
  RotateCcw,
  Search,
  Star,
  Trash2,
  XCircle,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import {
  filterHistoryRecords,
  formatHistoryTime,
  getBatchResultStatus,
  getFileNameSummary,
} from './historyHelpers';
import {
  clearPrintHistory,
  loadPrintHistory,
  setPrintHistoryFavorite,
  type PrintHistoryRecord,
} from './historyStorage';

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
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'favorite'>('all');
  const [expandedRowKeys, setExpandedRowKeys] = useState<React.Key[]>([]);

  const reloadHistory = () => {
    setHistory(loadPrintHistory());
  };

  useEffect(() => {
    if (open) {
      reloadHistory();
      setSearchQuery('');
      setFilterType('all');
      setExpandedRowKeys([]);
    }
  }, [open]);

  const handleClear = () => {
    clearPrintHistory();
    setHistory([]);
    setExpandedRowKeys([]);
    message.success('打印历史记录已清空');
  };

  const handleToggleFavorite = (record: PrintHistoryRecord) => {
    const nextFavorite = !record.isFavorite;
    const success = setPrintHistoryFavorite(record.id, nextFavorite);
    if (success) {
      setHistory((prev) =>
        prev.map((item) =>
          item.id === record.id ? { ...item, isFavorite: nextFavorite } : item
        )
      );
    } else {
      message.error('收藏状态保存失败');
    }
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

  const toggleRowExpansion = (key: React.Key) => {
    setExpandedRowKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleResetFilter = () => {
    setSearchQuery('');
    setFilterType('all');
  };

  const filteredRecords = useMemo(() => {
    return filterHistoryRecords(history, searchQuery, filterType);
  }, [history, searchQuery, filterType]);

  const columns: ColumnsType<PrintHistoryRecord> = [
    {
      title: '打印时间',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 160,
      render: (_, record) => {
        const { display, detailed } = formatHistoryTime(record.timestamp);
        return (
          <Tooltip title={detailed} placement="topLeft">
            <div className="history-time-cell">
              <span className="history-time-primary">{display}</span>
              <span className="history-printer-name" title={record.printerName}>
                {record.printerName || '默认打印机'}
              </span>
            </div>
          </Tooltip>
        );
      },
    },
    {
      title: '文件名',
      key: 'fileNameSummary',
      render: (_, record) => {
        const summary = getFileNameSummary(record.files);
        return (
          <div
            className="history-filename-cell"
            onClick={() => toggleRowExpansion(record.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleRowExpansion(record.id);
              }
            }}
          >
            <Tooltip title={summary.first} placement="topLeft">
              <div className="history-filename-row">
                <span className="history-filename-text">{summary.first}</span>
              </div>
            </Tooltip>
            {summary.second && (
              <div className="history-filename-row">
                <Tooltip title={summary.second} placement="topLeft">
                  <span className="history-filename-text">{summary.second}</span>
                </Tooltip>
                {summary.moreCount > 0 && (
                  <span className="history-more-badge">另 {summary.moreCount} 个</span>
                )}
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: '文件数量',
      dataIndex: 'totalFiles',
      key: 'totalFiles',
      width: 88,
      align: 'center',
      render: (totalFiles: number) => `${totalFiles} 个`,
    },
    {
      title: '打印结果',
      key: 'status',
      width: 104,
      align: 'center',
      render: (_, record) => {
        const status = getBatchResultStatus(record);
        return (
          <Tooltip title={status.tooltip}>
            <Tag color={status.tagColor}>{status.text}</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: '收藏',
      key: 'favorite',
      width: 64,
      align: 'center',
      render: (_, record) => {
        const isFav = Boolean(record.isFavorite);
        const tooltipTitle = isFav ? '取消收藏' : '收藏此记录';
        return (
          <Tooltip title={tooltipTitle}>
            <button
              type="button"
              className={`history-action-btn history-star-btn ${isFav ? 'is-favorite' : ''}`}
              aria-label={tooltipTitle}
              aria-pressed={isFav}
              onClick={(e) => {
                e.stopPropagation();
                handleToggleFavorite(record);
              }}
            >
              <Star size={16} fill={isFav ? 'currentColor' : 'none'} />
            </button>
          </Tooltip>
        );
      },
    },
    {
      title: '重新加载',
      key: 'reload',
      width: 72,
      align: 'center',
      render: (_, record) => (
        <Tooltip title="重新加载此批文件">
          <button
            type="button"
            className="history-action-btn history-reload-btn"
            aria-label="重新加载此批文件"
            onClick={(e) => {
              e.stopPropagation();
              handleReloadRecordFiles(record);
            }}
          >
            <RotateCcw size={16} />
          </button>
        </Tooltip>
      ),
    },
  ];

  const renderExpandedRow = (record: PrintHistoryRecord) => {
    return (
      <div className="history-expand-container">
        <div className="history-expand-header">
          <Space size={12}>
            <span style={{ color: '#52c41a' }}>成功: {record.succeededCount}</span>
            {record.failedCount > 0 && (
              <span style={{ color: '#ff4d4f' }}>失败: {record.failedCount}</span>
            )}
            {record.skippedCount > 0 && (
              <span style={{ color: '#faad14' }}>跳过: {record.skippedCount}</span>
            )}
          </Space>
          <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>
            共 {record.files.length} 个文件
          </span>
        </div>

        <div className="history-expand-file-list">
          {record.files.map((file, idx) => (
            <div key={idx} className="history-expand-file-item">
              <div className="history-expand-file-main">
                {file.status === 'succeeded' ? (
                  <CheckCircle2 size={14} color="#52c41a" style={{ flexShrink: 0 }} />
                ) : file.status === 'skipped' ? (
                  <MinusCircle size={14} color="#faad14" style={{ flexShrink: 0 }} />
                ) : (
                  <XCircle size={14} color="#ff4d4f" style={{ flexShrink: 0 }} />
                )}
                <Tooltip title={file.path || '无本地路径'}>
                  <span className="history-expand-file-name">{file.fileName}</span>
                </Tooltip>
              </div>
              {file.message && (
                <span
                  className="history-expand-file-msg"
                  style={{
                    color: file.status === 'succeeded' ? '#52c41a' : '#ff4d4f',
                  }}
                >
                  {file.message}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <Modal
      title={
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingRight: 28,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={18} />
            <span>打印历史</span>
          </div>
          {history.length > 0 && (
            <Popconfirm
              title="清空历史记录"
              description="确定要清空全部打印历史记录吗？包含收藏的记录也将被清除。"
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
      width={920}
      centered
      destroyOnHidden
      mask={{ closable: false }}
      footer={null}
      className="print-history-modal"
    >
      <div className="print-history-modal-body">
        {history.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无打印历史记录"
            style={{ marginTop: 60, marginBottom: 60 }}
          />
        ) : (
          <>
            <div className="print-history-toolbar">
              <div className="print-history-toolbar-left">
                <Input
                  className="print-history-search-input"
                  prefix={<Search size={14} style={{ color: 'var(--color-text-muted)' }} />}
                  placeholder="搜索文件名..."
                  allowClear
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <Segmented
                  value={filterType}
                  onChange={(val) => setFilterType(val as 'all' | 'favorite')}
                  options={[
                    { label: '全部', value: 'all' },
                    { label: '已收藏', value: 'favorite' },
                  ]}
                />
              </div>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                {filteredRecords.length !== history.length
                  ? `显示 ${filteredRecords.length} / ${history.length} 条记录`
                  : `共 ${history.length} 条记录`}
              </span>
            </div>

            {filteredRecords.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="没有符合条件的打印记录"
                style={{ marginTop: 40, marginBottom: 40 }}
              >
                <Button size="small" onClick={handleResetFilter}>
                  清除筛选
                </Button>
              </Empty>
            ) : (
              <div className="print-history-table-wrapper">
                <Table<PrintHistoryRecord>
                  className="print-history-table"
                  rowKey="id"
                  columns={columns}
                  dataSource={filteredRecords}
                  size="middle"
                  scroll={{ y: '56vh' }}
                  pagination={
                    filteredRecords.length > 20
                      ? {
                          pageSize: 20,
                          showSizeChanger: false,
                          hideOnSinglePage: true,
                        }
                      : false
                  }
                  expandable={{
                    expandedRowRender: renderExpandedRow,
                    expandedRowKeys,
                    onExpandedRowsChange: (keys) => setExpandedRowKeys(keys as React.Key[]),
                    rowExpandable: (record) => record.files.length > 0,
                  }}
                />
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
