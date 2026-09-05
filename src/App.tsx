import {
  Button,
  ConfigProvider,
  Layout,
  Modal,
  Progress,
  Space,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  Bookmark,
  CheckCircle2,
  CircleHelp,
  Clock,
  FilePlus2,
  FolderPlus,
  Printer,
  Settings2,
  SlidersHorizontal,
  Terminal,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import {
  getFileMetadata,
  isTauriRuntime,
  loadPrinterProfile,
  subscribePrintItemEvents,
} from './api/nativeBridge';
import { AppLogo } from './components/AppLogo';
import { PrintHistoryModal } from './features/history/PrintHistoryModal';
import { historyRecordToFavoriteTemplate } from './features/history/historyStorage';
import { AddFavoriteModal, type AddFavoriteModalInitialData } from './features/favorites/AddFavoriteModal';
import { FavoritesModal } from './features/favorites/FavoritesModal';
import { addFavorite, loadFavorites, updateFavorite } from './features/favorites/favoriteStorage';
import { resolveFavorite } from './features/favorites/favoriteResolver';
import { ExternalIntegrationSettingsModal } from './features/settings/ExternalIntegrationSettingsModal';
import type {
  FavoriteTemplateV1,
  FavoriteTaskSnapshot,
  FavoritePrinterRef,
  FavoritePrintConfig,
  FavoriteStandardSettings,
} from './features/favorites/favoriteTypes';
import { usePrinterManagement } from './features/printers/usePrinterManagement';
import { useSavedProfiles } from './features/settings/useSavedProfiles';
import { useFileIngress } from './features/queue/useFileIngress';
import { useReferencePageCounts } from './features/queue/useReferencePageCounts';
import { usePrintExecution } from './features/printing/usePrintExecution';
import { useExternalRequest } from './features/integration/useExternalRequest';
import { useKeyboardShortcuts } from './features/shortcuts/useKeyboardShortcuts';
import { PrintPlaybackControls } from './features/queue/PrintPlaybackControls';
import {
  applyLoadedPersistentProfile,
  createDefaultGlobalSettings,
  isProfileDirty,
  mergePrintSettings,
  sanitizeSettingsForPrinter,
  type PrintSettings,
} from './domain/printSettings';
import {
  createEmptyQueueState,
  type BatchPhase,
  type PrintJobSummary,
  type QueueItem,
  type QueueSortField,
} from './domain/queueTypes';
import { parsePageRangeExpression } from './domain/pageRange';
import { PrintQueue } from './features/queue/PrintQueue';
import {
  type QueueColumnKey,
  getStoredVisibleColumns,
  getVisibleSortableColumns,
} from './features/queue/queueColumns';
import {
  createCloneItem,
  queueReducer,
  type QueueItemSnapshot,
} from './features/queue/queueReducer';
import {
  partitionIncomingPaths,
  type PartitionResult,
} from './features/queue/duplicateDetection';
import {
  DuplicateConfirmModal,
  type DuplicateDecision,
} from './features/queue/DuplicateConfirmModal';
import { PrintSummary } from './features/results/PrintSummary';
import { CompletionActions } from './features/results/CompletionActions';
import { FileSettingsDrawer } from './features/settings/FileSettingsDrawer';
import { GlobalSettingsPanel } from './features/settings/GlobalSettingsPanel';
import { SavePrinterProfileModal } from './features/settings/SavePrinterProfileModal';
import { PrinterProfileManagerModal } from './features/settings/PrinterProfileManagerModal';
import { PrinterManagerModal } from './features/printers/PrinterManagerModal';
import { ShortcutHelpModal } from './features/shortcuts/ShortcutHelpModal';
import { useUndoHistory } from './features/undo/useUndoHistory';
import { UndoRedoControls } from './features/undo/UndoRedoControls';
import type { WorkspaceSnapshot } from './features/undo/undoTypes';
import type {
  SavedPrinterProfileSummary,
  SystemPrinter,
} from './shared/contracts/printer';

const { Header, Content, Sider } = Layout;

export function App() {
  const [queueState, dispatch] = useReducer(queueReducer, undefined, createEmptyQueueState);
  const { refreshReferencePageCounts } = useReferencePageCounts({
    items: queueState.items,
    isPrinting: queueState.isPrinting,
    dispatch,
  });
  const [globalSettings, setGlobalSettings] = useState<PrintSettings>(createDefaultGlobalSettings);
  const globalSettingsRef = useRef(globalSettings);
  globalSettingsRef.current = globalSettings;

  const [settingsItemId, setSettingsItemId] = useState<string | null>(null);
  const [isBatchSettingsOpen, setIsBatchSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [favoritesModalOpen, setFavoritesModalOpen] = useState(false);
  const [addFavoriteModalOpen, setAddFavoriteModalOpen] = useState(false);
  const [addFavoritePrefill, setAddFavoritePrefill] = useState<AddFavoriteModalInitialData | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const previousBatchBackupRef = useRef<{
    items: QueueItem[];
    summary: PrintJobSummary | null;
    phase: BatchPhase;
  } | null>(null);
  const [canRestoreBatch, setCanRestoreBatch] = useState(false);
  const [siderWidth, setSiderWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('printassist_sider_width');
      if (saved) {
        const val = Number(saved);
        if (val >= 280 && val <= 600) return val;
      }
    } catch {
      // ignore
    }
    return 360;
  });
  const [isResizingSplitter, setIsResizingSplitter] = useState(false);

  const handleSplitterMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingSplitter(true);
    const startX = e.clientX;
    const startWidth = siderWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();
      const delta = startX - moveEvent.clientX;
      const minSider = 280;
      const maxSider = Math.min(600, Math.floor(window.innerWidth * 0.45));
      const nextWidth = Math.max(minSider, Math.min(maxSider, startWidth + delta));
      setSiderWidth(nextWidth);
    };

    const handleMouseUp = () => {
      setIsResizingSplitter(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      setSiderWidth((latest) => {
        try {
          localStorage.setItem('printassist_sider_width', String(latest));
        } catch {
          // ignore
        }
        return latest;
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleSplitterDoubleClick = () => {
    setSiderWidth(320);
    try {
      localStorage.setItem('printassist_sider_width', '320');
    } catch {
      // ignore
    }
  };

  const [visibleColumns, setVisibleColumns] = useState<QueueColumnKey[]>(getStoredVisibleColumns);
  const visibleSortableColumns = useMemo(
    () => getVisibleSortableColumns(visibleColumns),
    [visibleColumns],
  );

  const currentSnapshotRef = useRef<WorkspaceSnapshot>({
    queueState,
    globalSettings,
    selectedRowKeys: selectedRowKeys.map(String),
    activeId,
  });
  currentSnapshotRef.current = {
    queueState,
    globalSettings,
    selectedRowKeys: selectedRowKeys.map(String),
    activeId,
  };

  const [announcement, setAnnouncement] = useState<string>('');

  const isUndoLocked =
    queueState.isPrinting ||
    queueState.phase === 'pausing' ||
    queueState.phase === 'paused' ||
    queueState.phase === 'terminating';

  const applyWorkspaceSnapshot = useCallback((snapshot: WorkspaceSnapshot) => {
    dispatch({ type: 'restore_snapshot', state: snapshot.queueState });
    setGlobalSettings(snapshot.globalSettings);
    const validIds = new Set(snapshot.queueState.items.map((i) => i.id));
    setSelectedRowKeys(snapshot.selectedRowKeys.filter((id) => validIds.has(id)));
    setActiveId(snapshot.activeId && validIds.has(snapshot.activeId) ? snapshot.activeId : null);
  }, []);

  const {
    commit,
    undo,
    redo,
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
    clearHistory,
  } = useUndoHistory({
    getCurrentSnapshot: () => currentSnapshotRef.current,
    onRestore: (snapshot) => {
      applyWorkspaceSnapshot(snapshot);
      currentSnapshotRef.current = snapshot;
    },
    isLocked: isUndoLocked,
  });

  const handleUndo = useCallback(() => {
    const label = undo();
    if (label) {
      setAnnouncement(`已撤销：${label}`);
    }
  }, [undo]);

  const handleRedo = useCallback(() => {
    const label = redo();
    if (label) {
      setAnnouncement(`已重做：${label}`);
    }
  }, [redo]);

  useEffect(() => {
    try {
      localStorage.removeItem('printassist_auto_clear_on_success');
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    // 软件启动时确保窗口和主工作区获得焦点，使用户无需先点击鼠标即可立即触发快捷键
    const focusWorkspace = () => {
      window.focus();
      const queueWrap = document.querySelector(
        '.queue-table-wrap, .queue-empty-container',
      ) as HTMLElement | null;
      if (queueWrap) {
        queueWrap.focus({ preventScroll: true });
      }
    };

    focusWorkspace();
    // WebView2 首次绘制可能晚于 React 挂载；重复聚焦以覆盖空队列和延迟布局。
    const timers = [50, 200, 500, 900, 1200].map((delay) => setTimeout(focusWorkspace, delay));
    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    const paths = [...new Set(queueState.items.filter((item) => !item.metadataLoaded).map((item) => item.path))];
    if (paths.length === 0) return;
    let cancelled = false;
    void getFileMetadata(paths)
      .then((entries) => {
        if (cancelled) return;
        dispatch({
          type: 'set_file_metadata',
          metadata: Object.fromEntries(entries.map((entry) => [entry.path, entry])),
        });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'set_file_metadata', metadata: {} });
      });
    return () => { cancelled = true; };
  }, [queueState.items]);

  const settingsItem = queueState.items.find((item) => item.id === settingsItemId) ?? null;
  const selectedItems = useMemo(
    () => queueState.items.filter((item) => selectedRowKeys.includes(item.id)),
    [queueState.items, selectedRowKeys],
  );

  const pageStats = useMemo(() => {
    let knownPages = 0;
    let knownCount = 0;
    let estimatedSheets = 0;
    let hasUncalculableItem = false;

    const nupSlots =
      globalSettings.nupLayout && globalSettings.nupLayout.cols * globalSettings.nupLayout.rows > 1
        ? globalSettings.nupLayout.cols * globalSettings.nupLayout.rows
        : 1;
    const isCrossFile = nupSlots > 1 && globalSettings.nupScope === 'crossFile';

    let totalCrossPages = 0;

    for (const item of queueState.items) {
      if (typeof item.pageCount === 'number' && item.pageCount > 0) {
        knownPages += item.pageCount;
        knownCount += 1;

        const resolved = mergePrintSettings(globalSettings, item.override);
        let pagesToPrint = item.pageCount;
        if (resolved.pageRange.mode === 'custom') {
          const parsed = parsePageRangeExpression(resolved.pageRange.expression, item.pageCount);
          if (parsed.ok && parsed.pages.length > 0) {
            pagesToPrint = parsed.pages.length;
          } else {
            hasUncalculableItem = true;
          }
        }

        if (isCrossFile) {
          totalCrossPages += pagesToPrint;
        } else {
          const logicalSides = Math.ceil(pagesToPrint / nupSlots);
          const sheetsPerCopy =
            resolved.sidesMode === 'duplex' ? Math.ceil(logicalSides / 2) : logicalSides;
          estimatedSheets += sheetsPerCopy * (resolved.copies || 1);
        }
      } else {
        hasUncalculableItem = true;
      }
    }

    if (isCrossFile && !hasUncalculableItem) {
      const logicalSides = Math.ceil(totalCrossPages / nupSlots);
      const sheetsPerCopy =
        globalSettings.sidesMode === 'duplex' ? Math.ceil(logicalSides / 2) : logicalSides;
      estimatedSheets = sheetsPerCopy * (globalSettings.copies || 1);
    }

    const allKnown = queueState.items.length > 0 && knownCount === queueState.items.length;
    const canEstimateSheets = queueState.items.length > 0 && !hasUncalculableItem;
    return { knownPages, knownCount, estimatedSheets, allKnown, canEstimateSheets };
  }, [queueState.items, globalSettings]);

  const {
    savedProfiles,
    loadingSavedProfiles,
    sessionProfiles,
    saveModalOpen,
    setSaveModalOpen,
    managerModalOpen,
    setManagerModalOpen,
    loadingProperties,
    activeProfile,
    fetchSavedProfiles,
    handleOpenPrinterProperties,
    handleSelectSavedProfile,
    handleProfileSaved,
  } = useSavedProfiles({
    globalSettings,
    setGlobalSettings,
    commit,
  });

  const handleSelectPrinterRef = useRef<(name: string) => Promise<void>>(() => Promise.resolve());

  const onPrinterAutoSelected = useCallback(
    async (preferredName: string) => {
      const profiles = await fetchSavedProfiles(preferredName);
      const defaultProfile = profiles.find(
        (p) => p.isDefault && p.compatibility === 'compatible',
      );
      if (defaultProfile) {
        try {
          const loaded = await loadPrinterProfile(defaultProfile.id);
          setGlobalSettings((latest) => {
            if (latest.persistentProfileId && latest.printerName === preferredName) {
              return latest;
            }
            return applyLoadedPersistentProfile(latest, loaded);
          });
        } catch {
          // ignore
        }
      }
    },
    [fetchSavedProfiles, setGlobalSettings],
  );

  const {
    systemPrinters,
    loadingPrinters,
    printerPreferences,
    printerPreferencesRef,
    printerManagerOpen,
    setPrinterManagerOpen,
    orderedPrinters,
    visiblePrinters,
    printers,
    selectedPrinter,
    availability,
    refreshPrinters,
    handleSavePrinterPreferences,
  } = usePrinterManagement({
    globalSettingsRef,
    setGlobalSettings,
    onPrinterAutoSelected,
    onSelectPrinterFallback: (fallbackName) => handleSelectPrinterRef.current(fallbackName),
  });

  const handleSelectPrinter = useCallback(
    async (nextPrinterName: string) => {
      const printer = systemPrinters.find((item) => item.name === nextPrinterName);
      if (!printer) return;

      const baseSettings = sanitizeSettingsForPrinter(
        {
          ...globalSettingsRef.current,
          printerName: nextPrinterName,
          persistentProfileId: undefined,
          persistentProfileName: undefined,
          driverProfileId: undefined,
          driverSummary: undefined,
          profileDirty: false,
        },
        printer,
      );

      commit(`切换打印机“${nextPrinterName}”`, (curr) => ({
        ...curr,
        globalSettings: baseSettings,
      }));

      const index = visiblePrinters.findIndex((p) => p.name === nextPrinterName);
      if (index >= 0) {
        message.info(`已切换打印机：${nextPrinterName} (${index + 1} / ${visiblePrinters.length})`);
      } else {
        message.info(`已切换打印机：${nextPrinterName}`);
      }

      const profiles = await fetchSavedProfiles(nextPrinterName);
      const defaultProfile = profiles.find(
        (p) => p.isDefault && p.compatibility === 'compatible',
      );
      if (defaultProfile) {
        try {
          const loaded = await loadPrinterProfile(defaultProfile.id);
          commit(`应用配置“${defaultProfile.name}”`, (curr) => ({
            ...curr,
            globalSettings: applyLoadedPersistentProfile(curr.globalSettings, loaded),
          }));
        } catch {
          // ignore
        }
      }
    },
    [systemPrinters, visiblePrinters, commit, fetchSavedProfiles],
  );
  handleSelectPrinterRef.current = handleSelectPrinter;

  const {
    isDragOver,
    setIsDragOver,
    pendingDuplicateResult,
    requestAppendPaths,
    handlePickFiles,
    handlePickFolder,
    handleDuplicateDecision,
    pendingAppendResolverRef,
    setPendingDuplicateResult,
  } = useFileIngress({
    queueState,
    canRestoreBatch,
    setCanRestoreBatch,
    previousBatchBackupRef,
    commit,
  });

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (queueState.isPrinting) {
      message.warning('打印进行中，暂不可添加文件');
      return;
    }
    if (isTauriRuntime()) {
      return;
    }
    const paths = Array.from(event.dataTransfer.files)
      .map((file) => (file as File & { path?: string }).path)
      .filter((path): path is string => Boolean(path));
    if (paths.length === 0) {
      message.warning('浏览器预览无法获取本地路径，请在桌面应用中拖放，或使用选择按钮');
      return;
    }
    void requestAppendPaths(paths);
  };

  const handleLoadFavorite = useCallback(
    async (favorite: FavoriteTemplateV1, resolution?: 'new_only' | 'all') => {
      if (queueState.isPrinting) {
        message.warning('打印进行中，暂不可加载收藏');
        return;
      }

      let activeResolution: 'needs_decision' | 'new_only' | 'all' = resolution ?? 'needs_decision';

      if (activeResolution === 'needs_decision' && favorite.task?.items && favorite.task.items.length > 0) {
        const partition = partitionIncomingPaths(
          queueState.items,
          favorite.task.items.map((i) => i.path),
        );
        if (partition.duplicatePaths.length > 0) {
          const decision = await new Promise<DuplicateDecision>((resolve) => {
            pendingAppendResolverRef.current = resolve;
            setPendingDuplicateResult(partition);
          });
          if (decision === 'cancel') return;
          activeResolution = decision === 'new-only' ? 'new_only' : 'all';
        } else {
          activeResolution = 'all';
        }
      }

      const result = await resolveFavorite({
        favorite,
        currentQueue: queueState,
        currentSettings: globalSettingsRef.current,
        systemPrinters,
        printerPreferences: printerPreferencesRef.current,
        savedProfiles,
        loadProfileFn: loadPrinterProfile,
        duplicateDecision: activeResolution === 'needs_decision' ? 'all' : activeResolution,
      });

      if (result.summary?.missingFilesCount && result.summary.missingFilesCount > 0) {
        message.warning(`收藏中的 ${result.summary.missingFilesCount} 个文件在本地已不存在，已跳过`);
      }
      if (result.summary?.warnings && result.summary.warnings.length > 0) {
        for (const w of result.summary.warnings) {
          message.info(w);
        }
      }

      if (result.nextSnapshot) {
        commit(`加载收藏“${favorite.name}”`, () => result.nextSnapshot!);
        message.success(`已加载收藏“${favorite.name}”`);
      }
    },
    [queueState, systemPrinters, savedProfiles, commit],
  );

  const handleSaveFavorite = useCallback(
    (templateData: Omit<FavoriteTemplateV1, 'id' | 'createdAt' | 'updatedAt' | 'order' | 'schemaVersion'>) => {
      const added = addFavorite(templateData);
      message.success(`已创建收藏“${added.name}”`);
    },
    [],
  );

  const handleUpdateFavoriteToCurrent = useCallback(
    (favorite: FavoriteTemplateV1) => {
      const currentGlobal = globalSettingsRef.current;
      const stdSettings: FavoriteStandardSettings = {
        colorMode: currentGlobal.colorMode,
        sidesMode: currentGlobal.sidesMode,
        flipMode: currentGlobal.flipMode,
        copies: currentGlobal.copies,
        collateMode: currentGlobal.collateMode,
        collate: currentGlobal.collate,
        sourceCode: currentGlobal.sourceCode,
        sourceName: currentGlobal.sourceName,
        scaleMode: currentGlobal.scaleMode,
        nupLayout: currentGlobal.nupLayout,
        nupScope: currentGlobal.nupScope,
        pageRange: currentGlobal.pageRange,
      };

      const nextTask: FavoriteTaskSnapshot | null =
        queueState.items.length > 0
          ? {
              items: queueState.items.map((it) => ({
                path: it.path,
                fileName: it.fileName,
                kind: it.kind,
                pageCount: it.pageCount,
                override: it.override ? { ...it.override } : {},
              })),
            }
          : null;

      const nextPrinter: FavoritePrinterRef | null = currentGlobal.printerName
        ? { name: currentGlobal.printerName }
        : null;

      const nextConfig: FavoritePrintConfig | null = {
        persistentProfileId: currentGlobal.persistentProfileId,
        persistentProfileName: currentGlobal.persistentProfileName,
        standardSettings: stdSettings,
      };

      updateFavorite(favorite.id, {
        task: favorite.task ? nextTask : null,
        printer: favorite.printer ? nextPrinter : null,
        printConfig: favorite.printConfig ? nextConfig : null,
      });

      message.success(`已将收藏“${favorite.name}”更新为当前状态`);
    },
    [queueState.items],
  );

  const {
    buildBatchPayload,
    executePrint,
    handlePausePrint,
    handleResumePrint,
    handleTerminatePrint,
    handleReprintAll,
    handleRetryFailed,
    handleContinueUnfinished,
  } = usePrintExecution({
    queueState,
    globalSettings,
    availability,
    dispatch,
    clearHistory,
  });

  const handleStartNewBatch = () => {
    commit('开始新批次', (curr) => ({
      ...curr,
      queueState: queueReducer(curr.queueState, { type: 'start_new_batch' }),
      selectedRowKeys: [],
      activeId: null,
    }));
    setCanRestoreBatch(true);
  };

  const handleRestorePreviousBatch = () => {
    handleUndo();
    setCanRestoreBatch(false);
  };

  const handleKeepFailedOnly = () => {
    commit('仅保留失败项', (curr) => ({
      ...curr,
      queueState: queueReducer(curr.queueState, { type: 'keep_failed_only' }),
      selectedRowKeys: [],
      activeId: null,
    }));
    message.info('已移除成功文件，仅保留待处理项');
  };

  const handleRemoveItems = useCallback(
    (idsToRemove: string[]) => {
      if (idsToRemove.length === 0 || queueState.isPrinting) return;
      const count = idsToRemove.length;
      const label = count === 1 ? '移除 1 个文件' : `移除 ${count} 个文件`;
      const idSet = new Set(idsToRemove);

      commit(label, (curr) => ({
        ...curr,
        queueState: queueReducer(curr.queueState, { type: 'batch_remove', ids: idsToRemove }),
        selectedRowKeys: curr.selectedRowKeys.filter((k) => !idSet.has(k)),
        activeId: curr.activeId && idSet.has(curr.activeId) ? null : curr.activeId,
      }));

      message.info({
        content: (
          <span className="undo-toast-content">
            <span>{`已${label}`}</span>
            <Button
              type="link"
              size="small"
              className="undo-toast-btn"
              onClick={() => {
                message.destroy('queue_undo_toast');
                handleUndo();
              }}
            >
              撤销
            </Button>
          </span>
        ),
        key: 'queue_undo_toast',
        duration: 4,
      });
    },
    [queueState.isPrinting, commit, handleUndo],
  );

  const handleRemoveItem = useCallback(
    (id: string) => {
      handleRemoveItems([id]);
    },
    [handleRemoveItems],
  );

  const handleBatchRemove = useCallback(() => {
    handleRemoveItems(selectedRowKeys as string[]);
  }, [handleRemoveItems, selectedRowKeys]);

  const handleClearQueue = useCallback(() => {
    if (queueState.items.length === 0 || queueState.isPrinting) return;
    const count = queueState.items.length;
    const label = `清空 ${count} 个文件`;

    commit(label, (curr) => ({
      ...curr,
      queueState: queueReducer(curr.queueState, { type: 'clear_queue' }),
      selectedRowKeys: [],
      activeId: null,
    }));

    message.info({
      content: (
        <span className="undo-toast-content">
          <span>{`已${label}`}</span>
          <Button
            type="link"
            size="small"
            className="undo-toast-btn"
            onClick={() => {
              message.destroy('queue_undo_toast');
              handleUndo();
            }}
          >
            撤销
          </Button>
        </span>
      ),
      key: 'queue_undo_toast',
      duration: 4,
    });
  }, [queueState.items.length, queueState.isPrinting, commit, handleUndo]);

  const handleCloneItems = useCallback(
    (sourceIds: string[], targetId: string, position: 'before' | 'after') => {
      commit(`克隆 ${sourceIds.length} 个文件`, (curr) => ({
        ...curr,
        queueState: queueReducer(curr.queueState, {
          type: 'clone_items',
          sourceIds,
          targetId,
          position,
        }),
      }));
    },
    [commit],
  );

  const handlePasteSnapshots = useCallback(
    (snapshots: QueueItemSnapshot[], targetId: string | null) => {
      if (snapshots.length === 0) return [];
      const clones = snapshots.map(createCloneItem);
      const newIds = clones.map((c) => c.id);
      commit(`粘贴 ${clones.length} 个文件`, (curr) => ({
        ...curr,
        queueState: queueReducer(curr.queueState, {
          type: 'insert_items',
          items: clones,
          targetId,
        }),
        selectedRowKeys: newIds,
      }));
      return newIds;
    },
    [commit],
  );

  const handleReorderItems = useCallback(
    (movingIds: string[], targetId: string, position: 'before' | 'after') => {
      commit(`移动 ${movingIds.length} 个文件`, (curr) => ({
        ...curr,
        queueState: queueReducer(curr.queueState, {
          type: 'reorder_items',
          movingIds,
          targetId,
          position,
        }),
      }));
    },
    [commit],
  );

  const handleToggleSort = useCallback(
    (field: QueueSortField) => {
      commit('调整文件排序', (curr) => ({
        ...curr,
        queueState: queueReducer(curr.queueState, { type: 'toggle_sort', field }),
      }));
    },
    [commit],
  );

  const {
    externalIntegrationOpen,
    setExternalIntegrationOpen,
    handleExecuteExternalRequest,
  } = useExternalRequest({
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
  });

  const {
    customShortcuts,
    setCustomShortcuts,
    setTargetShortcut,
    isShortcutHelpOpen,
    setIsShortcutHelpOpen,
  } = useKeyboardShortcuts({
    queueState,
    globalSettings,
    availability,
    selectedPrinter,
    visiblePrinters,
    savedProfiles,
    loadingSavedProfiles,
    selectedRowKeys,
    activeId,
    visibleSortableColumns,
    commit,
    executePrint,
    handleUndo,
    handleRedo,
    handleBatchRemove,
    handleClearQueue,
    setSelectedRowKeys,
    handlePickFiles,
    handlePickFolder,
    setHistoryOpen,
    setIsBatchSettingsOpen,
    setSettingsItemId,
    handleSelectPrinter,
    handleSelectSavedProfile,
    handleToggleSort,
    handleLoadFavorite,
    setFavoritesModalOpen,
    setAddFavoriteModalOpen,
    setAddFavoritePrefill,
  });

  // 监听单文件打印实时进度事件
  useEffect(() => {
    const unsubscribe = subscribePrintItemEvents({
      onItemStarted: (event) => {
        dispatch({
          type: 'set_item_status',
          id: event.queueItemId,
          status: 'printing',
        });
      },
      onItemFinished: (event) => {
        dispatch({
          type: 'set_item_status',
          id: event.queueItemId,
          status: event.status,
          errorMessage: event.message,
        });
      },
      onBatchStateChanged: (event) => {
        if (event.state === 'paused') {
          dispatch({ type: 'confirm_paused' });
        }
      },
    });
    return unsubscribe;
  }, []);

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#1557d0',
          colorText: '#172033',
          colorBorder: '#d7e0ec',
          colorBorderSecondary: '#e8eef5',
          colorBgContainer: '#ffffff',
          colorBgLayout: '#f4f7fb',
          borderRadius: 10,
          borderRadiusLG: 14,
          borderRadiusSM: 8,
          borderRadiusXS: 6,
          controlHeight: 34,
          fontFamily: '"Segoe UI Variable", "Microsoft YaHei UI", sans-serif',
          boxShadow: '0 4px 16px rgba(23, 32, 51, 0.06)',
          boxShadowSecondary: '0 8px 24px rgba(23, 32, 51, 0.08)',
          motionDurationMid: '0.2s',
          motionDurationSlow: '0.28s',
        },
        components: {
          Button: {
            borderRadius: 10,
            controlHeight: 34,
            paddingInline: 14,
          },
          Input: {
            borderRadius: 10,
          },
          Select: {
            borderRadius: 10,
          },
          Segmented: {
            borderRadius: 10,
            borderRadiusSM: 8,
          },
          Card: {
            borderRadiusLG: 14,
          },
          Modal: {
            borderRadiusLG: 16,
          },
          Drawer: {
            borderRadiusLG: 16,
          },
          Tag: {
            borderRadiusSM: 999,
          },
          Alert: {
            borderRadiusLG: 12,
          },
          Table: {
            borderRadius: 12,
            headerBorderRadius: 12,
          },
        },
      }}
    >
      <Layout
        className="app-shell"
        onContextMenu={(e) => {
          const target = e.target as HTMLElement | null;
          const isEditable =
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            Boolean(target?.isContentEditable);
          if (!isEditable && !e.defaultPrevented) {
            e.preventDefault();
          }
        }}
      >
        <Header className="app-header">
          <div className="brand-group">
            <div className="brand-mark">
              <AppLogo size={30} />
            </div>
            <div className="brand-copy">
              <Typography.Title level={4}>打印助手</Typography.Title>
              <Typography.Text>
                当前批次 · {queueState.items.length} 个文件
                {queueState.isPrinting ? ' · 打印中' : ''}
                {' · v'}{__APP_VERSION__}
              </Typography.Text>
            </div>
          </div>
          <Space className="header-actions" size={8}>
            <UndoRedoControls
              canUndo={canUndo}
              canRedo={canRedo}
              undoLabel={undoLabel}
              redoLabel={redoLabel}
              onUndo={handleUndo}
              onRedo={handleRedo}
            />
            <Tooltip title="常用模板与任务（B）">
              <Button
                type="text"
                className="header-favorites-btn"
                icon={<Bookmark size={16} />}
                onClick={() => setFavoritesModalOpen(true)}
                aria-label="常用模板与任务"
              >
                常用模板
              </Button>
            </Tooltip>
            <Tooltip title="打印历史（H）">
              <Button
                type="text"
                className="header-history-btn"
                icon={<Clock size={16} />}
                onClick={() => setHistoryOpen(true)}
                aria-label="打印历史"
              >
                打印记录
              </Button>
            </Tooltip>
            <Tooltip title="快捷键帮助（/）">
              <Button
                type="text"
                className="header-help-btn"
                icon={<CircleHelp size={16} />}
                onClick={() => setIsShortcutHelpOpen(true)}
                aria-label="快捷键帮助"
              />
            </Tooltip>
            <Tooltip title="外部集成 / Quicker 与系统右键">
              <Button
                type="text"
                className="header-external-integration-btn"
                icon={<Terminal size={16} />}
                onClick={() => setExternalIntegrationOpen(true)}
                aria-label="外部集成"
              />
            </Tooltip>
          </Space>
        </Header>
        <Layout className="app-body">
          <div className="workspace-main-column">
          <Content
            className={`queue-panel${isDragOver ? ' is-drag-over' : ''}`}
            onDragOver={(event) => {
              if (!event.dataTransfer?.types?.includes('Files')) {
                return;
              }
              event.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={(event) => {
              // Only reset if cursor left the queue panel entirely
              const currentTarget = event.currentTarget;
              const relatedTarget = event.relatedTarget as Node | null;
              if (!currentTarget.contains(relatedTarget)) {
                setIsDragOver(false);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragOver(false);
              handleDrop(event);
            }}
          >
            {isDragOver && (
              <div className={`queue-drop-overlay${queueState.isPrinting ? ' is-disabled' : ''}`}>
                <div className="queue-drop-overlay-content">
                  <FilePlus2 size={44} className="queue-drop-overlay-icon" />
                  <div className="queue-drop-overlay-title">
                    {queueState.isPrinting
                      ? '打印进行中，暂不可添加文件'
                      : '释放以追加到当前批次'}
                  </div>
                  <div className="queue-drop-overlay-desc">
                    {queueState.isPrinting
                      ? '请等待当前打印任务完成'
                      : '支持 PDF、图片及 Office 文档（Word、Excel、PPT）'}
                  </div>
                </div>
              </div>
            )}
            <div className="queue-heading">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Typography.Title level={4} className="queue-main-title">
                  1. 文件队列
                </Typography.Title>
                {queueState.items.length > 0 && (
                  <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                    {queueState.items.length} 个文件
                    {pageStats.allKnown
                      ? ` · 参考总页数：${pageStats.knownPages} 页`
                      : pageStats.knownCount > 0
                        ? ` · 已知参考页数：${pageStats.knownPages} 页（${pageStats.knownCount}/${queueState.items.length} 个已读取）`
                        : ' · 参考页数：暂无数据'}
                  </Typography.Text>
                )}
              </div>
              <Space size={8}>
                {queueState.items.length > 0 && (
                  <>
                    <Button
                      type="text"
                      icon={<FilePlus2 size={14} />}
                      disabled={queueState.isPrinting}
                      onClick={() => void handlePickFiles()}
                    >
                      添加文件 (A)
                    </Button>
                    <Button
                      type="text"
                      icon={<FolderPlus size={14} />}
                      disabled={queueState.isPrinting}
                      onClick={() => void handlePickFolder()}
                    >
                      添加文件夹 (F)
                    </Button>
                  </>
                )}
                {selectedRowKeys.length > 1 && queueState.phase !== 'completed' && (
                  <Button
                    type="text"
                    icon={<Settings2 size={14} />}
                    disabled={queueState.isPrinting}
                    onClick={() => setIsBatchSettingsOpen(true)}
                  >
                    批量设置
                  </Button>
                )}
                {selectedRowKeys.length > 0 && queueState.phase !== 'completed' && (
                  <Button
                    type="text"
                    danger
                    icon={<Trash2 size={14} />}
                    disabled={queueState.isPrinting}
                    onClick={handleBatchRemove}
                  >
                    移除
                  </Button>
                )}
                {queueState.phase === 'editing' && queueState.items.length > 0 && (
                  <Tooltip title="清空列表（C）">
                    <Button
                      type="text"
                      danger
                      disabled={queueState.isPrinting || queueState.items.length === 0}
                      onClick={handleClearQueue}
                    >
                      清空列表 (C)
                    </Button>
                  </Tooltip>
                )}
              </Space>
            </div>
            {queueState.lastSummary && (
              <PrintSummary
                summary={queueState.lastSummary}
                totalPages={pageStats.allKnown && pageStats.knownPages > 0 ? pageStats.knownPages : undefined}
              />
            )}
            <div className="queue-body">
              <PrintQueue
                items={queueState.items}
                globalSettings={globalSettings}
                isPrinting={queueState.isPrinting}
                phase={queueState.phase}
                activeId={activeId}
                onActiveIdChange={setActiveId}
                selectedRowKeys={selectedRowKeys}
                sortOrder={queueState.order}
                onSelectionChange={(keys) => setSelectedRowKeys(keys)}
                onToggleSort={handleToggleSort}
                onReorderItems={handleReorderItems}
                onCloneItems={handleCloneItems}
                onPasteSnapshots={handlePasteSnapshots}
                onRemove={handleRemoveItem}
                onOpenSettings={(id) => setSettingsItemId(id)}
                onBatchSettings={() => setIsBatchSettingsOpen(true)}
                onBatchRemove={handleBatchRemove}
                onClearQueue={handleClearQueue}
                onAddFiles={() => void handlePickFiles()}
                onAddFolder={() => void handlePickFolder()}
                visibleColumns={visibleColumns}
                onVisibleColumnsChange={setVisibleColumns}
                onRefreshReferencePageCounts={refreshReferencePageCounts}
              />
            </div>
            {canRestoreBatch && undoLabel === '开始新批次' && (
              <div className="restore-batch-banner" role="status" aria-live="polite">
                <span>已开始新批次</span>
                <Button
                  type="link"
                  size="small"
                  className="restore-batch-banner-action"
                  onClick={handleRestorePreviousBatch}
                >
                  恢复上一批
                </Button>
              </div>
            )}
          </Content>
          <section className="print-confirmation-panel" aria-labelledby="print-confirmation-title">
            <div className="print-confirmation-title" id="print-confirmation-title">
              3. 打印确认
            </div>
            <div className="print-confirmation-content">
              <div className="queue-footer-stats">
                {queueState.isPrinting ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span className="queue-footer-status">
                      {queueState.phase === 'pausing'
                        ? '正在暂停，等待当前文件完成'
                        : queueState.phase === 'paused'
                          ? `已暂停（${
                              queueState.items.filter(
                                (i) =>
                                  i.status === 'succeeded' ||
                                  i.status === 'failed' ||
                                  i.status === 'skipped',
                              ).length
                            } / ${queueState.items.length}）`
                          : queueState.phase === 'terminating'
                            ? '正在终止剩余任务'
                            : `正在打印（${
                                queueState.items.filter(
                                  (i) =>
                                    i.status === 'succeeded' ||
                                    i.status === 'failed' ||
                                    i.status === 'skipped',
                                ).length
                              } / ${queueState.items.length}）`}
                    </span>
                    <Progress
                      percent={
                        queueState.items.length > 0
                          ? Math.round(
                              (queueState.items.filter(
                                (i) =>
                                  i.status === 'succeeded' ||
                                  i.status === 'failed' ||
                                  i.status === 'skipped',
                              ).length /
                                queueState.items.length) *
                                100,
                            )
                          : 0
                      }
                      size="small"
                      status={queueState.phase === 'paused' ? 'normal' : 'active'}
                      style={{ width: 130, margin: 0 }}
                    />
                  </div>
                ) : queueState.phase === 'completed' &&
                  queueState.lastSummary &&
                  queueState.lastSummary.failed === 0 &&
                  queueState.lastSummary.skipped === 0 ? (
                  <span className="queue-footer-status queue-footer-status-completed">
                    <CheckCircle2 size={16} style={{ color: 'var(--color-success, #52c41a)' }} />
                    <span>
                      已完成：<strong>{queueState.lastSummary.succeeded}</strong> 个文件
                      {pageStats.allKnown && pageStats.knownPages > 0
                        ? ` · 共 ${pageStats.knownPages} 页`
                        : pageStats.knownCount > 0
                          ? ` · 已知参考页数：${pageStats.knownPages} 页`
                          : ''}
                    </span>
                  </span>
                ) : queueState.items.length === 0 ? (
                  <span className="queue-footer-count">
                    尚未添加文件，请在左侧选择或拖入文件
                  </span>
                ) : !globalSettings.printerName ? (
                  <span className="queue-footer-count">
                    已添加 <strong>{queueState.items.length}</strong> 个文件，请在右侧选择打印机
                  </span>
                ) : (
                  <span className="queue-footer-count">
                    共 <strong>{queueState.items.length}</strong> 个文件
                    {pageStats.allKnown
                      ? ` · 参考总页数：${pageStats.knownPages} 页`
                      : pageStats.knownCount > 0
                        ? ` · 已知参考页数：${pageStats.knownPages} 页（${pageStats.knownCount}/${queueState.items.length}）`
                        : ' · 参考页数：暂无数据'}
                    {` · ${globalSettings.colorMode === 'color' ? '彩色' : '黑白'}${globalSettings.sidesMode === 'duplex' ? '双面' : '单面'} · ${globalSettings.copies} 份`}
                    {pageStats.canEstimateSheets
                      ? pageStats.estimatedSheets >= 100
                        ? ` (预计耗纸 ${pageStats.estimatedSheets} 张)`
                        : ''
                      : ' (预计用纸：暂无法完整估算)'}
                  </span>
                )}
              </div>
              {queueState.phase === 'completed' ? (
                <CompletionActions
                  summary={queueState.lastSummary}
                  onStartNewBatch={handleStartNewBatch}
                  onReprintAll={handleReprintAll}
                  onRetryFailed={handleRetryFailed}
                  onKeepFailedOnly={handleKeepFailedOnly}
                  onContinueUnfinished={handleContinueUnfinished}
                  onOpenHistory={() => setHistoryOpen(true)}
                />
              ) : (
                <Space size={12} className="queue-footer-actions">
                  <PrintPlaybackControls
                    phase={queueState.phase}
                    printEnabled={availability.printEnabled}
                    disabledReason={!availability.printEnabled ? availability.reasons.join('；') : undefined}
                    hasItems={queueState.items.length > 0}
                    onStartPrint={() => void executePrint('remaining')}
                    onPausePrint={() => void handlePausePrint()}
                    onResumePrint={() => void handleResumePrint()}
                    onTerminatePrint={() => void handleTerminatePrint()}
                  />
                </Space>
              )}
            </div>
          </section>
          </div>
          <div
            className={`layout-splitter${isResizingSplitter ? ' is-resizing' : ''}`}
            role="separator"
            aria-orientation="vertical"
            aria-label="拖动调整待打印文件表格宽度"
            title="左右拖动调整表格宽度，双击恢复默认"
            onMouseDown={handleSplitterMouseDown}
            onDoubleClick={handleSplitterDoubleClick}
          >
            <div className="layout-splitter-line" />
          </div>
          <Sider
            width={siderWidth}
            theme="light"
            className="control-rail"
            style={{ width: siderWidth, flex: `0 0 ${siderWidth}px`, maxWidth: siderWidth }}
          >
            <GlobalSettingsPanel
              printers={printers}
              settings={globalSettings}
              loadingPrinters={loadingPrinters}
              loadingProperties={loadingProperties}
              savedProfiles={savedProfiles}
              loadingProfiles={loadingSavedProfiles}
              onRefreshPrinters={() => void refreshPrinters()}
              onOpenPrinterManager={() => setPrinterManagerOpen(true)}
              onOpenProperties={() => void handleOpenPrinterProperties()}
              onSelectProfile={(profileId) => void handleSelectSavedProfile(profileId)}
              onOpenSaveProfile={() => setSaveModalOpen(true)}
              onOpenProfileManager={() => setManagerModalOpen(true)}
              onChange={(nextSettings, changedKey) => {
                const nextPrinterName = nextSettings.printerName;
                if (nextPrinterName !== globalSettings.printerName) {
                  void handleSelectPrinter(nextPrinterName);
                  return;
                }

                const printer = systemPrinters.find((item) => item.name === nextPrinterName);
                const updated = {
                  ...nextSettings,
                  profileDirty: isProfileDirty(nextSettings, activeProfile?.settings),
                };

                const sanitized = sanitizeSettingsForPrinter(updated, printer);
                const isMergeable =
                  changedKey === 'copies' ||
                  changedKey === 'pageRange';
                commit(
                  '修改全局打印设置',
                  (curr) => ({
                    ...curr,
                    globalSettings: sanitized,
                  }),
                  isMergeable
                    ? { mergeKey: `globalSettings_${changedKey}`, mergeWindowMs: 800 }
                    : undefined,
                );
              }}
            />
          </Sider>
        </Layout>
      </Layout>
      <FileSettingsDrawer
        open={Boolean(settingsItem) || isBatchSettingsOpen}
        item={settingsItem}
        batchItems={isBatchSettingsOpen ? selectedItems : undefined}
        globalSettings={globalSettings}
        colorEnabled={availability.colorEnabled}
        duplexEnabled={availability.duplexEnabled}
        onClose={() => {
          setSettingsItemId(null);
          setIsBatchSettingsOpen(false);
        }}
        onSave={(override) => {
          if (!settingsItem) {
            return;
          }
          const fileName = settingsItem.fileName;
          commit(`修改“${fileName}”的设置`, (curr) => ({
            ...curr,
            queueState: queueReducer(curr.queueState, {
              type: 'update_override',
              id: settingsItem.id,
              override,
            }),
          }));
          message.success('已保存单文件设置');
        }}
        onBatchSave={(override) => {
          const count = selectedRowKeys.length;
          commit(`修改 ${count} 个文件的设置`, (curr) => ({
            ...curr,
            queueState: queueReducer(curr.queueState, {
              type: 'batch_set_override',
              ids: curr.selectedRowKeys,
              override,
            }),
          }));
          message.success(`已保存 ${count} 个文件的设置`);
        }}
      />
      <PrintHistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onReloadFiles={(paths) => {
          void requestAppendPaths(paths);
        }}
        onSaveAsFavorite={(record) => {
          setAddFavoritePrefill(historyRecordToFavoriteTemplate(record));
          setAddFavoriteModalOpen(true);
        }}
      />
      <FavoritesModal
        open={favoritesModalOpen}
        onClose={() => setFavoritesModalOpen(false)}
        onLoadFavorite={(fav) => {
          void handleLoadFavorite(fav);
        }}
        onOpenAddFavorite={() => {
          setAddFavoritePrefill(null);
          setAddFavoriteModalOpen(true);
        }}
        isPrinting={queueState.isPrinting}
        systemPrinters={systemPrinters}
        customShortcuts={customShortcuts}
        onSetCustomShortcut={(id, keys) => setTargetShortcut(id, keys)}
        onUpdateFavoriteToCurrent={handleUpdateFavoriteToCurrent}
      />
      <AddFavoriteModal
        open={addFavoriteModalOpen}
        onClose={() => {
          setAddFavoriteModalOpen(false);
          setAddFavoritePrefill(null);
        }}
        onSave={handleSaveFavorite}
        currentQueue={queueState.items}
        currentPrinterName={globalSettings.printerName}
        currentProfileName={globalSettings.persistentProfileName}
        currentPersistentProfileId={globalSettings.persistentProfileId}
        currentSettings={globalSettings}
        initialData={addFavoritePrefill}
      />
      <SavePrinterProfileModal
        open={saveModalOpen}
        currentPrinterName={globalSettings.printerName}
        currentSettings={globalSettings}
        runtimeProfileId={globalSettings.driverProfileId}
        currentPersistentProfile={activeProfile}
        onCancel={() => setSaveModalOpen(false)}
        onSaved={handleProfileSaved}
      />
      <PrinterProfileManagerModal
        open={managerModalOpen}
        currentPrinterName={globalSettings.printerName}
        profiles={savedProfiles}
        activeProfileId={globalSettings.persistentProfileId}
        onClose={() => setManagerModalOpen(false)}
        onRefreshProfiles={() => fetchSavedProfiles(globalSettings.printerName).then(() => {})}
        onApplyProfile={(loaded) => {
          commit(`应用配置“${loaded.persistentProfile.name}”`, (curr) => ({
            ...curr,
            globalSettings: applyLoadedPersistentProfile(curr.globalSettings, loaded),
          }));
        }}
        shortcutMap={customShortcuts}
        onSetShortcut={(profileId, keys) => setTargetShortcut(`profile:${profileId}`, keys)}
      />
      <PrinterManagerModal
        open={printerManagerOpen}
        systemPrinters={systemPrinters}
        preferences={printerPreferences}
        currentPrinterName={globalSettings.printerName}
        isPrinting={queueState.isPrinting}
        shortcutMap={customShortcuts}
        onSetShortcut={(printerName, keys) => setTargetShortcut(`printer:${printerName}`, keys)}
        onSave={handleSavePrinterPreferences}
        onClose={() => setPrinterManagerOpen(false)}
      />
      {pendingDuplicateResult && (
        <DuplicateConfirmModal
          open={Boolean(pendingDuplicateResult)}
          totalCount={pendingDuplicateResult.totalIncoming}
          duplicatePaths={pendingDuplicateResult.duplicatePaths}
          newCount={pendingDuplicateResult.newPaths.length}
          onDecision={handleDuplicateDecision}
        />
      )}
      <ShortcutHelpModal
        open={isShortcutHelpOpen}
        onClose={() => setIsShortcutHelpOpen(false)}
        sortableColumns={visibleSortableColumns}
        customShortcuts={customShortcuts}
        onCustomShortcutsChange={(nextCustom) => setCustomShortcuts(nextCustom)}
      />
      <ExternalIntegrationSettingsModal
        open={externalIntegrationOpen}
        onClose={() => setExternalIntegrationOpen(false)}
        onSimulateExternalRequest={(req) => {
          void handleExecuteExternalRequest(req);
        }}
      />
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </ConfigProvider>
  );
}
