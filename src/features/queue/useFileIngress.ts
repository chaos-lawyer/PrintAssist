import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import {
  expandFilePaths,
  pickFiles,
  pickFolderFiles,
  subscribeIncomingFiles,
  subscribeNativeDragDrop,
} from '../../api/nativeBridge';
import type { QueueState } from '../../domain/queueTypes';
import { PRINT_BUSY_MESSAGES } from '../printing/printingMessages';
import type { DuplicateDecision } from './DuplicateConfirmModal';
import { partitionIncomingPaths, type PartitionResult } from './duplicateDetection';
import { queueReducer } from './queueReducer';

export interface UseFileIngressOptions {
  queueState: QueueState;
  canRestoreBatch: boolean;
  setCanRestoreBatch: React.Dispatch<React.SetStateAction<boolean>>;
  previousBatchBackupRef: React.MutableRefObject<any>;
  commit: (label: string, updater: (curr: any) => any) => void;
}

export function useFileIngress(options: UseFileIngressOptions) {
  const { queueState, canRestoreBatch, setCanRestoreBatch, previousBatchBackupRef, commit } = options;

  const [isDragOver, setIsDragOver] = useState(false);
  const [pendingDuplicateResult, setPendingDuplicateResult] = useState<PartitionResult | null>(null);

  const queueStateRef = useRef(queueState);
  queueStateRef.current = queueState;

  const pendingAppendResolverRef = useRef<((decision: DuplicateDecision) => void) | null>(null);
  const ingressQueueRef = useRef<string[][]>([]);
  const isProcessingIngressRef = useRef(false);

  const processIngressQueue = useCallback(async () => {
    if (isProcessingIngressRef.current) return;
    isProcessingIngressRef.current = true;

    try {
      while (ingressQueueRef.current.length > 0) {
        const paths = ingressQueueRef.current.shift();
        if (!paths || paths.length === 0) continue;

        const currentQueue = queueStateRef.current;
        if (currentQueue.isPrinting) {
          message.warning(PRINT_BUSY_MESSAGES.ADD_FILES);
          continue;
        }
        if (currentQueue.phase === 'completed') {
          message.warning('当前批次已完成，请先点击“开始新批次”后再添加新文件');
          continue;
        }

        if (canRestoreBatch) {
          setCanRestoreBatch(false);
          previousBatchBackupRef.current = null;
        }

        const result = partitionIncomingPaths(currentQueue.items, paths);

        let decision: DuplicateDecision = 'all';
        if (result.duplicatePaths.length > 0) {
          decision = await new Promise<DuplicateDecision>((resolve) => {
            pendingAppendResolverRef.current = resolve;
            setPendingDuplicateResult(result);
          });
        }

        if (decision === 'cancel') {
          continue;
        }

        if (decision === 'new-only') {
          if (result.newPaths.length > 0) {
            commit(`添加 ${result.newPaths.length} 个文件`, (curr) => ({
              ...curr,
              queueState: queueReducer(curr.queueState, { type: 'append_files', paths: result.newPaths }),
            }));
            message.success(
              `已添加 ${result.newPaths.length} 个文件，跳过 ${result.duplicatePaths.length} 个重复文件`,
            );
          }
        } else {
          commit(`添加 ${paths.length} 个文件`, (curr) => ({
            ...curr,
            queueState: queueReducer(curr.queueState, { type: 'append_files', paths }),
          }));
          if (result.duplicatePaths.length > 0) {
            message.success(
              `已添加 ${paths.length} 个文件，其中 ${result.duplicatePaths.length} 个为重复文件`,
            );
          } else {
            message.success(`已添加 ${paths.length} 个文件`);
          }
        }
      }
    } finally {
      isProcessingIngressRef.current = false;
    }
  }, [canRestoreBatch, setCanRestoreBatch, previousBatchBackupRef, commit]);

  const requestAppendPaths = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      ingressQueueRef.current.push(paths);
      void processIngressQueue();
    },
    [processIngressQueue],
  );

  const handleDuplicateDecision = (decision: DuplicateDecision) => {
    setPendingDuplicateResult(null);
    pendingAppendResolverRef.current?.(decision);
    pendingAppendResolverRef.current = null;
  };

  useEffect(() => {
    return subscribeIncomingFiles((paths) => {
      if (paths.length > 0) {
        void requestAppendPaths(paths);
      }
    });
  }, [requestAppendPaths]);

  useEffect(() => {
    // Tauri 2: 桌面拖放路径只能从原生 DragDrop 事件拿到，不能依赖 HTML5 File.path
    return subscribeNativeDragDrop({
      onHoverChange: setIsDragOver,
      onDrop: (paths) => {
        if (queueStateRef.current.isPrinting) {
          message.warning(PRINT_BUSY_MESSAGES.ADD_FILES);
          return;
        }
        void (async () => {
          try {
            const expanded = await expandFilePaths(paths);
            if (expanded.length === 0) {
              if (paths.length > 0) {
                message.warning('未找到可打印的文件');
              }
              return;
            }
            void requestAppendPaths(expanded);
          } catch (error) {
            message.error(error instanceof Error ? error.message : '处理拖放文件失败');
          }
        })();
      },
    });
  }, [requestAppendPaths]);

  const handlePickFiles = async () => {
    if (queueStateRef.current.isPrinting) {
      message.warning(PRINT_BUSY_MESSAGES.ADD_FILES);
      return;
    }
    try {
      const paths = await pickFiles();
      if (paths.length > 0) {
        requestAppendPaths(paths);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '选择文件失败');
    }
  };

  const handlePickFolder = async () => {
    if (queueStateRef.current.isPrinting) {
      message.warning(PRINT_BUSY_MESSAGES.ADD_FILES);
      return;
    }
    try {
      const picked = await pickFolderFiles();
      if (picked.length === 0) {
        return;
      }
      requestAppendPaths(picked);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '选择文件夹失败');
    }
  };

  return {
    isDragOver,
    setIsDragOver,
    pendingDuplicateResult,
    requestAppendPaths,
    handlePickFiles,
    handlePickFolder,
    handleDuplicateDecision,
    pendingAppendResolverRef,
    setPendingDuplicateResult,
  };
}
