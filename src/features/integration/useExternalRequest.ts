import { useCallback, useEffect, useRef, useState } from 'react';
import { message, Modal } from 'antd';
import {
  loadPrinterProfile,
  subscribeExternalRequests,
  validateSupportedPaths,
} from '../../api/nativeBridge';
import type { PrintSettings } from '../../domain/printSettings';
import { createEmptyQueueState, type QueueItem, type QueueState } from '../../domain/queueTypes';
import type {
  SavedPrinterProfileSummary,
  SystemPrinter,
} from '../../shared/contracts/printer';
import {
  emitExternalRequestResult,
  isRequestAlreadyProcessed,
  recordRequestIdProcessed,
} from '../external/externalRequestHandler';
import type { ExternalRequestV1 } from '../external/externalTypes';
import { resolveFavorite } from '../favorites/favoriteResolver';
import { loadFavorites } from '../favorites/favoriteStorage';
import type { FavoriteTemplateV1 } from '../favorites/favoriteTypes';
import type { PrinterPreferencesV1 } from '../printers/printerPreferences';
import type { DuplicateDecision } from '../queue/DuplicateConfirmModal';
import { partitionIncomingPaths, type PartitionResult } from '../queue/duplicateDetection';
import { queueReducer } from '../queue/queueReducer';

export interface UseExternalRequestOptions {
  queueState: QueueState;
  globalSettingsRef: React.MutableRefObject<PrintSettings>;
  printerPreferencesRef: React.MutableRefObject<PrinterPreferencesV1>;
  systemPrinters: SystemPrinter[];
  savedProfiles: SavedPrinterProfileSummary[];
  commit: (label: string, updater: (curr: any) => any) => void;
  executePrint: (filterMode?: 'all' | 'failed' | 'remaining', customItems?: QueueItem[]) => Promise<void>;
  handleStartNewBatch: () => void;
  pendingAppendResolverRef: React.MutableRefObject<((decision: DuplicateDecision) => void) | null>;
  setPendingDuplicateResult: React.Dispatch<React.SetStateAction<PartitionResult | null>>;
}

export function useExternalRequest(options: UseExternalRequestOptions) {
  const {
    queueState,
    globalSettingsRef,
    printerPreferencesRef,
    systemPrinters,
    savedProfiles,
    commit,
    executePrint,
    handleStartNewBatch,
    pendingAppendResolverRef,
    setPendingDuplicateResult,
  } = options;

  const [externalIntegrationOpen, setExternalIntegrationOpen] = useState(false);
  const pendingExternalQueueRef = useRef<ExternalRequestV1[]>([]);
  const queueStateRef = useRef(queueState);
  queueStateRef.current = queueState;

  const handleExecuteExternalRequest = useCallback(
    async (request: ExternalRequestV1) => {
      if (isRequestAlreadyProcessed(request.requestId)) {
        return;
      }
      recordRequestIdProcessed(request.requestId);

      const currentQueue = queueStateRef.current;

      if (request.action === 'add') {
        if (currentQueue.isPrinting) {
          if (request.busyPolicy === 'enqueue') {
            pendingExternalQueueRef.current.push(request);
            await emitExternalRequestResult(request, {
              status: 'accepted',
              addedCount: request.paths.length,
              skippedCount: 0,
              message: '打印机正忙，添加请求已加入排队队列',
            });
            message.info('外部添加请求已加入排队队列');
            return;
          }
          await emitExternalRequestResult(request, {
            status: 'rejected',
            addedCount: 0,
            skippedCount: request.paths.length,
            message: '打印进行中，已拒绝外部添加请求',
          });
          message.warning('打印进行中，暂不可添加文件');
          return;
        }

        if (currentQueue.phase === 'completed') {
          handleStartNewBatch();
        }

        if (request.paths.length === 0) {
          await emitExternalRequestResult(request, {
            status: 'rejected',
            addedCount: 0,
            skippedCount: 0,
            message: '请求中未包含有效支持的文件路径',
          });
          return;
        }

        let pathsToAdd = request.paths;
        let skippedCount = 0;
        const duplicatePolicy = request.duplicatePolicy || 'ask';

        if (duplicatePolicy === 'skip') {
          const partition = partitionIncomingPaths(currentQueue.items, request.paths);
          pathsToAdd = partition.newPaths;
          skippedCount = partition.duplicatePaths.length;
        } else if (duplicatePolicy === 'ask') {
          const partition = partitionIncomingPaths(currentQueue.items, request.paths);
          if (partition.duplicatePaths.length > 0) {
            const decision = await new Promise<DuplicateDecision>((resolve) => {
              pendingAppendResolverRef.current = resolve;
              setPendingDuplicateResult(partition);
            });
            if (decision === 'cancel') {
              await emitExternalRequestResult(request, {
                status: 'rejected',
                addedCount: 0,
                skippedCount: request.paths.length,
                message: '用户取消了文件追加',
              });
              return;
            }
            pathsToAdd = decision === 'new-only' ? partition.newPaths : request.paths;
            skippedCount = decision === 'new-only' ? partition.duplicatePaths.length : 0;
          }
        }

        if (pathsToAdd.length > 0) {
          commit(`外部添加 ${pathsToAdd.length} 个文件`, (curr) => ({
            ...curr,
            queueState: queueReducer(curr.queueState, {
              type: 'append_files',
              paths: pathsToAdd,
            }),
          }));
        }

        await emitExternalRequestResult(request, {
          status: 'accepted',
          addedCount: pathsToAdd.length,
          skippedCount,
          message: `已成功添加 ${pathsToAdd.length} 个文件${skippedCount > 0 ? `（跳过 ${skippedCount} 个重复项）` : ''}`,
        });
        message.success(`已从外部添加 ${pathsToAdd.length} 个文件`);
        return;
      }

      if (request.action === 'print') {
        if (currentQueue.isPrinting) {
          if (request.busyPolicy === 'enqueue') {
            pendingExternalQueueRef.current.push(request);
            await emitExternalRequestResult(request, {
              status: 'accepted',
              addedCount: request.paths.length,
              skippedCount: 0,
              message: '打印进行中，直接打印请求已加入排队队列',
            });
            message.info('外部直接打印请求已排队');
            return;
          }
          await emitExternalRequestResult(request, {
            status: 'rejected',
            addedCount: 0,
            skippedCount: request.paths.length,
            message: '当前正在打印中，已拒绝直接打印请求',
          });
          message.warning('当前正在打印中，已拒绝外部直接打印请求');
          return;
        }

        // Resolve favorite if provided
        let targetFavorite: FavoriteTemplateV1 | null = null;
        if (request.favoriteId) {
          const allFavorites = loadFavorites();
          targetFavorite = allFavorites.find((f) => f.id === request.favoriteId) || null;
          if (!targetFavorite) {
            await emitExternalRequestResult(request, {
              status: 'failed',
              addedCount: 0,
              skippedCount: request.paths.length,
              message: `未找到 ID 为“${request.favoriteId}”的收藏模板`,
            });
            message.error(`未找到指定的收藏模板（ID: ${request.favoriteId}）`);
            return;
          }
        }

        // Validate paths
        const validated = await validateSupportedPaths(request.paths);
        if (validated.valid.length === 0) {
          await emitExternalRequestResult(request, {
            status: 'failed',
            addedCount: 0,
            skippedCount: request.paths.length,
            message: '请求中的文件路径均不存在或格式不受支持',
          });
          message.error('未找到有效的可打印文件');
          return;
        }

        // If favorite exists, resolve favorite snapshot
        if (targetFavorite) {
          const resolved = await resolveFavorite({
            favorite: targetFavorite,
            currentQueue,
            currentSettings: globalSettingsRef.current,
            systemPrinters,
            printerPreferences: printerPreferencesRef.current,
            savedProfiles,
            loadProfileFn: loadPrinterProfile,
            duplicateDecision: request.duplicatePolicy === 'skip' ? 'new_only' : 'all',
          });

          if (resolved.summary?.warnings && resolved.summary.warnings.length > 0) {
            for (const w of resolved.summary.warnings) {
              message.warning(w);
            }
          }

          // Check printer validity:
          if (targetFavorite.printer?.name) {
            const targetSys = systemPrinters.find((p) => p.name === targetFavorite!.printer!.name);
            if (!targetSys || targetSys.statusCode !== 0) {
              await emitExternalRequestResult(request, {
                status: 'failed',
                addedCount: 0,
                skippedCount: request.paths.length,
                message: `目标打印机“${targetFavorite.printer.name}”未连接或离线`,
              });
              message.error(`目标打印机“${targetFavorite.printer.name}”未连接或离线，直接打印终止`);
              return;
            }
          }
        }

        if (request.confirmBeforePrint) {
          const printerName =
            request.printerName || targetFavorite?.printer?.name || globalSettingsRef.current.printerName;
          const confirmed = await new Promise<boolean>((resolve) => {
            Modal.confirm({
              title: '确认执行外部直接打印',
              content: `准备使用打印机【${printerName}】打印 ${validated.valid.length} 个文件，是否立即开始？`,
              okText: '立即打印',
              cancelText: '取消',
              onOk: () => resolve(true),
              onCancel: () => resolve(false),
            });
          });

          if (!confirmed) {
            await emitExternalRequestResult(request, {
              status: 'rejected',
              addedCount: 0,
              skippedCount: validated.valid.length,
              message: '用户取消了直接打印',
            });
            return;
          }
        }

        if (currentQueue.phase === 'completed') {
          handleStartNewBatch();
        }

        // Append incoming files to queue
        const baseQueue = currentQueue.phase === 'completed' ? createEmptyQueueState() : currentQueue;
        const nextQueue = queueReducer(baseQueue, {
          type: 'append_files',
          paths: validated.valid,
        });

        commit(`外部直接打印 ${validated.valid.length} 个文件`, (curr) => ({
          ...curr,
          queueState: nextQueue,
        }));

        await emitExternalRequestResult(request, {
          status: 'accepted',
          addedCount: validated.valid.length,
          skippedCount: validated.unsupported.length,
          message: `直接打印任务已启动（${validated.valid.length} 个文件）`,
        });

        // Trigger print execution directly passing next items (eliminating P0-01 setTimeout race condition)
        void executePrint('remaining', nextQueue.items);
      }
    },
    [
      systemPrinters,
      savedProfiles,
      globalSettingsRef,
      printerPreferencesRef,
      commit,
      executePrint,
      handleStartNewBatch,
      pendingAppendResolverRef,
      setPendingDuplicateResult,
    ],
  );

  useEffect(() => {
    return subscribeExternalRequests((req) => {
      void handleExecuteExternalRequest(req);
    });
  }, [handleExecuteExternalRequest]);

  useEffect(() => {
    if (queueState.phase === 'completed' && pendingExternalQueueRef.current.length > 0) {
      const nextReq = pendingExternalQueueRef.current.shift();
      if (nextReq) {
        void handleExecuteExternalRequest(nextReq);
      }
    }
  }, [queueState.phase, handleExecuteExternalRequest]);

  return {
    externalIntegrationOpen,
    setExternalIntegrationOpen,
    handleExecuteExternalRequest,
  };
}
