import { Button, Tooltip } from 'antd';
import { Loader2, Pause, Play, Printer, Square } from 'lucide-react';
import React from 'react';
import type { BatchPhase } from '../../domain/queueTypes';

export interface PrintPlaybackControlsProps {
  phase: BatchPhase;
  printEnabled: boolean;
  disabledReason?: string;
  hasItems: boolean;
  onStartPrint: () => void;
  onPausePrint: () => void;
  onResumePrint: () => void;
  onTerminatePrint: () => void;
}

export function PrintPlaybackControls({
  phase,
  printEnabled,
  disabledReason,
  hasItems,
  onStartPrint,
  onPausePrint,
  onResumePrint,
  onTerminatePrint,
}: PrintPlaybackControlsProps) {
  const isPrintingActive =
    phase === 'printing' || phase === 'pausing' || phase === 'paused' || phase === 'terminating';

  const renderTerminateButton = () => {
    if (!isPrintingActive) {
      return null;
    }

    if (phase === 'terminating') {
      return (
        <Button
          danger
          disabled
          className="print-playback-terminate-btn"
          icon={<Loader2 size={14} className="spin-icon" />}
        >
          正在终止
        </Button>
      );
    }

    return (
      <Tooltip title="终止剩余打印任务（已提交内容可能继续输出）">
        <Button
          danger
          className="print-playback-terminate-btn"
          icon={<Square size={14} />}
          onClick={onTerminatePrint}
          aria-label="终止剩余打印"
        >
          终止
        </Button>
      </Tooltip>
    );
  };

  const renderPrimaryButton = () => {
    switch (phase) {
      case 'printing':
        return (
          <Tooltip title="暂停将在当前文件处理完成后生效">
            <Button
              type="primary"
              className="print-playback-primary-btn"
              icon={<Pause size={16} />}
              onClick={onPausePrint}
              aria-label="暂停打印"
            >
              暂停
            </Button>
          </Tooltip>
        );

      case 'pausing':
        return (
          <Button
            type="primary"
            disabled
            className="print-playback-primary-btn"
            icon={<Loader2 size={16} className="spin-icon" />}
          >
            正在暂停
          </Button>
        );

      case 'paused':
        return (
          <Button
            type="primary"
            className="print-playback-primary-btn"
            icon={<Play size={16} />}
            onClick={onResumePrint}
            aria-label="继续打印"
          >
            继续
          </Button>
        );

      case 'terminating':
        return (
          <Button
            type="primary"
            disabled
            className="print-playback-primary-btn"
            icon={<Pause size={16} />}
          >
            暂停
          </Button>
        );

      case 'empty':
      case 'editing':
      default: {
        const canStart = printEnabled && hasItems;
        const btn = (
          <Button
            type="primary"
            className="print-playback-primary-btn"
            icon={<Printer size={16} />}
            disabled={!canStart}
            onClick={onStartPrint}
            aria-label="开始打印"
          >
            开始打印 (Ctrl+P)
          </Button>
        );

        if (!canStart) {
          const reason = !hasItems
            ? '请先在左侧添加要打印的文件'
            : disabledReason || '请选择可用打印机并配置参数';
          return <Tooltip title={reason}>{btn}</Tooltip>;
        }
        return btn;
      }
    }
  };

  return (
    <div className="print-playback-controls">
      {renderTerminateButton()}
      {renderPrimaryButton()}
    </div>
  );
}
