import { message } from 'antd';
import {
  pausePrintBatch,
  resumePrintBatch,
  runPrintBatch,
  terminatePrintBatch,
} from '../../api/nativeBridge';
import type { evaluateSettingAvailability, PrintSettings } from '../../domain/printSettings';
import { mergePrintSettings } from '../../domain/printSettings';
import { parsePageRangeExpression } from '../../domain/pageRange';
import type { QueueItem, QueueState } from '../../domain/queueTypes';
import { createPrintSummary, type QueueAction } from '../queue/queueReducer';
import type { PrintQueueItemPayload } from '../../shared/contracts/printJob';
import { savePrintHistoryRecord } from '../history/historyStorage';

export type AvailabilityResult = ReturnType<typeof evaluateSettingAvailability>;

export interface UsePrintExecutionOptions {
  queueState: QueueState;
  globalSettings: PrintSettings;
  availability: AvailabilityResult;
  dispatch: React.Dispatch<QueueAction>;
  clearHistory: () => void;
}

export function usePrintExecution(options: UsePrintExecutionOptions) {
  const { queueState, globalSettings, availability, dispatch, clearHistory } = options;

  const buildBatchPayload = (
    filterMode: 'all' | 'failed' | 'remaining' = 'remaining',
    customItems?: QueueItem[],
  ): PrintQueueItemPayload[] | null => {
    if (!globalSettings.printerName) {
      message.warning('请先选择打印机');
      return null;
    }
    if (!availability.printEnabled) {
      message.error(availability.reasons.join('；') || '当前打印机不可用');
      return null;
    }

    const itemsToFilter = customItems || queueState.items;
    const sourceItems = itemsToFilter.filter((item) => {
      if (item.kind === 'unknown') return false;
      if (filterMode === 'all') {
        return true;
      }
      if (filterMode === 'failed') {
        return item.status === 'failed' || item.status === 'ready';
      }
      return item.status !== 'succeeded';
    });
    if (sourceItems.length === 0) {
      const allSucceeded =
        itemsToFilter.length > 0 &&
        itemsToFilter.every(
          (item) => item.status === 'succeeded' || item.kind === 'unknown',
        ) &&
        itemsToFilter.some((item) => item.status === 'succeeded');
      if (allSucceeded) {
        message.info('当前批次文件均已打印成功，请开始新批次或点击再次打印');
      } else {
        message.warning('没有可打印的文件');
      }
      return null;
    }

    const resolvedItems = sourceItems.map((item) => {
      const resolved = mergePrintSettings(globalSettings, item.override);
      return { item, resolved };
    });

    for (const { item, resolved } of resolvedItems) {
      if (resolved.pageRange.mode === 'custom') {
        const parseResult = parsePageRangeExpression(
          resolved.pageRange.expression,
        );
        if (!parseResult.ok) {
          message.error(`${item.fileName}：${parseResult.message}`);
          return null;
        }
      }
    }

    const payloads: PrintQueueItemPayload[] = [];
    const isGlobalBySet = globalSettings.collateMode === 'bySet' && globalSettings.copies > 1;
    const isNup = Boolean(
      globalSettings.nupLayout &&
      globalSettings.nupLayout.cols * globalSettings.nupLayout.rows > 1,
    );

    if (isGlobalBySet) {
      // 全局逐套模式：当前所有文档打印一次后循环打印，严格统一输出多套
      for (let cycle = 0; cycle < globalSettings.copies; cycle++) {
        for (const { item, resolved } of resolvedItems) {
          payloads.push({
            queueItemId: item.id,
            path: item.path,
            fileName: item.fileName,
            allowAssociationFallback: true,
            settings: {
              printerName: resolved.printerName,
              colorMode: resolved.colorMode,
              sidesMode: resolved.sidesMode,
              flipMode: resolved.flipMode,
              copies: 1,
              collate: true,
              sourceCode: resolved.sourceCode,
              sourceName: resolved.sourceName,
              scaleMode: resolved.scaleMode,
              nupLayout: isNup ? globalSettings.nupLayout : undefined,
              nupScope: isNup ? globalSettings.nupScope : undefined,
              pageRangeMode: resolved.pageRange.mode,
              pageRangeExpression: resolved.pageRange.expression,
              driverProfileId: resolved.driverProfileId,
            },
          });
        }
      }
    } else {
      // 常规逐份或逐页：各文档按序连续打印自身份数
      for (const { item, resolved } of resolvedItems) {
        payloads.push({
          queueItemId: item.id,
          path: item.path,
          fileName: item.fileName,
          allowAssociationFallback: true,
          settings: {
            printerName: resolved.printerName,
            colorMode: resolved.colorMode,
            sidesMode: resolved.sidesMode,
            flipMode: resolved.flipMode,
            copies: resolved.copies,
            collate: resolved.collateMode !== 'byPage',
            sourceCode: resolved.sourceCode,
            sourceName: resolved.sourceName,
            scaleMode: resolved.scaleMode,
            nupLayout: isNup ? globalSettings.nupLayout : undefined,
            nupScope: isNup ? globalSettings.nupScope : undefined,
            pageRangeMode: resolved.pageRange.mode,
            pageRangeExpression: resolved.pageRange.expression,
            driverProfileId: resolved.driverProfileId,
          },
        });
      }
    }
    return payloads;
  };

  const executePrint = async (
    filterMode: 'all' | 'failed' | 'remaining' = 'remaining',
    customItems?: QueueItem[],
  ) => {
    const payloads = buildBatchPayload(filterMode, customItems);
    if (!payloads) {
      return;
    }

    const isNup = Boolean(
      globalSettings.nupLayout &&
      globalSettings.nupLayout.cols * globalSettings.nupLayout.rows > 1,
    );

    clearHistory();
    dispatch({ type: 'begin_print' });
    try {
      const batchResult = await runPrintBatch({
        items: payloads.map((item) => ({ ...item, allowAssociationFallback: true })),
        nupLayout: isNup ? globalSettings.nupLayout : undefined,
        nupScope: isNup ? globalSettings.nupScope : undefined,
      });
      dispatch({ type: 'finish_print', summary: createPrintSummary(batchResult.results) });

      // Save print history record
      savePrintHistoryRecord({
        printerName: globalSettings.printerName,
        totalFiles: batchResult.results.length,
        succeededCount: batchResult.succeeded,
        failedCount: batchResult.failed,
        skippedCount: batchResult.skipped,
        files: batchResult.results.map((r) => ({
          fileName: r.fileName,
          path: r.path,
          status: r.status,
          message: r.message,
        })),
      });

      if (batchResult.failed > 0) {
        const failedItems = batchResult.results.filter((r) => r.status === 'failed');
        const hasOfficeMissing = failedItems.some(
          (r) => r.errorKind === 'office_missing',
        );
        const hasFileLocked = failedItems.some(
          (r) => r.errorKind === 'file_locked' || r.errorKind === 'password_protected',
        );

        if (hasOfficeMissing) {
          message.error({
            content: '部分办公文档打印失败：未检测到可用的 Microsoft Office 或 WPS Office，请安装对应办公套件或转为 PDF 打印',
            duration: 6,
          });
        } else if (hasFileLocked) {
          message.error({
            content: '打印失败：部分文件被其他程序占用或受密码保护，请关闭后重试',
            duration: 5,
          });
        } else {
          message.warning(`完成：成功 ${batchResult.succeeded}，失败 ${batchResult.failed}（可查看下方失败明细）`);
        }
      } else if (batchResult.skipped > 0) {
        message.info(`打印已取消：已完成 ${batchResult.succeeded}，未打印 ${batchResult.skipped}`);
      }
    } catch (error) {
      dispatch({
        type: 'finish_print',
        summary: createPrintSummary(
          payloads.map((item) => ({
            queueItemId: item.queueItemId,
            path: item.path,
            fileName: item.fileName,
            status: 'failed',
            message: error instanceof Error ? error.message : '打印执行失败',
          })),
        ),
      });
      message.error(error instanceof Error ? error.message : '打印执行失败');
    }
  };

  const handlePausePrint = async () => {
    dispatch({ type: 'request_pause' });
    try {
      await pausePrintBatch();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '暂停打印失败');
    }
  };

  const handleResumePrint = async () => {
    dispatch({ type: 'resume_print' });
    try {
      await resumePrintBatch();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '继续打印失败');
    }
  };

  const handleTerminatePrint = async () => {
    dispatch({ type: 'request_terminate' });
    try {
      await terminatePrintBatch();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '终止打印失败');
    }
  };

  const handleReprintAll = () => {
    dispatch({ type: 'prepare_reprint_all' });
    void executePrint('all');
  };

  const handleRetryFailed = () => {
    dispatch({ type: 'retry_failed' });
    void executePrint('failed');
  };

  const handleContinueUnfinished = () => {
    void executePrint('remaining');
  };

  return {
    buildBatchPayload,
    executePrint,
    handlePausePrint,
    handleResumePrint,
    handleTerminatePrint,
    handleReprintAll,
    handleRetryFailed,
    handleContinueUnfinished,
  };
}
