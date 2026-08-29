import { Alert, Button, List, Space, Typography } from 'antd';
import type { PrintJobSummary } from '../../domain/queueTypes';

interface PrintSummaryProps {
  summary: PrintJobSummary | null;
  onRetryFailed: () => void;
  onClearSucceeded?: () => void;
}

export function PrintSummary({ summary, onRetryFailed, onClearSucceeded }: PrintSummaryProps) {
  if (!summary) {
    return null;
  }

  const failedItems = summary.results.filter((resultItem) => resultItem.status === 'failed');

  return (
    <div className="summary-panel">
      <Alert
        type={summary.failed > 0 ? 'warning' : 'success'}
        showIcon
        message={`打印完成：成功 ${summary.succeeded}，失败 ${summary.failed}，跳过 ${summary.skipped}`}
        description={
          summary.failed > 0
            ? '单项失败不会阻断整批任务。可重试失败项，或先移除已成功项。'
            : '本批任务已全部打印成功。'
        }
        action={
          <Space size={8}>
            {summary.failed > 0 && (
              <Button size="small" type="primary" onClick={onRetryFailed}>
                仅重试失败项
              </Button>
            )}
            {summary.succeeded > 0 && onClearSucceeded && (
              <Button size="small" onClick={onClearSucceeded}>
                {summary.failed > 0 ? '移除成功项' : '清空列表'}
              </Button>
            )}
          </Space>
        }
      />

      {failedItems.length > 0 && (
        <List
          size="small"
          header={<Typography.Text strong>失败明细</Typography.Text>}
          dataSource={failedItems}
          renderItem={(item) => (
            <List.Item>
              <Space direction="vertical" size={0}>
                <Typography.Text>{item.fileName}</Typography.Text>
                <Typography.Text type="secondary">{item.message ?? '未知错误'}</Typography.Text>
              </Space>
            </List.Item>
          )}
        />
      )}
    </div>
  );
}
