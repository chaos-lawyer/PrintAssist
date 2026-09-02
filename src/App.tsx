import {
  Button,
  ConfigProvider,
  Dropdown,
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
  cancelPrintBatch,
  expandFilePaths,
  getFileMetadata,
  isTauriRuntime,
  listSavedPrinterProfiles,
  listSystemPrinters,
  loadPrinterProfile,
  openPrinterProperties,
  pausePrintBatch,
  pickFiles,
  pickFolderFiles,
  resumePrintBatch,
  runPrintBatch,
  subscribeIncomingFiles,
  subscribeExternalRequests,
  subscribeNativeDragDrop,
  subscribePrintItemEvents,
  terminatePrintBatch,
  validateSupportedPaths,
  type ExternalRequestV1,
} from './api/nativeBridge';
import { AppLogo } from './components/AppLogo';
import { PrintHistoryModal } from './features/history/PrintHistoryModal';
import { historyRecordToFavoriteTemplate, savePrintHistoryRecord } from './features/history/historyStorage';
import { AddFavoriteModal, type AddFavoriteModalInitialData } from './features/favorites/AddFavoriteModal';
import { FavoritesModal } from './features/favorites/FavoritesModal';
import { addFavorite, loadFavorites, updateFavorite } from './features/favorites/favoriteStorage';
import { resolveFavorite } from './features/favorites/favoriteResolver';
import { ExternalIntegrationSettingsModal } from './features/settings/ExternalIntegrationSettingsModal';
import {
  isRequestAlreadyProcessed,
  recordRequestIdProcessed,
  emitExternalRequestResult,
} from './features/external/externalRequestHandler';
import type {
  FavoriteTemplateV1,
  FavoriteTaskSnapshot,
  FavoritePrinterRef,
  FavoritePrintConfig,
  FavoriteStandardSettings,
} from './features/favorites/favoriteTypes';
import { PrintPlaybackControls } from './features/queue/PrintPlaybackControls';
import {
  applyDriverSettings,
  applyLoadedPersistentProfile,
  createDefaultGlobalSettings,
  evaluateSettingAvailability,
  formatDriverSettingsSummary,
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
  createPrintSummary,
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
import {
  applyPrinterPreferences,
  loadPrinterPreferences,
  savePrinterPreferences,
  type PrinterPreferencesV1,
} from './features/printers/printerPreferences';
import {
  loadCustomShortcuts,
  matchShortcutKeys,
  saveCustomShortcuts,
} from './features/shortcuts/shortcutRegistry';
import { shouldIgnoreShortcut } from './features/shortcuts/shortcutGuards';
import { ShortcutHelpModal } from './features/shortcuts/ShortcutHelpModal';
import { useUndoHistory } from './features/undo/useUndoHistory';
import { UndoRedoControls } from './features/undo/UndoRedoControls';
import type { WorkspaceSnapshot } from './features/undo/undoTypes';
import type {
  PrinterDriverSettings,
  SavedPrinterProfileSummary,
  SystemPrinter,
} from './shared/contracts/printer';
import type { PrintQueueItemPayload } from './shared/contracts/printJob';

const { Header, Content, Sider } = Layout;

export function App() {
  const [queueState, dispatch] = useReducer(queueReducer, undefined, createEmptyQueueState);
  const [systemPrinters, setSystemPrinters] = useState<SystemPrinter[]>([]);
  const [printerPreferences, setPrinterPreferences] = useState<PrinterPreferencesV1>(loadPrinterPreferences);
  const printerPreferencesRef = useRef(printerPreferences);
  printerPreferencesRef.current = printerPreferences;

  const [customShortcuts, setCustomShortcuts] = useState<Record<string, string[]>>(loadCustomShortcuts);
  const customShortcutsRef = useRef(customShortcuts);
  customShortcutsRef.current = customShortcuts;
  const setTargetShortcut = useCallback((id: string, keys?: string[]) => {
    setCustomShortcuts((current) => {
      const next = { ...current };
      if (keys?.length) next[id] = keys;
      else delete next[id];
      saveCustomShortcuts(next);
      return next;
    });
  }, []);

  const [loadingPrinters, setLoadingPrinters] = useState(true);
  const [printerManagerOpen, setPrinterManagerOpen] = useState(false);
  const knownPrinterNamesRef = useRef<Set<string> | null>(null);

  const orderedPrinters = useMemo(
    () => applyPrinterPreferences(systemPrinters, printerPreferences),
    [systemPrinters, printerPreferences],
  );

  const visiblePrinters = useMemo(
    () => orderedPrinters.filter((p) => !p.hidden),
    [orderedPrinters],
  );

  const printers = visiblePrinters;
  const [sessionProfiles, setSessionProfiles] = useState<
    Record<string, { profileId: string; settings: PrinterDriverSettings; summary: string }>
  >({});
  const [savedProfiles, setSavedProfiles] = useState<SavedPrinterProfileSummary[]>([]);
  const [loadingSavedProfiles, setLoadingSavedProfiles] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [managerModalOpen, setManagerModalOpen] = useState(false);
  const [loadingProperties, setLoadingProperties] = useState(false);
  const [globalSettings, setGlobalSettings] = useState<PrintSettings>(
    createDefaultGlobalSettings(),
  );
  const globalSettingsRef = useRef(globalSettings);
  globalSettingsRef.current = globalSettings;
  const [settingsItemId, setSettingsItemId] = useState<string | null>(null);
  const [isBatchSettingsOpen, setIsBatchSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [favoritesModalOpen, setFavoritesModalOpen] = useState(false);
  const [addFavoriteModalOpen, setAddFavoriteModalOpen] = useState(false);
  const [addFavoritePrefill, setAddFavoritePrefill] = useState<AddFavoriteModalInitialData | null>(null);
  const [externalIntegrationOpen, setExternalIntegrationOpen] = useState(false);
  const pendingExternalQueueRef = useRef<ExternalRequestV1[]>([]);
  const [isShortcutHelpOpen, setIsShortcutHelpOpen] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [pendingDuplicateResult, setPendingDuplicateResult] = useState<PartitionResult | null>(null);
  const pendingAppendResolverRef = useRef<((decision: DuplicateDecision) => void) | null>(null);
  const ingressQueueRef = useRef<string[][]>([]);
  const isProcessingIngressRef = useRef(false);
  const refreshRequestIdRef = useRef(0);
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
    return 320;
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
    window.focus();
    const timer = setTimeout(() => {
      window.focus();
      const queueWrap = document.querySelector('.queue-table-wrap') as HTMLElement | null;
      if (queueWrap) {
        queueWrap.focus({ preventScroll: true });
      }
    }, 50);
    return () => clearTimeout(timer);
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

  const selectedPrinter = useMemo(
    () => printers.find((printer) => printer.name === globalSettings.printerName),
    [printers, globalSettings.printerName],
  );
  const availability = evaluateSettingAvailability(selectedPrinter);
  const settingsItem = queueState.items.find((item) => item.id === settingsItemId) ?? null;
  const selectedItems = useMemo(
    () => queueState.items.filter((item) => selectedRowKeys.includes(item.id)),
    [queueState.items, selectedRowKeys],
  );

  const activeProfile = useMemo(
    () => savedProfiles.find((p) => p.id === globalSettings.persistentProfileId),
    [savedProfiles, globalSettings.persistentProfileId],
  );

  const pageStats = useMemo(() => {
    let knownPages = 0;
    let knownCount = 0;
    let estimatedSheets = 0;

    const nupSlots =
      globalSettings.nupLayout && globalSettings.nupLayout.cols * globalSettings.nupLayout.rows > 1
        ? globalSettings.nupLayout.cols * globalSettings.nupLayout.rows
        : 1;
    const isCrossFile = nupSlots > 1 && globalSettings.nupScope === 'crossFile';

    let totalCrossPages = 0;

    for (const item of queueState.items) {
      if (typeof item.pageCount === 'number' && item.pageCount > 0) {
        const resolved = mergePrintSettings(globalSettings, item.override);
        let pagesToPrint = item.pageCount;
        if (resolved.pageRange.mode === 'custom') {
          const parsed = parsePageRangeExpression(resolved.pageRange.expression, item.pageCount);
          if (parsed.ok && parsed.pages.length > 0) {
            pagesToPrint = parsed.pages.length;
          }
        }
        knownPages += item.pageCount;
        knownCount += 1;

        if (isCrossFile) {
          totalCrossPages += pagesToPrint;
        } else {
          const logicalSides = Math.ceil(pagesToPrint / nupSlots);
          const sheetsPerCopy =
            resolved.sidesMode === 'duplex' ? Math.ceil(logicalSides / 2) : logicalSides;
          estimatedSheets += sheetsPerCopy * (resolved.copies || 1);
        }
      }
    }

    if (isCrossFile) {
      const logicalSides = Math.ceil(totalCrossPages / nupSlots);
      const sheetsPerCopy =
        globalSettings.sidesMode === 'duplex' ? Math.ceil(logicalSides / 2) : logicalSides;
      estimatedSheets = sheetsPerCopy * (globalSettings.copies || 1);
    }

    const allKnown = queueState.items.length > 0 && knownCount === queueState.items.length;
    return { knownPages, knownCount, estimatedSheets, allKnown };
  }, [queueState.items, globalSettings]);

  const fetchSavedProfiles = useCallback(async (printerName: string) => {
    if (!printerName) {
      setSavedProfiles([]);
      return [];
    }
    setLoadingSavedProfiles(true);
    try {
      const profiles = await listSavedPrinterProfiles(printerName);
      setSavedProfiles(profiles);
      return profiles;
    } catch (err) {
      console.error('Failed to load saved profiles:', err);
      return [];
    } finally {
      setLoadingSavedProfiles(false);
    }
  }, []);

  const handleOpenPrinterProperties = async () => {
    if (!globalSettings.printerName || loadingProperties) {
      return;
    }
    setLoadingProperties(true);
    try {
      const existingProfile = sessionProfiles[globalSettings.printerName];
      const result = await openPrinterProperties(
        globalSettings.printerName,
        existingProfile?.profileId,
      );

      if (result.status === 'accepted' && result.profileId && result.settings) {
        const profileId = result.profileId;
        const driverSettings = result.settings;
        const summary = formatDriverSettingsSummary(driverSettings);

        setSessionProfiles((prev) => ({
          ...prev,
          [globalSettings.printerName]: {
            profileId,
            settings: driverSettings,
            summary,
          },
        }));

        setGlobalSettings((curr) => {
          const applied = applyDriverSettings(curr, driverSettings, profileId);
          return {
            ...applied,
            profileDirty: Boolean(curr.persistentProfileId),
          };
        });
        message.success(`已同步“${globalSettings.printerName}”驱动设置`);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '打开打印机属性失败');
    } finally {
      setLoadingProperties(false);
    }
  };

  const handleSelectSavedProfile = async (profileId: string | null) => {
    if (!profileId) {
      commit('重置为默认配置', (curr) => ({
        ...curr,
        globalSettings: {
          ...curr.globalSettings,
          persistentProfileId: undefined,
          persistentProfileName: undefined,
          profileDirty: false,
        },
      }));
      message.info('已切换配置：不使用已保存配置');
      return;
    }
    try {
      const loaded = await loadPrinterProfile(profileId);
      commit(`应用配置“${loaded.persistentProfile.name}”`, (curr) => ({
        ...curr,
        globalSettings: applyLoadedPersistentProfile(curr.globalSettings, loaded),
      }));
      const index = savedProfiles.findIndex((p) => p.id === profileId);
      if (index >= 0) {
        message.info(
          `已切换配置：${loaded.persistentProfile.name} (${index + 1} / ${savedProfiles.length})`,
        );
      } else {
        message.info(`已切换配置：${loaded.persistentProfile.name}`);
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载配置失败');
    }
  };

  const handleProfileSaved = (saved: SavedPrinterProfileSummary) => {
    setSaveModalOpen(false);
    setGlobalSettings((curr) => ({
      ...curr,
      persistentProfileId: saved.id,
      persistentProfileName: saved.name,
      profileDirty: false,
    }));
    void fetchSavedProfiles(globalSettings.printerName);
    message.success(`已保存配置“${saved.name}”`);
  };

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

  const handleSavePrinterPreferences = useCallback(
    (nextPrefs: PrinterPreferencesV1) => {
      savePrinterPreferences(nextPrefs);
      setPrinterPreferences(nextPrefs);

      const currentName = globalSettingsRef.current.printerName;
      const nextDecorated = applyPrinterPreferences(systemPrinters, nextPrefs);
      const nextVisible = nextDecorated.filter((p) => !p.hidden);

      const isCurrentVisible = nextVisible.some((p) => p.name === currentName);
      if (!isCurrentVisible && nextVisible.length > 0) {
        const fallbackPrinter =
          nextVisible.find((p) => p.isDefault) || nextVisible[0];
        void handleSelectPrinter(fallbackPrinter.name);
      }
    },
    [systemPrinters, handleSelectPrinter],
  );

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

  const refreshPrinters = useCallback(async () => {
    const requestId = ++refreshRequestIdRef.current;
    setLoadingPrinters(true);
    try {
      const nextPrinters = await listSystemPrinters();
      if (requestId !== refreshRequestIdRef.current) return;
      setSystemPrinters(nextPrinters);

      // Check for newly discovered printers
      if (knownPrinterNamesRef.current === null) {
        knownPrinterNamesRef.current = new Set(nextPrinters.map((p) => p.name));
      } else {
        const newlyFound = nextPrinters.filter(
          (p) => !knownPrinterNamesRef.current!.has(p.name),
        );
        if (newlyFound.length > 0) {
          newlyFound.forEach((p) => knownPrinterNamesRef.current!.add(p.name));
          if (newlyFound.length === 1) {
            message.info(`发现新打印机“${newlyFound[0].name}”，已添加到列表末尾`);
          } else {
            message.info(`发现 ${newlyFound.length} 台新打印机，已添加到列表末尾`);
          }
        }
      }

      const currentSettings = globalSettingsRef.current;
      const currentName = currentSettings.printerName;

      const decorated = applyPrinterPreferences(nextPrinters, printerPreferencesRef.current);
      const visible = decorated.filter((p) => !p.hidden);

      const isCurrentVisible = visible.some((p) => p.name === currentName);
      const preferredName = isCurrentVisible
        ? currentName
        : visible.find((printer) => printer.isDefault)?.name ||
          visible[0]?.name ||
          '';
      const preferredPrinter = nextPrinters.find((printer) => printer.name === preferredName);

      setGlobalSettings((curr) =>
        sanitizeSettingsForPrinter(
          { ...curr, printerName: preferredName },
          preferredPrinter,
        ),
      );

      if (preferredName && preferredName !== currentName) {
        const profiles = await fetchSavedProfiles(preferredName);
        if (requestId !== refreshRequestIdRef.current) return;

        const defaultProfile = profiles.find(
          (p) => p.isDefault && p.compatibility === 'compatible',
        );
        if (defaultProfile) {
          try {
            const loaded = await loadPrinterProfile(defaultProfile.id);
            if (requestId === refreshRequestIdRef.current) {
              setGlobalSettings((latest) => {
                if (latest.persistentProfileId && latest.printerName === preferredName) {
                  return latest;
                }
                return applyLoadedPersistentProfile(latest, loaded);
              });
            }
          } catch {
            // ignore
          }
        }
      }
    } catch (error) {
      if (requestId === refreshRequestIdRef.current) {
        message.error(error instanceof Error ? error.message : '读取系统打印机失败');
      }
    } finally {
      if (requestId === refreshRequestIdRef.current) {
        setLoadingPrinters(false);
      }
    }
  }, [fetchSavedProfiles]);

  useEffect(() => {
    void refreshPrinters();
    if (isTauriRuntime()) {
      import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => {
          getCurrentWindow().maximize().catch(() => {});
        })
        .catch(() => {});
    }
  }, [refreshPrinters]);

  const processIngressQueue = useCallback(async () => {
    if (isProcessingIngressRef.current) return;
    isProcessingIngressRef.current = true;

    try {
      while (ingressQueueRef.current.length > 0) {
        const paths = ingressQueueRef.current.shift();
        if (!paths || paths.length === 0) continue;

        if (queueState.isPrinting) {
          message.warning('打印进行中，暂不可添加文件');
          continue;
        }
        if (queueState.phase === 'completed') {
          message.warning('当前批次已完成，请先点击“开始新批次”后再添加新文件');
          continue;
        }

        if (canRestoreBatch) {
          setCanRestoreBatch(false);
          previousBatchBackupRef.current = null;
        }

        const result = partitionIncomingPaths(queueState.items, paths);

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
  }, [queueState.isPrinting, queueState.phase, queueState.items, canRestoreBatch, commit]);

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
        if (queueState.isPrinting) {
          message.warning('打印进行中，暂不可添加文件');
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
  }, [queueState.isPrinting, requestAppendPaths]);

  const handlePickFiles = async () => {
    if (queueState.isPrinting) {
      message.warning('打印进行中，暂不可添加文件');
      return;
    }
    try {
      const picked = await pickFiles();
      void requestAppendPaths(picked);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '添加文件失败');
    }
  };

  const handlePickFolder = async () => {
    if (queueState.isPrinting) {
      message.warning('打印进行中，暂不可添加文件');
      return;
    }
    try {
      const picked = await pickFolderFiles();
      void requestAppendPaths(picked);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '添加文件夹失败');
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    if (queueState.isPrinting) {
      message.warning('打印进行中，暂不可添加文件');
      return;
    }
    // 桌面端由 subscribeNativeDragDrop 处理；HTML5 File.path 在 Tauri/WebView2 中为空
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
          item.pageCount ?? undefined,
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
        const failedItems = batchResult.results.filter((r) => r.status === 'failed' && r.message);
        const hasOfficeMissing = failedItems.some(
          (r) =>
            r.message?.includes('未检测到可用的 Microsoft Office 或 WPS Office') ||
            r.message?.includes('请确认已安装') ||
            r.message?.includes('未检测到已安装组件') ||
            r.message?.includes('kwps.application') ||
            r.message?.includes('ket.application') ||
            r.message?.includes('kwpp.application') ||
            r.message?.includes('Word.Application') ||
            r.message?.includes('Excel.Application') ||
            r.message?.includes('PowerPoint.Application') ||
            r.message?.includes('CLSIDFromProgID'),
        );
        const hasFileLocked = failedItems.some(
          (r) =>
            r.message?.toLowerCase().includes('0x800a14bb') ||
            r.message?.includes('正在被另一进程使用') ||
            r.message?.includes('被占用') ||
            r.message?.includes('密码'),
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
            status: 'failed' as const,
            message: error instanceof Error ? error.message : '打印执行失败',
          })),
        ),
      });
      message.error(error instanceof Error ? error.message : '打印执行失败');
    }
  };

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

  const handleReprintAll = () => {
    dispatch({ type: 'prepare_reprint_all' });
    void executePrint('all');
  };

  const handleRetryFailed = () => {
    dispatch({ type: 'retry_failed' });
    void executePrint('failed');
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

  const handleContinueUnfinished = () => {
    void executePrint('remaining');
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

  const handleExecuteExternalRequest = useCallback(
    async (request: ExternalRequestV1) => {
      if (isRequestAlreadyProcessed(request.requestId)) {
        return;
      }
      recordRequestIdProcessed(request.requestId);

      if (request.action === 'add') {
        if (queueState.isPrinting) {
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

        if (queueState.phase === 'completed') {
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
          const partition = partitionIncomingPaths(queueState.items, request.paths);
          pathsToAdd = partition.newPaths;
          skippedCount = partition.duplicatePaths.length;
        } else if (duplicatePolicy === 'ask') {
          const partition = partitionIncomingPaths(queueState.items, request.paths);
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
        if (queueState.isPrinting) {
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
            currentQueue: queueState,
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

        if (queueState.phase === 'completed') {
          handleStartNewBatch();
        }

        // Append incoming files to queue
        commit(`外部直接打印 ${validated.valid.length} 个文件`, (curr) => ({
          ...curr,
          queueState: queueReducer(curr.queueState, {
            type: 'append_files',
            paths: validated.valid,
          }),
        }));

        await emitExternalRequestResult(request, {
          status: 'accepted',
          addedCount: validated.valid.length,
          skippedCount: validated.missing.length,
          message: `直接打印任务已启动（${validated.valid.length} 个文件）`,
        });

        // Trigger print execution for newly appended files
        setTimeout(() => {
          void executePrint('remaining');
        }, 100);
      }
    },
    [
      queueState.isPrinting,
      queueState.phase,
      queueState.items,
      systemPrinters,
      selectedRowKeys,
      activeId,
      commit,
      executePrint,
      handleStartNewBatch,
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

  // 全局快捷键支持：
  // 帮助 /，删除 Delete/Backspace，全选 Ctrl+A，开始打印 Ctrl+P
  // 单键快捷键（受统一安全守卫保护）：A 添加文件，F 添加文件夹，H 打印历史，S 文件/批量设置，1~9 驱动配置
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isShortcut = (id: string, fallbackKeys: string[]) => {
        const keys = customShortcutsRef.current[id] ?? fallbackKeys;
        return matchShortcutKeys(event, keys);
      };

      const assigned = Object.entries(customShortcutsRef.current).find(([id, keys]) =>
        (id.startsWith('printer:') || id.startsWith('profile:') || id.startsWith('favorite:')) && matchShortcutKeys(event, keys),
      );
      if (assigned && !shouldIgnoreShortcut(event, { isSingleKey: assigned[1].length === 1 })) {
        const [id] = assigned;
        if (id.startsWith('printer:')) {
          const printerName = id.slice('printer:'.length);
          if (!queueState.isPrinting && visiblePrinters.some((printer) => printer.name === printerName)) {
            event.preventDefault();
            void handleSelectPrinter(printerName);
            return;
          }
        }
        if (id.startsWith('profile:')) {
          const profile = savedProfiles.find((item) => item.id === id.slice('profile:'.length));
          if (!queueState.isPrinting && profile?.compatibility === 'compatible') {
            event.preventDefault();
            void handleSelectSavedProfile(profile.id);
            return;
          }
        }
        if (id.startsWith('favorite:')) {
          const favId = id.slice('favorite:'.length);
          const allFavs = loadFavorites();
          const favorite = allFavs.find((f) => f.id === favId);
          if (!queueState.isPrinting && favorite) {
            event.preventDefault();
            void handleLoadFavorite(favorite);
            return;
          }
        }
      }

      // 打开收藏中心 (B)
      if (isShortcut('open_favorites', ['B'])) {
        if (!shouldIgnoreShortcut(event, { isSingleKey: true })) {
          event.preventDefault();
          setFavoritesModalOpen(true);
          return;
        }
      }

      // 添加收藏 (Ctrl+B)
      if (isShortcut('add_favorite', ['Ctrl', 'B'])) {
        if (!shouldIgnoreShortcut(event, { isSingleKey: false })) {
          event.preventDefault();
          setAddFavoritePrefill(null);
          setAddFavoriteModalOpen(true);
          return;
        }
      }

      // 1. 快捷键说明帮助
      if (isShortcut('open_help', ['/'])) {
        if (!shouldIgnoreShortcut(event, { allowHelpSlash: true, isSingleKey: !event.ctrlKey && !event.altKey })) {
          event.preventDefault();
          setIsShortcutHelpOpen(true);
          return;
        }
      }

      // 2. 撤销 (Ctrl+Z)
      if (isShortcut('undo', ['Ctrl', 'Z'])) {
        if (!shouldIgnoreShortcut(event, { isSingleKey: false })) {
          event.preventDefault();
          handleUndo();
          return;
        }
      }

      // 3. 重做 (Ctrl+Y / Ctrl+Shift+Z)
      if (
        isShortcut('redo', ['Ctrl', 'Y']) ||
        ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'z' || event.key === 'Z'))
      ) {
        if (!shouldIgnoreShortcut(event, { isSingleKey: false })) {
          event.preventDefault();
          handleRedo();
          return;
        }
      }

      // 4. 批量删除选中 (Delete / Backspace)
      if (isShortcut('remove_item', ['Delete']) || event.key === 'Backspace') {
        if (!shouldIgnoreShortcut(event, { isSingleKey: true })) {
          if (selectedRowKeys.length > 0 && !queueState.isPrinting) {
            event.preventDefault();
            handleBatchRemove();
            return;
          }
        }
      }

      // 清空列表 (C)
      if (isShortcut('clear_queue', ['C'])) {
        if (!shouldIgnoreShortcut(event, { isSingleKey: true })) {
          if (queueState.isPrinting) {
            message.warning('打印进行中，暂不可清空列表');
            return;
          }
          if (queueState.phase === 'completed') {
            message.warning('当前批次已完成，请先开始新批次');
            return;
          }
          if (queueState.items.length === 0) {
            return;
          }
          event.preventDefault();
          handleClearQueue();
          return;
        }
      }

      // 5. 全选待打印文件 (Ctrl+A)
      if (isShortcut('select_all', ['Ctrl', 'A'])) {
        if (!shouldIgnoreShortcut(event, { isSingleKey: false })) {
          if (queueState.items.length > 0 && !queueState.isPrinting) {
            event.preventDefault();
            setSelectedRowKeys(queueState.items.map((item) => item.id));
            return;
          }
        }
      }

      // 6. 开始打印 (Ctrl+P)
      if (isShortcut('start_print', ['Ctrl', 'P'])) {
        if (!shouldIgnoreShortcut(event, { isSingleKey: false })) {
          event.preventDefault();
          if (
            availability.printEnabled &&
            queueState.items.length > 0 &&
            !queueState.isPrinting
          ) {
            void executePrint('remaining');
            return;
          }
        }
      }

      // 7. 添加文件 (A)
      if (isShortcut('add_file', ['A'])) {
        if (!shouldIgnoreShortcut(event, { isSingleKey: true })) {
          if (queueState.isPrinting) {
            message.warning('打印进行中，暂不可添加文件');
            return;
          }
          event.preventDefault();
          void handlePickFiles();
          return;
        }
      }

      // 8. 添加文件夹 (F)
      if (isShortcut('add_folder', ['F'])) {
        if (!shouldIgnoreShortcut(event, { isSingleKey: true })) {
          if (queueState.isPrinting) {
            message.warning('打印进行中，暂不可添加文件');
            return;
          }
          event.preventDefault();
          void handlePickFolder();
          return;
        }
      }

      // 9. 打开打印历史 (H)
      if (isShortcut('open_history', ['H'])) {
        if (!shouldIgnoreShortcut(event, { isSingleKey: true })) {
          event.preventDefault();
          setHistoryOpen(true);
          return;
        }
      }

      // 10. 文件设置 (E)
      if (isShortcut('open_settings', ['E'])) {
        if (!shouldIgnoreShortcut(event, { isSingleKey: true })) {
          if (queueState.isPrinting) {
            message.warning('打印进行中，暂不可修改配置');
            return;
          }
          if (queueState.phase === 'completed') {
            message.warning('当前批次已完成，请先开始新批次');
            return;
          }
          if (selectedRowKeys.length > 1) {
            event.preventDefault();
            setIsBatchSettingsOpen(true);
            return;
          }
          if (selectedRowKeys.length === 1) {
            event.preventDefault();
            setSettingsItemId(String(selectedRowKeys[0]));
            return;
          }
          if (activeId) {
            event.preventDefault();
            setSettingsItemId(activeId);
            return;
          }
          message.info('请先选择待配置的文件');
          return;
        }
      }

      // 11. 调整单双面 (D)
      if (isShortcut('toggle_sides', ['D'])) {
        if (!shouldIgnoreShortcut(event, { isSingleKey: true })) {
          if (queueState.isPrinting) {
            message.warning('打印进行中，暂不可修改全局设置');
            return;
          }
          if (queueState.phase === 'completed') {
            message.warning('当前批次已完成，请先开始新批次');
            return;
          }
          event.preventDefault();
          const nextSides = globalSettings.sidesMode === 'duplex' ? 'simplex' : 'duplex';
          if (nextSides === 'duplex' && !availability.duplexEnabled) {
            message.warning('当前打印机不支持双面打印');
            return;
          }
          commit('调整单双面设置', (curr) => ({
            ...curr,
            globalSettings: {
              ...curr.globalSettings,
              sidesMode: nextSides,
              profileDirty: true,
            },
          }));
          message.success(`全局设置：已切换为${nextSides === 'duplex' ? '双面' : '单面'}打印`);
          return;
        }
      }

      // 12. 调整黑白/彩色 (S)
      if (isShortcut('toggle_color', ['S'])) {
        if (!shouldIgnoreShortcut(event, { isSingleKey: true })) {
          if (queueState.isPrinting) {
            message.warning('打印进行中，暂不可修改全局设置');
            return;
          }
          if (queueState.phase === 'completed') {
            message.warning('当前批次已完成，请先开始新批次');
            return;
          }
          event.preventDefault();
          const nextColor = globalSettings.colorMode === 'color' ? 'monochrome' : 'color';
          if (nextColor === 'color' && !availability.colorEnabled) {
            message.warning(
              `当前打印机不支持彩色打印${selectedPrinter?.color.detail ? `（${selectedPrinter.color.detail}）` : ''}`,
            );
            return;
          }
          commit('调整黑白/彩色设置', (curr) => ({
            ...curr,
            globalSettings: {
              ...curr.globalSettings,
              colorMode: nextColor,
              profileDirty: true,
            },
          }));
          message.success(`全局设置：已切换为${nextColor === 'color' ? '彩色' : '黑白'}打印`);
          return;
        }
      }

      // 13. 下一个打印机 (])
      if (isShortcut('next_printer', [']'])) {
        if (!shouldIgnoreShortcut(event, { isSingleKey: true })) {
          if (queueState.isPrinting) {
            message.warning('打印进行中，暂不可切换打印机');
            return;
          }
          if (visiblePrinters.length <= 1) {
            return;
          }
          event.preventDefault();
          const currIdx = visiblePrinters.findIndex((p) => p.name === globalSettings.printerName);
          const nextIdx = (currIdx + 1) % visiblePrinters.length;
          const target = visiblePrinters[nextIdx];
          void handleSelectPrinter(target.name);
          return;
        }
      }

      // 14. 上一个打印机 ([)
      if (isShortcut('prev_printer', ['['])) {
        if (!shouldIgnoreShortcut(event, { isSingleKey: true })) {
          if (queueState.isPrinting) {
            message.warning('打印进行中，暂不可切换打印机');
            return;
          }
          if (visiblePrinters.length <= 1) {
            return;
          }
          event.preventDefault();
          const currIdx = visiblePrinters.findIndex((p) => p.name === globalSettings.printerName);
          const prevIdx = (currIdx - 1 + visiblePrinters.length) % visiblePrinters.length;
          const target = visiblePrinters[prevIdx];
          void handleSelectPrinter(target.name);
          return;
        }
      }

      // 15. 上一配置 (-)
      if (isShortcut('prev_profile', ['-'])) {
        if (!shouldIgnoreShortcut(event, { isSingleKey: true })) {
          if (queueState.isPrinting) {
            message.warning('打印进行中，暂不可切换配置');
            return;
          }
          if (savedProfiles.length === 0) {
            message.info('当前打印机暂无已保存配置');
            return;
          }
          event.preventDefault();
          const currIdx = savedProfiles.findIndex(
            (p) => p.id === globalSettings.persistentProfileId,
          );
          const prevIdx = (currIdx - 1 + savedProfiles.length) % savedProfiles.length;
          const target = savedProfiles[prevIdx];
          if (target.compatibility !== 'compatible') {
            message.warning(`配置“${target.name}”与当前打印机不兼容`);
            return;
          }
          void handleSelectSavedProfile(target.id);
          return;
        }
      }

      // 16. 下一配置 (=)
      if (isShortcut('next_profile', ['='])) {
        if (!shouldIgnoreShortcut(event, { isSingleKey: true })) {
          if (queueState.isPrinting) {
            message.warning('打印进行中，暂不可切换配置');
            return;
          }
          if (savedProfiles.length === 0) {
            message.info('当前打印机暂无已保存配置');
            return;
          }
          event.preventDefault();
          const currIdx = savedProfiles.findIndex(
            (p) => p.id === globalSettings.persistentProfileId,
          );
          const nextIdx = (currIdx + 1) % savedProfiles.length;
          const target = savedProfiles[nextIdx];
          if (target.compatibility !== 'compatible') {
            message.warning(`配置“${target.name}”与当前打印机不兼容`);
            return;
          }
          void handleSelectSavedProfile(target.id);
          return;
        }
      }

      const isCtrlOrMeta = event.ctrlKey || event.metaKey;

      // 17. 'Shift + 1~9'：选择对应顺序的打印机
      const digitCodeMatch = event.code.match(/^Digit([1-9])$/);
      if (event.shiftKey && digitCodeMatch && !isCtrlOrMeta && !event.altKey) {
        if (!shouldIgnoreShortcut(event, { isSingleKey: false })) {
          if (queueState.isPrinting) {
            message.warning('打印进行中，暂不可切换打印机');
            return;
          }
          const index = parseInt(digitCodeMatch[1], 10) - 1;
          if (index < visiblePrinters.length) {
            event.preventDefault();
            const target = visiblePrinters[index];
            if (target.name === globalSettings.printerName) {
              message.info(`当前已是打印机：${target.name} (${index + 1} / ${visiblePrinters.length})`);
              return;
            }
            void handleSelectPrinter(target.name);
            return;
          }
        }
      }

      const numMatch = event.key.match(/^[1-9]$/);

      // 14. 'Ctrl + 1/2/3/4...'：根据当前显示的排序列排序
      if (isCtrlOrMeta && numMatch) {
        if (!shouldIgnoreShortcut(event, { isSingleKey: false })) {
          const colIndex = parseInt(numMatch[0], 10) - 1;
          if (colIndex < visibleSortableColumns.length) {
            event.preventDefault();
            const targetCol = visibleSortableColumns[colIndex];
            handleToggleSort(targetCol.field);
            const nextDir =
              queueState.order.mode === targetCol.field && queueState.order.direction === 'asc'
                ? '倒序'
                : '正序';
            message.info(`按${targetCol.label}${nextDir}排序`);
            return;
          }
        }
      }

      // 15. '1' ~ '9'：应用当前打印机保存配置 1-9 (单键)
      if (!isCtrlOrMeta && !event.shiftKey && !event.altKey && numMatch) {
        const index = parseInt(numMatch[0], 10) - 1;
        if (!globalSettings.printerName) {
          message.warning('请先选择打印机');
          return;
        }
        if (loadingSavedProfiles) {
          message.warning('配置正在加载中，请稍候');
          return;
        }
        if (index < savedProfiles.length) {
          const profile = savedProfiles[index];
          if (profile.compatibility !== 'compatible') {
            message.warning(`配置“${profile.name}”与当前打印机不兼容`);
            return;
          }
          event.preventDefault();
          void handleSelectSavedProfile(profile.id);
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeId,
    availability.colorEnabled,
    availability.duplexEnabled,
    availability.printEnabled,
    commit,
    executePrint,
    globalSettings.colorMode,
    globalSettings.printerName,
    globalSettings.sidesMode,
    handleBatchRemove,
    handleClearQueue,
    handlePickFiles,
    handlePickFolder,
    handleRedo,
    handleSelectPrinter,
    handleSelectSavedProfile,
    handleToggleSort,
    handleUndo,
    handleLoadFavorite,
    loadingSavedProfiles,
    queueState.isPrinting,
    queueState.items,
    queueState.order,
    queueState.phase,
    savedProfiles,
    selectedPrinter,
    selectedRowKeys,
    visiblePrinters,
    visibleSortableColumns,
  ]);

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
            <Tooltip title="收藏（B）">
              <Button
                type="text"
                className="header-favorites-btn"
                icon={<Bookmark size={16} />}
                onClick={() => setFavoritesModalOpen(true)}
                aria-label="收藏"
              />
            </Tooltip>
            <Tooltip title="打印历史（H）">
              <Button
                type="text"
                className="header-history-btn"
                icon={<Clock size={16} />}
                onClick={() => setHistoryOpen(true)}
                aria-label="打印历史"
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
            <Tooltip title="快捷键（/）">
              <Button
                type="text"
                className="header-help-btn"
                icon={<CircleHelp size={16} />}
                onClick={() => setIsShortcutHelpOpen(true)}
                aria-label="快捷键帮助"
              />
            </Tooltip>
          </Space>
        </Header>
        <Layout className="app-body">
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
              <div>
                <Typography.Title level={4} className="queue-main-title">
                  待打印文件
                </Typography.Title>
              </div>
              <Space size={8}>
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
                {queueState.phase === 'editing' && (
                  <Tooltip title="清空列表（C）">
                    <Button
                      type="text"
                      danger
                      disabled={queueState.isPrinting || queueState.items.length === 0}
                      onClick={handleClearQueue}
                    >
                      清空列表
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
            <div className="queue-footer">
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
                        : ''}
                    </span>
                  </span>
                ) : (
                  <span className="queue-footer-count">
                    共 <strong>{queueState.items.length}</strong> 个文件
                    {pageStats.allKnown && pageStats.knownPages > 0
                      ? ` · 共 ${pageStats.knownPages} 页 (预估耗纸 ${pageStats.estimatedSheets} 张)`
                      : ''}
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
                  <Button
                    icon={<FilePlus2 size={15} />}
                    disabled={queueState.isPrinting}
                    onClick={() => void handlePickFiles()}
                  >
                    添加文件
                  </Button>
                  <Button
                    icon={<FolderPlus size={15} />}
                    disabled={queueState.isPrinting}
                    onClick={() => void handlePickFolder()}
                  >
                    添加文件夹
                  </Button>
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
          </Content>
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
              printerShortcutMap={customShortcuts}
              onSetPrinterShortcut={(printerName, keys) => setTargetShortcut(`printer:${printerName}`, keys)}
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
