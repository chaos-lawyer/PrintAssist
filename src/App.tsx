import {
  Button,
  Checkbox,
  ConfigProvider,
  Dropdown,
  Layout,
  Modal,
  Progress,
  Space,
  Typography,
  message,
} from 'antd';
import {
  Clock,
  FilePlus2,
  FolderPlus,
  Printer,
  Settings2,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import type { DragEvent } from 'react';
import {
  cancelPrintBatch,
  expandFilePaths,
  isTauriRuntime,
  listSavedPrinterProfiles,
  listSystemPrinters,
  loadPrinterProfile,
  openPrinterProperties,
  pickFiles,
  pickFolderFiles,
  runPrintBatch,
  subscribeIncomingFiles,
  subscribeNativeDragDrop,
  subscribePrintItemEvents,
} from './api/nativeBridge';
import { AppLogo } from './components/AppLogo';
import { PrintHistoryModal } from './features/history/PrintHistoryModal';
import { savePrintHistoryRecord } from './features/history/historyStorage';
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
import { createEmptyQueueState, type QueueItem } from './domain/queueTypes';
import { parsePageRangeExpression } from './domain/pageRange';
import { PrintQueue } from './features/queue/PrintQueue';
import { createPrintSummary, queueReducer } from './features/queue/queueReducer';
import { PrintSummary } from './features/results/PrintSummary';
import { FileSettingsDrawer } from './features/settings/FileSettingsDrawer';
import { GlobalSettingsPanel } from './features/settings/GlobalSettingsPanel';
import { SavePrinterProfileModal } from './features/settings/SavePrinterProfileModal';
import { PrinterProfileManagerModal } from './features/settings/PrinterProfileManagerModal';
import type {
  PrinterDriverSettings,
  SavedPrinterProfileSummary,
  SystemPrinter,
} from './shared/contracts/printer';
import type { PrintQueueItemPayload } from './shared/contracts/printJob';

const { Header, Content, Sider } = Layout;

export function App() {
  const [queueState, dispatch] = useReducer(queueReducer, undefined, createEmptyQueueState);
  const [printers, setPrinters] = useState<SystemPrinter[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(true);
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
  const [settingsItemId, setSettingsItemId] = useState<string | null>(null);
  const [isBatchSettingsOpen, setIsBatchSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [allowAssociationFallback, setAllowAssociationFallback] = useState(false);
  const [autoClearOnSuccess, setAutoClearOnSuccess] = useState<boolean>(() => {
    try {
      return localStorage.getItem('printassist_auto_clear_on_success') === 'true';
    } catch {
      return false;
    }
  });

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

        const sheetsPerCopy =
          resolved.sidesMode === 'duplex' ? Math.ceil(pagesToPrint / 2) : pagesToPrint;
        estimatedSheets += sheetsPerCopy * (resolved.copies || 1);
      }
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
      setGlobalSettings((curr) => ({
        ...curr,
        persistentProfileId: undefined,
        persistentProfileName: undefined,
        profileDirty: false,
      }));
      return;
    }
    try {
      const loaded = await loadPrinterProfile(profileId);
      setGlobalSettings((curr) => applyLoadedPersistentProfile(curr, loaded));
      message.success(`已应用配置“${loaded.persistentProfile.name}”`);
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

  const refreshPrinters = useCallback(async () => {
    setLoadingPrinters(true);
    try {
      const nextPrinters = await listSystemPrinters();
      setPrinters(nextPrinters);
      const preferredName =
        globalSettings.printerName ||
        nextPrinters.find((printer) => printer.isDefault)?.name ||
        nextPrinters[0]?.name ||
        '';
      const preferredPrinter = nextPrinters.find((printer) => printer.name === preferredName);

      setGlobalSettings((currentSettings) => {
        return sanitizeSettingsForPrinter(
          { ...currentSettings, printerName: preferredName },
          preferredPrinter,
        );
      });

      if (preferredName) {
        const profiles = await fetchSavedProfiles(preferredName);
        const defaultProfile = profiles.find(
          (p) => p.isDefault && p.compatibility === 'compatible',
        );
        if (defaultProfile) {
          try {
            const loaded = await loadPrinterProfile(defaultProfile.id);
            setGlobalSettings((curr) => applyLoadedPersistentProfile(curr, loaded));
          } catch {
            // ignore
          }
        }
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '读取系统打印机失败');
    } finally {
      setLoadingPrinters(false);
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

  const appendPaths = useCallback((paths: string[]) => {
    if (queueState.isPrinting) {
      message.warning('打印进行中，暂不可添加文件');
      return;
    }
    if (paths.length === 0) {
      return;
    }
    dispatch({ type: 'append_files', paths });
    message.success(`已追加 ${paths.length} 个文件`);
  }, [queueState.isPrinting]);

  useEffect(() => {
    return subscribeIncomingFiles((paths) => {
      if (paths.length > 0) {
        appendPaths(paths);
      }
    });
  }, [appendPaths]);

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
            appendPaths(expanded);
          } catch (error) {
            message.error(error instanceof Error ? error.message : '处理拖放文件失败');
          }
        })();
      },
    });
  }, [queueState.isPrinting, appendPaths]);

  const handlePickFiles = async () => {
    if (queueState.isPrinting) {
      message.warning('打印进行中，暂不可添加文件');
      return;
    }
    try {
      appendPaths(await pickFiles());
    } catch (error) {
      message.error(error instanceof Error ? error.message : '选择文件失败');
    }
  };

  const handlePickFolder = async () => {
    if (queueState.isPrinting) {
      message.warning('打印进行中，暂不可添加文件');
      return;
    }
    try {
      appendPaths(await pickFolderFiles());
    } catch (error) {
      message.error(error instanceof Error ? error.message : '选择文件夹失败');
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
    appendPaths(paths);
  };

  const buildBatchPayload = (onlyFailed = false): PrintQueueItemPayload[] | null => {
    if (!globalSettings.printerName) {
      message.warning('请先选择打印机');
      return null;
    }
    if (!availability.printEnabled) {
      message.error(availability.reasons.join('；') || '当前打印机不可用');
      return null;
    }

    const sourceItems = queueState.items.filter((item) => {
      if (onlyFailed) {
        return item.status === 'failed' || item.status === 'ready';
      }
      return item.status !== 'succeeded' && item.kind !== 'unknown';
    });
    if (sourceItems.length === 0) {
      const allSucceeded =
        queueState.items.length > 0 &&
        queueState.items.every(
          (item) => item.status === 'succeeded' || item.kind === 'unknown',
        ) &&
        queueState.items.some((item) => item.status === 'succeeded');
      if (allSucceeded) {
        message.info('当前批次文件均已打印成功，可清空后继续添加新文件');
      } else {
        message.warning('没有可打印的文件');
      }
      return null;
    }

    const payloads: PrintQueueItemPayload[] = [];
    for (const item of sourceItems) {
      const resolved = mergePrintSettings(globalSettings, item.override);
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
      payloads.push({
        queueItemId: item.id,
        path: item.path,
        fileName: item.fileName,
        allowAssociationFallback,
        settings: {
          printerName: resolved.printerName,
          colorMode: resolved.colorMode,
          sidesMode: resolved.sidesMode,
          flipMode: resolved.flipMode,
          copies: resolved.copies,
          collate: resolved.collate,
          sourceCode: resolved.sourceCode,
          sourceName: resolved.sourceName,
          scaleMode: resolved.scaleMode,
          pageRangeMode: resolved.pageRange.mode,
          pageRangeExpression: resolved.pageRange.expression,
          driverProfileId: resolved.driverProfileId,
        },
      });
    }
    return payloads;
  };

  const executePrint = async (onlyFailed = false) => {
    const payloads = buildBatchPayload(onlyFailed);
    if (!payloads) {
      return;
    }

    const hasOffice = payloads.some((item) =>
      /\.(doc|docx|xls|xlsx|ppt|pptx)$/i.test(item.path),
    );
    if (hasOffice && !allowAssociationFallback) {
      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: 'Office 文档打印说明',
          content:
            'Office 文档优先通过本机已安装的 Word/Excel/PowerPoint 转换后打印。若仅有关联程序且无法证明完整参数支持，将提示能力受限。是否继续？',
          okText: '继续打印',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) {
        return;
      }
      setAllowAssociationFallback(true);
    }

    dispatch({ type: 'begin_print' });
    try {
      const batchResult = await runPrintBatch({
        items: payloads.map((item) => ({ ...item, allowAssociationFallback: true })),
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
        message.warning(`完成：成功 ${batchResult.succeeded}，失败 ${batchResult.failed}`);
      } else {
        if (autoClearOnSuccess) {
          const succeededIds = batchResult.results
            .filter((item) => item.status === 'succeeded')
            .map((item) => item.queueItemId);
          if (succeededIds.length > 0) {
            dispatch({ type: 'batch_remove', ids: succeededIds });
            setSelectedRowKeys([]);
          }
          message.success(`已打印 ${batchResult.succeeded} 个文件并清空列表`);
        } else {
          message.success(`全部完成：成功 ${batchResult.succeeded}`);
        }
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

  const handleCancelPrint = async () => {
    try {
      await cancelPrintBatch();
      message.info('已发送取消请求，正在跳过剩余文件...');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '取消打印失败');
    }
  };

  const handleBatchRemove = () => {
    if (selectedRowKeys.length === 0 || queueState.isPrinting) return;
    const count = selectedRowKeys.length;
    Modal.confirm({
      title: `确定移除选中的 ${count} 个文件？`,
      content: '移除后可随时重新添加。',
      okText: '确定移除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        dispatch({ type: 'batch_remove', ids: selectedRowKeys as string[] });
        setSelectedRowKeys([]);
        message.success(`已移除 ${count} 个文件`);
      },
    });
  };

  const handleClearQueue = () => {
    if (queueState.items.length === 0 || queueState.isPrinting) return;
    Modal.confirm({
      title: '确定清空当前批次？',
      content: '将移除待打印列表中的所有文件。',
      okText: '确定清空',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        dispatch({ type: 'clear_queue' });
        setSelectedRowKeys([]);
        message.success('已清空待打印列表');
      },
    });
  };

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
    });
    return unsubscribe;
  }, []);

  // 全局快捷键支持：Delete/Backspace 移除选中，Ctrl/Cmd+A 全选，Ctrl/Cmd+P 触发打印
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInputActive =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl?.getAttribute('contenteditable') === 'true';

      // Delete / Backspace：批量删除选中
      if ((event.key === 'Delete' || event.key === 'Backspace') && !isInputActive) {
        if (selectedRowKeys.length > 0 && !queueState.isPrinting) {
          event.preventDefault();
          handleBatchRemove();
        }
      }

      // Ctrl+A / Cmd+A：全选待打印文件
      if (
        (event.ctrlKey || event.metaKey) &&
        (event.key === 'a' || event.key === 'A') &&
        !isInputActive
      ) {
        if (queueState.items.length > 0 && !queueState.isPrinting) {
          event.preventDefault();
          setSelectedRowKeys(queueState.items.map((item) => item.id));
        }
      }

      // Ctrl+P / Cmd+P：开始打印
      if ((event.ctrlKey || event.metaKey) && (event.key === 'p' || event.key === 'P')) {
        event.preventDefault();
        if (availability.printEnabled && queueState.items.length > 0 && !queueState.isPrinting) {
          void executePrint(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedRowKeys, queueState.isPrinting, queueState.items, availability.printEnabled, executePrint]);

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
      <Layout className="app-shell">
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
          <Space className="header-actions">
            <Button
              type="text"
              className="header-history-btn"
              icon={<Clock size={15} />}
              onClick={() => setHistoryOpen(true)}
            >
              打印历史
            </Button>
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
                {selectedRowKeys.length > 1 && (
                  <Button
                    type="text"
                    icon={<Settings2 size={14} />}
                    disabled={queueState.isPrinting}
                    onClick={() => setIsBatchSettingsOpen(true)}
                  >
                    批量设置（{selectedRowKeys.length}）
                  </Button>
                )}
                {selectedRowKeys.length > 0 && (
                  <Button
                    type="text"
                    danger
                    icon={<Trash2 size={14} />}
                    disabled={queueState.isPrinting}
                    onClick={handleBatchRemove}
                  >
                    移除选中（{selectedRowKeys.length}）
                  </Button>
                )}
                <Button
                  type="text"
                  danger
                  disabled={queueState.isPrinting || queueState.items.length === 0}
                  onClick={handleClearQueue}
                >
                  清空列表
                </Button>
              </Space>
            </div>
            <PrintSummary
              summary={queueState.lastSummary}
              onRetryFailed={() => {
                dispatch({ type: 'retry_failed' });
                void executePrint(true);
              }}
              onClearSucceeded={() => {
                const succeededIds = queueState.items
                  .filter((item) => item.status === 'succeeded')
                  .map((item) => item.id);
                if (succeededIds.length > 0) {
                  dispatch({ type: 'batch_remove', ids: succeededIds });
                  setSelectedRowKeys((prev) =>
                    prev.filter((k) => !succeededIds.includes(k as string)),
                  );
                  message.success(`已移除 ${succeededIds.length} 个成功文件`);
                }
              }}
            />
            <div className="queue-body">
              <PrintQueue
                items={queueState.items}
                globalSettings={globalSettings}
                isPrinting={queueState.isPrinting}
                selectedRowKeys={selectedRowKeys}
                sortOrder={queueState.order}
                onSelectionChange={(keys) => setSelectedRowKeys(keys)}
                onToggleSort={() => dispatch({ type: 'toggle_filename_sort' })}
                onReorderItems={(movingIds, targetId, position) =>
                  dispatch({ type: 'reorder_items', movingIds, targetId, position })
                }
                onRemove={(id) => {
                  dispatch({ type: 'remove_item', id });
                  setSelectedRowKeys((prev) => prev.filter((k) => k !== id));
                }}
                onOpenSettings={(id) => setSettingsItemId(id)}
                onAddFiles={() => void handlePickFiles()}
              />
            </div>
            <div className="queue-footer">
              <div className="queue-footer-stats">
                {queueState.isPrinting ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span className="queue-footer-status">
                      正在打印（
                      {
                        queueState.items.filter(
                          (i) =>
                            i.status === 'succeeded' ||
                            i.status === 'failed' ||
                            i.status === 'skipped',
                        ).length
                      }{' '}
                      / {queueState.items.length}）
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
                      status="active"
                      style={{ width: 130, margin: 0 }}
                    />
                    <Button
                      size="small"
                      danger
                      onClick={() => void handleCancelPrint()}
                    >
                      取消剩余
                    </Button>
                  </div>
                ) : (
                  <span className="queue-footer-count">
                    共 <strong>{queueState.items.length}</strong> 个文件
                    {pageStats.allKnown && pageStats.knownPages > 0
                      ? ` · ${pageStats.knownPages} 页 (预估耗纸 ${pageStats.estimatedSheets} 张)`
                      : ''}
                  </span>
                )}
              </div>
              <Space size={12} className="queue-footer-actions">
                <Checkbox
                  checked={autoClearOnSuccess}
                  disabled={queueState.isPrinting}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setAutoClearOnSuccess(checked);
                    try {
                      localStorage.setItem('printassist_auto_clear_on_success', String(checked));
                    } catch {
                      // ignore
                    }
                  }}
                >
                  全部打印成功后自动清空列表
                </Checkbox>
                <Button
                  icon={<FilePlus2 size={15} />}
                  disabled={queueState.isPrinting}
                  onClick={() => void handlePickFiles()}
                >
                  选择文件
                </Button>
                <Button
                  icon={<FolderPlus size={15} />}
                  disabled={queueState.isPrinting}
                  onClick={() => void handlePickFolder()}
                >
                  选择文件夹
                </Button>
                <Button
                  type="primary"
                  icon={<Printer size={16} />}
                  loading={queueState.isPrinting}
                  disabled={!availability.printEnabled || queueState.items.length === 0}
                  onClick={() => void executePrint(false)}
                  title={!availability.printEnabled ? availability.reasons.join('；') : undefined}
                >
                  开始打印
                </Button>
              </Space>
            </div>
          </Content>
          <Sider width={320} theme="light" className="control-rail">
            <GlobalSettingsPanel
              printers={printers}
              settings={globalSettings}
              loadingPrinters={loadingPrinters}
              loadingProperties={loadingProperties}
              savedProfiles={savedProfiles}
              loadingProfiles={loadingSavedProfiles}
              onRefreshPrinters={() => void refreshPrinters()}
              onOpenProperties={() => void handleOpenPrinterProperties()}
              onSelectProfile={(profileId) => void handleSelectSavedProfile(profileId)}
              onOpenSaveProfile={() => setSaveModalOpen(true)}
              onOpenProfileManager={() => setManagerModalOpen(true)}
              onChange={(nextSettings) => {
                const nextPrinterName = nextSettings.printerName;
                const printer = printers.find((item) => item.name === nextPrinterName);
                let updated = { ...nextSettings };

                if (nextPrinterName !== globalSettings.printerName) {
                  // Switched printer -> query its profiles and auto-load default
                  void (async () => {
                    const profiles = await fetchSavedProfiles(nextPrinterName);
                    const defaultProfile = profiles.find(
                      (p) => p.isDefault && p.compatibility === 'compatible',
                    );
                    if (defaultProfile) {
                      try {
                        const loaded = await loadPrinterProfile(defaultProfile.id);
                        setGlobalSettings((curr) => applyLoadedPersistentProfile(curr, loaded));
                        return;
                      } catch {
                        // ignore
                      }
                    }
                  })();

                  updated.persistentProfileId = undefined;
                  updated.persistentProfileName = undefined;
                  updated.driverProfileId = undefined;
                  updated.driverSummary = undefined;
                  updated.profileDirty = false;
                } else {
                  updated.profileDirty = isProfileDirty(updated, activeProfile?.settings);
                }

                setGlobalSettings(sanitizeSettingsForPrinter(updated, printer));
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
          dispatch({ type: 'update_override', id: settingsItem.id, override });
          message.success('已保存单文件设置');
        }}
        onBatchSave={(override) => {
          dispatch({
            type: 'batch_set_override',
            ids: selectedRowKeys as string[],
            override,
          });
        }}
      />
      <PrintHistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onReloadFiles={(paths) => {
          dispatch({ type: 'append_files', paths });
        }}
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
          setGlobalSettings((curr) => applyLoadedPersistentProfile(curr, loaded));
        }}
      />
    </ConfigProvider>
  );
}
