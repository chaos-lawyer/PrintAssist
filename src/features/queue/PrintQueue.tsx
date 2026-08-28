import {
  Button,
  Dropdown,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { MenuProps } from 'antd';
import {
  Copy,
  File,
  FileCode,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Image,
  MoreHorizontal,
  Presentation,
  Settings2,
  Trash2,
} from 'lucide-react';
import { useMemo } from 'react';
import { showInFolder } from '../../api/nativeBridge';
import type { QueueItem } from '../../domain/queueTypes';
import { describePageRange } from '../../domain/pageRange';
import {
  hasFileOverride,
  mergePrintSettings,
  type PrintSettings,
} from '../../domain/printSettings';

interface PrintQueueProps {
  items: QueueItem[];
  globalSettings: PrintSettings;
  isPrinting: boolean;
  onRemove: (id: string) => void;
  onOpenSettings: (id: string) => void;
}

function statusTag(status: QueueItem['status']) {
  switch (status) {
    case 'ready':
    case 'pending':
      return <Tag color="blue">待打印</Tag>;
    case 'printing':
      return <Tag color="processing">打印中</Tag>;
    case 'succeeded':
      return <Tag color="success">成功</Tag>;
    case 'failed':
      return <Tag color="error">失败</Tag>;
    case 'skipped':
      return <Tag>跳过</Tag>;
    case 'analyzing':
      return <Tag color="gold">分析中</Tag>;
    default:
      return <Tag>{status}</Tag>;
  }
}

function renderFileIcon(kind: QueueItem['kind']) {
  switch (kind) {
    case 'pdf':
      return <FileText size={16} className="file-kind-icon file-kind-pdf" />;
    case 'image':
      return <Image size={16} className="file-kind-icon file-kind-image" />;
    case 'word':
      return <FileText size={16} className="file-kind-icon file-kind-word" />;
    case 'excel':
      return <FileSpreadsheet size={16} className="file-kind-icon file-kind-excel" />;
    case 'powerpoint':
      return <Presentation size={16} className="file-kind-icon file-kind-ppt" />;
    case 'text':
      return <FileCode size={16} className="file-kind-icon file-kind-text" />;
    default:
      return <File size={16} className="file-kind-icon" />;
  }
}

function kindLabel(kind: QueueItem['kind']): string {
  switch (kind) {
    case 'pdf':
      return 'PDF';
    case 'image':
      return '图片';
    case 'text':
      return '文本';
    case 'word':
      return 'Word';
    case 'excel':
      return 'Excel';
    case 'powerpoint':
      return 'PPT';
    default:
      return '文档';
  }
}

function getParentDirectoryName(fullPath: string): string {
  if (!fullPath) return '';
  const normalized = fullPath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length >= 2) {
    return parts[parts.length - 2];
  }
  return '';
}

export function PrintQueue({
  items,
  globalSettings,
  isPrinting,
  onRemove,
  onOpenSettings,
}: PrintQueueProps) {
  // Count duplicate file names to provide disambiguation hints
  const fileNameCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of items) {
      counts[item.fileName] = (counts[item.fileName] || 0) + 1;
    }
    return counts;
  }, [items]);

  const handleCopyPath = async (path: string) => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(path);
        message.success('已复制文件完整路径');
      }
    } catch {
      message.error('复制路径失败');
    }
  };

  const handleShowInFolder = async (path: string) => {
    try {
      await showInFolder(path);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '打开文件夹失败');
    }
  };

  const columns: ColumnsType<QueueItem> = [
    {
      title: '文件',
      dataIndex: 'fileName',
      key: 'fileName',
      render: (fileName: string, record) => {
        const isDuplicate = (fileNameCounts[fileName] || 0) > 1;
        const parentDir = isDuplicate ? getParentDirectoryName(record.path) : '';

        return (
          <div className="queue-file-cell">
            {renderFileIcon(record.kind)}
            <div className="queue-file-info">
              <Tooltip title={record.path} placement="topLeft" mouseEnterDelay={0.3}>
                <span className="queue-file-name">{fileName}</span>
              </Tooltip>
              {isDuplicate && parentDir && (
                <div className="queue-file-disambiguation" title={record.path}>
                  来自：{parentDir}
                </div>
              )}
            </div>
          </div>
        );
      },
    },
    {
      title: '类型',
      dataIndex: 'kind',
      key: 'kind',
      width: 75,
      render: (kind: QueueItem['kind']) => (
        <span className="queue-type-badge">{kindLabel(kind)}</span>
      ),
    },
    {
      title: '页数',
      dataIndex: 'pageCount',
      key: 'pageCount',
      width: 70,
      render: (pageCount: number | null) => (
        <span className="queue-page-count">{pageCount ?? '—'}</span>
      ),
    },
    {
      title: '设置',
      key: 'settings',
      width: 190,
      render: (_, record) => {
        const resolved = mergePrintSettings(globalSettings, record.override);
        const isOverridden = hasFileOverride(record.override);
        return (
          <div className="queue-setting-summary">
            <div className="queue-setting-primary">
              {resolved.colorMode === 'color' ? '彩色' : '黑白'} ·{' '}
              {resolved.sidesMode === 'duplex'
                ? `双面(${resolved.flipMode === 'longEdge' ? '长边' : '短边'})`
                : '单面'}{' '}
              · {resolved.copies}份
            </div>
            <div className="queue-setting-sub">
              {describePageRange(resolved.pageRange)}
              {isOverridden ? (
                <span className="queue-override-tag"> · 单独配置</span>
              ) : null}
            </div>
          </div>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 95,
      render: (status: QueueItem['status'], record) => (
        <div>
          {statusTag(status)}
          {record.errorMessage && (
            <div className="error-text" title={record.errorMessage}>
              {record.errorMessage}
            </div>
          )}
        </div>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 110,
      align: 'right',
      render: (_, record) => {
        const moreMenuItems: MenuProps['items'] = [
          {
            key: 'copy-path',
            icon: <Copy size={13} />,
            label: '复制完整路径',
            onClick: () => void handleCopyPath(record.path),
          },
          {
            key: 'show-folder',
            icon: <FolderOpen size={13} />,
            label: '在文件夹中显示',
            onClick: () => void handleShowInFolder(record.path),
          },
          {
            type: 'divider',
          },
          {
            key: 'remove',
            icon: <Trash2 size={13} />,
            label: '移除文件',
            danger: true,
            disabled: isPrinting,
            onClick: () => onRemove(record.id),
          },
        ];

        return (
          <Space size={4}>
            <Button
              size="small"
              icon={<Settings2 size={13} />}
              disabled={isPrinting}
              onClick={() => onOpenSettings(record.id)}
              title="设置此文件参数"
            >
              设置
            </Button>
            <Dropdown menu={{ items: moreMenuItems }} trigger={['click']} placement="bottomRight">
              <Button
                size="small"
                icon={<MoreHorizontal size={14} />}
                disabled={isPrinting}
                title="更多操作"
              />
            </Dropdown>
          </Space>
        );
      },
    },
  ];

  if (items.length === 0) {
    return (
      <div className="queue-empty-container">
        <div className="queue-empty-inner">
          <div className="queue-empty-icon-wrap">
            <FilePlus2 size={36} />
          </div>
          <div className="queue-empty-title">将文件或文件夹拖到此处</div>
          <div className="queue-empty-desc">
            支持 PDF、图片及 Office 文档（Word、Excel、PPT），可继续批量追加
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="queue-table-wrap">
      <Table
        rowKey="id"
        size="small"
        pagination={false}
        columns={columns}
        dataSource={items}
        className="queue-compact-table"
      />
    </div>
  );
}
