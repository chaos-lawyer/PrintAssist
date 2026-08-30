import { Alert, List, Space, Typography } from 'antd';
import type { PrintJobSummary } from '../../domain/queueTypes';

interface PrintSummaryProps {
  summary: PrintJobSummary | null;
  totalPages?: number;
}

export function PrintSummary({ summary }: PrintSummaryProps) {
  if (!summary) {
    return null;
  }

  const failedItems = summary.results.filter((resultItem) => resultItem.status === 'failed');
  const isCancelled = summary.skipped > 0 && summary.failed === 0;
  const isFailed = summary.failed > 0;

  // 全部成功时不渲染顶部 Alert，改由底栏紧凑展示
  if (!isCancelled && !isFailed) {
    return null;
  }

  let alertType: 'warning' | 'info' = 'warning';
  let title = '';
  let description = '';

  if (isCancelled) {
    alertType = 'info';
    title = `打印已取消：已完成 ${summary.succeeded} 个，未打印 ${summary.skipped} 个`;
    description = '未打印的文件已保留在列表中，可在下方选择继续打印或结束本批次。';
  } else {
    alertType = 'warning';
    title = `打印完成：成功 ${summary.succeeded} 个，失败 ${summary.failed} 个${summary.skipped > 0 ? `，未打印 ${summary.skipped} 个` : ''}`;
    description = '成功项不会在重试时重复打印。可选择重试失败项或仅保留失败项进行调整。';
  }

  return (
    <div className="summary-panel" role="region" aria-label="打印结果摘要">
      <Alert
        type={alertType}
        showIcon
        message={title}
        description={description}
      />

      {failedItems.length > 0 && (
        <List
          size="small"
          className="summary-failed-list"
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
