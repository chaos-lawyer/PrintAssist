import { Button, Space } from 'antd';
import { History, Play, PlusCircle, Printer, RotateCcw, SlidersHorizontal } from 'lucide-react';
import type { PrintJobSummary } from '../../domain/queueTypes';

interface CompletionActionsProps {
  summary: PrintJobSummary | null;
  onStartNewBatch: () => void;
  onReprintAll: () => void;
  onRetryFailed: () => void;
  onKeepFailedOnly: () => void;
  onContinueUnfinished: () => void;
  onOpenHistory: () => void;
}

export function CompletionActions({
  summary,
  onStartNewBatch,
  onReprintAll,
  onRetryFailed,
  onKeepFailedOnly,
  onContinueUnfinished,
  onOpenHistory,
}: CompletionActionsProps) {
  if (!summary) {
    return (
      <Space size={12} className="queue-footer-actions">
        <Button type="primary" icon={<PlusCircle size={15} />} onClick={onStartNewBatch}>
          开始新批次
        </Button>
      </Space>
    );
  }

  const isCancelled = summary.skipped > 0 && summary.failed === 0;
  const isFailed = summary.failed > 0;

  if (isCancelled) {
    return (
      <Space size={12} className="queue-footer-actions">
        <Button type="link" icon={<History size={15} />} onClick={onOpenHistory}>
          查看打印记录
        </Button>
        <Button icon={<PlusCircle size={15} />} onClick={onStartNewBatch}>
          结束并开始新批次
        </Button>
        <Button type="primary" icon={<Play size={15} />} onClick={onContinueUnfinished}>
          继续打印未完成项
        </Button>
      </Space>
    );
  }

  if (isFailed) {
    return (
      <Space size={12} className="queue-footer-actions">
        <Button type="link" icon={<History size={15} />} onClick={onOpenHistory}>
          查看打印记录
        </Button>
        <Button type="link" onClick={onStartNewBatch}>
          结束并开始新批次
        </Button>
        <Button icon={<SlidersHorizontal size={15} />} onClick={onKeepFailedOnly}>
          仅保留失败项
        </Button>
        <Button type="primary" icon={<RotateCcw size={15} />} onClick={onRetryFailed}>
          重试 {summary.failed} 个失败项
        </Button>
      </Space>
    );
  }

  // All succeeded
  return (
    <Space size={12} className="queue-footer-actions">
      <Button type="link" icon={<History size={15} />} onClick={onOpenHistory}>
        查看打印记录
      </Button>
      <Button icon={<Printer size={15} />} onClick={onReprintAll}>
        再次打印
      </Button>
      <Button type="primary" icon={<PlusCircle size={15} />} onClick={onStartNewBatch}>
        开始新批次
      </Button>
    </Space>
  );
}
