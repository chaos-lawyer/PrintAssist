import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import type { evaluateSettingAvailability, PrintSettings } from '../../domain/printSettings';
import type { QueueSortField, QueueState } from '../../domain/queueTypes';
import type {
  SavedPrinterProfileSummary,
  SystemPrinter,
} from '../../shared/contracts/printer';
import { loadFavorites } from '../favorites/favoriteStorage';
import type { FavoriteTemplateV1 } from '../favorites/favoriteTypes';
import { PRINT_BUSY_MESSAGES } from '../printing/printingMessages';
import { shouldIgnoreShortcut } from './shortcutGuards';
import {
  loadCustomShortcuts,
  matchShortcutKeys,
  saveCustomShortcuts,
} from './shortcutRegistry';

export type AvailabilityResult = ReturnType<typeof evaluateSettingAvailability>;

export interface UseKeyboardShortcutsOptions {
  queueState: QueueState;
  globalSettings: PrintSettings;
  availability: AvailabilityResult;
  selectedPrinter?: SystemPrinter;
  visiblePrinters: SystemPrinter[];
  savedProfiles: SavedPrinterProfileSummary[];
  loadingSavedProfiles: boolean;
  selectedRowKeys: React.Key[];
  activeId: string | null;
  visibleSortableColumns: { field: QueueSortField; label: string }[];
  commit: (label: string, updater: (curr: any) => any) => void;
  executePrint: (filterMode?: 'all' | 'failed' | 'remaining') => Promise<void>;
  handleUndo: () => void;
  handleRedo: () => void;
  handleBatchRemove: () => void;
  handleClearQueue: () => void;
  setSelectedRowKeys: React.Dispatch<React.SetStateAction<React.Key[]>>;
  handlePickFiles: () => Promise<void>;
  handlePickFolder: () => Promise<void>;
  setHistoryOpen: (open: boolean) => void;
  setIsBatchSettingsOpen: (open: boolean) => void;
  setSettingsItemId: (id: string | null) => void;
  handleSelectPrinter: (name: string) => Promise<void>;
  handleSelectSavedProfile: (id: string | null) => Promise<void>;
  handleToggleSort: (field: QueueSortField) => void;
  handleLoadFavorite: (favorite: FavoriteTemplateV1) => Promise<void>;
  setFavoritesModalOpen: (open: boolean) => void;
  setAddFavoriteModalOpen: (open: boolean) => void;
  setAddFavoritePrefill: (prefill: any) => void;
}

export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions) {
  const {
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
  } = options;

  const [customShortcuts, setCustomShortcuts] = useState<Record<string, string[]>>(loadCustomShortcuts);
  const customShortcutsRef = useRef(customShortcuts);
  customShortcutsRef.current = customShortcuts;

  const [isShortcutHelpOpen, setIsShortcutHelpOpen] = useState(false);

  const setTargetShortcut = useCallback((id: string, keys?: string[]) => {
    setCustomShortcuts((current) => {
      const next = { ...current };
      if (keys?.length) next[id] = keys;
      else delete next[id];
      saveCustomShortcuts(next);
      return next;
    });
  }, []);

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
            message.warning(PRINT_BUSY_MESSAGES.CLEAR_LIST);
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
            message.warning(PRINT_BUSY_MESSAGES.ADD_FILES);
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
            message.warning(PRINT_BUSY_MESSAGES.ADD_FILES);
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
            message.warning(PRINT_BUSY_MESSAGES.MODIFY_CONFIG);
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
            message.warning(PRINT_BUSY_MESSAGES.CHANGE_SETTINGS);
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
            message.warning(PRINT_BUSY_MESSAGES.CHANGE_SETTINGS);
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
            message.warning(PRINT_BUSY_MESSAGES.CHANGE_PRINTER);
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
            message.warning(PRINT_BUSY_MESSAGES.CHANGE_PRINTER);
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
            message.warning(PRINT_BUSY_MESSAGES.CHANGE_PROFILE);
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
            message.warning(PRINT_BUSY_MESSAGES.CHANGE_PROFILE);
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
            message.warning(PRINT_BUSY_MESSAGES.CHANGE_PRINTER);
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

      // 18. 'Ctrl + 1/2/3/4...'：根据当前显示的排序列排序
      if (isCtrlOrMeta && numMatch) {
        if (!shouldIgnoreShortcut(event, { isSingleKey: false })) {
          const colIndex = parseInt(numMatch[0], 10) - 1;
          if (colIndex < visibleSortableColumns.length) {
            event.preventDefault();
            const targetCol = visibleSortableColumns[colIndex];
            handleToggleSort(targetCol.field);
            const isAsc =
              queueState.order.mode === targetCol.field &&
              'direction' in queueState.order &&
              queueState.order.direction === 'asc';
            const nextDir = isAsc ? '倒序' : '正序';
            message.info(`按${targetCol.label}${nextDir}排序`);
            return;
          }
        }
      }

      // 19. '1' ~ '9'：应用当前打印机保存配置 1-9 (单键)
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
    globalSettings.persistentProfileId,
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
    setSelectedRowKeys,
    setHistoryOpen,
    setIsBatchSettingsOpen,
    setSettingsItemId,
    setFavoritesModalOpen,
    setAddFavoriteModalOpen,
    setAddFavoritePrefill,
    visiblePrinters,
    visibleSortableColumns,
  ]);

  return {
    customShortcuts,
    customShortcutsRef,
    setCustomShortcuts,
    setTargetShortcut,
    isShortcutHelpOpen,
    setIsShortcutHelpOpen,
  };
}
