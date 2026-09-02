import type { QueueItem, QueueState } from '../../domain/queueTypes';
import type { PrintSettings } from '../../domain/printSettings';
import {
  applyLoadedPersistentProfile,
  sanitizeSettingsForPrinter,
} from '../../domain/printSettings';
import type { WorkspaceSnapshot } from '../undo/undoTypes';
import type { FavoriteTemplateV1 } from './favoriteTypes';
import type {
  LoadedPrinterProfileResult,
  SavedPrinterProfileSummary,
  SystemPrinter,
} from '../../shared/contracts/printer';
import type { PrinterPreferencesV1 } from '../printers/printerPreferences';
import { validateSupportedPaths, type ValidatePathsResult } from '../../api/nativeBridge';
import {
  normalizeLocalPath,
  partitionIncomingPaths,
  type PartitionResult,
} from '../queue/duplicateDetection';

function naturalSortItems(items: QueueItem[], direction: 'asc' | 'desc'): QueueItem[] {
  return [...items].sort((a, b) => {
    const cmp = a.fileName.localeCompare(b.fileName, 'zh-Hans', {
      numeric: true,
      sensitivity: 'base',
    });
    return direction === 'desc' ? -cmp : cmp;
  });
}

function generateItemId(): string {
  return `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export interface ResolveFavoriteOptions {
  favorite: FavoriteTemplateV1;
  currentQueue: QueueState;
  currentSettings: PrintSettings;
  systemPrinters: SystemPrinter[];
  printerPreferences: PrinterPreferencesV1;
  savedProfiles: SavedPrinterProfileSummary[];
  loadProfileFn?: (profileId: string) => Promise<LoadedPrinterProfileResult>;
  validatePathsFn?: (paths: string[]) => Promise<ValidatePathsResult>;
  duplicateDecision?: 'all' | 'new_only';
}

export interface ResolveFavoriteResult {
  status: 'ready' | 'needs_duplicate_decision' | 'blocked';
  blockedReason?: string;
  duplicateResult?: PartitionResult;
  nextSnapshot?: WorkspaceSnapshot;
  summary?: {
    favoriteName: string;
    appendedFilesCount: number;
    missingFilesCount: number;
    missingFilePaths: string[];
    targetPrinterName: string;
    printerStatus: 'matched' | 'unhidden' | 'missing' | 'offline' | 'unchanged';
    targetProfileName?: string;
    profileStatus: 'matched' | 'fallback_standard' | 'none';
    warnings: string[];
  };
}

export async function resolveFavorite(options: ResolveFavoriteOptions): Promise<ResolveFavoriteResult> {
  const {
    favorite,
    currentQueue,
    currentSettings,
    systemPrinters,
    printerPreferences,
    savedProfiles,
    loadProfileFn,
    validatePathsFn = validateSupportedPaths,
    duplicateDecision,
  } = options;

  if (
    currentQueue.isPrinting ||
    currentQueue.phase === 'pausing' ||
    currentQueue.phase === 'paused' ||
    currentQueue.phase === 'terminating'
  ) {
    return {
      status: 'blocked',
      blockedReason: '打印进行中，暂不可加载收藏',
    };
  }

  const warnings: string[] = [];

  // 1. 文件存在性预检与重复检查
  const rawFavoriteItems = favorite.task?.items || [];
  let validFavoriteItems = [...rawFavoriteItems];
  const missingFilePaths: string[] = [];

  if (rawFavoriteItems.length > 0) {
    const allPaths = rawFavoriteItems.map((i) => i.path).filter(Boolean);
    try {
      const validation = await validatePathsFn(allPaths);
      if (validation && Array.isArray(validation.missing) && validation.missing.length > 0) {
        const missingSet = new Set(validation.missing.map(normalizeLocalPath));
        validFavoriteItems = rawFavoriteItems.filter((i) => !missingSet.has(normalizeLocalPath(i.path)));
        missingFilePaths.push(...validation.missing);
        warnings.push(`收藏中有 ${validation.missing.length} 个文件已不存在或格式不支持，已自动跳过`);
      }
    } catch {
      // If validation fails unexpectedly, continue with raw items
    }
  }

  const existingItems = currentQueue.phase === 'completed' ? [] : currentQueue.items;
  const validPaths = validFavoriteItems.map((i) => i.path).filter(Boolean);

  if (validPaths.length > 0 && existingItems.length > 0) {
    const partition = partitionIncomingPaths(existingItems, validPaths);
    if (partition.duplicatePaths.length > 0 && !duplicateDecision) {
      return {
        status: 'needs_duplicate_decision',
        duplicateResult: partition,
      };
    }

    if (duplicateDecision === 'new_only') {
      const newPathsSet = new Set(partition.newPaths.map(normalizeLocalPath));
      validFavoriteItems = validFavoriteItems.filter((i) => newPathsSet.has(normalizeLocalPath(i.path)));
    }
  }

  // 2. 构建新追加的队列项
  const now = Date.now();
  const newQueueItems: QueueItem[] = validFavoriteItems.map((favItem, index) => ({
    id: generateItemId() + `_${index}`,
    path: favItem.path,
    fileName: favItem.fileName,
    kind: favItem.kind,
    pageCount: favItem.pageCount,
    status: 'ready',
    addedAt: now + index,
    override: favItem.override ? { ...favItem.override } : {},
  }));

  let combinedItems = [...existingItems, ...newQueueItems];
  if (currentQueue.order.mode === 'fileName') {
    combinedItems = naturalSortItems(combinedItems, currentQueue.order.direction);
  }

  // 3. 打印机解析
  let targetPrinterName = currentSettings.printerName;
  let printerStatus: 'matched' | 'unhidden' | 'missing' | 'offline' | 'unchanged' = 'unchanged';

  if (favorite.printer?.name) {
    const foundPrinter = systemPrinters.find((p) => p.name === favorite.printer!.name);
    if (foundPrinter) {
      targetPrinterName = foundPrinter.name;
      const isHidden = (printerPreferences.hiddenNames || []).includes(foundPrinter.name);
      if (isHidden) {
        printerStatus = 'unhidden';
      } else if (foundPrinter.statusCode !== 0) {
        printerStatus = 'offline';
        warnings.push(`打印机“${foundPrinter.name}”当前处于离线或不可用状态`);
      } else {
        printerStatus = 'matched';
      }
    } else {
      printerStatus = 'missing';
      warnings.push(`收藏指定的打印机“${favorite.printer.name}”未安装或不可用，已保留当前打印机`);
    }
  }

  const selectedPrinterInfo = systemPrinters.find((p) => p.name === targetPrinterName);

  // 4. 打印配置解析
  let nextSettings: PrintSettings = sanitizeSettingsForPrinter(
    {
      ...currentSettings,
      printerName: targetPrinterName,
      persistentProfileId: undefined,
      persistentProfileName: undefined,
      driverProfileId: undefined,
      driverSummary: undefined,
      profileDirty: false,
    },
    selectedPrinterInfo,
  );

  let profileStatus: 'matched' | 'fallback_standard' | 'none' = 'none';
  let targetProfileName: string | undefined;

  if (favorite.printConfig) {
    targetProfileName = favorite.printConfig.persistentProfileName;
    const profileId = favorite.printConfig.persistentProfileId;
    let appliedProfile = false;

    if (profileId && loadProfileFn) {
      // Verify profile is compatible with current target printer
      const isTargetPrinter = favorite.printer?.name ? targetPrinterName === favorite.printer.name : true;
      if (isTargetPrinter) {
        try {
          const loaded = await loadProfileFn(profileId);
          if (loaded && loaded.persistentProfile) {
            nextSettings = applyLoadedPersistentProfile(nextSettings, loaded);
            profileStatus = 'matched';
            targetProfileName = loaded.persistentProfile.name;
            appliedProfile = true;
          }
        } catch {
          appliedProfile = false;
        }
      }
    }

    if (!appliedProfile) {
      // Fallback to standardSettings snapshot
      const std = favorite.printConfig.standardSettings;
      if (std) {
        nextSettings = {
          ...nextSettings,
          colorMode: std.colorMode ?? nextSettings.colorMode,
          sidesMode: std.sidesMode ?? nextSettings.sidesMode,
          flipMode: std.flipMode ?? nextSettings.flipMode,
          copies: std.copies ?? nextSettings.copies,
          collateMode: std.collateMode ?? nextSettings.collateMode,
          collate: std.collate ?? nextSettings.collate,
          sourceCode: std.sourceCode ?? nextSettings.sourceCode,
          sourceName: std.sourceName ?? nextSettings.sourceName,
          scaleMode: std.scaleMode ?? nextSettings.scaleMode,
          nupLayout: std.nupLayout ?? nextSettings.nupLayout,
          nupScope: std.nupScope ?? nextSettings.nupScope,
          pageRange: std.pageRange ?? nextSettings.pageRange,
          profileDirty: true,
        };
        nextSettings = sanitizeSettingsForPrinter(nextSettings, selectedPrinterInfo);
        profileStatus = 'fallback_standard';
        if (profileId) {
          warnings.push(
            `收藏中的驱动配置“${favorite.printConfig.persistentProfileName || '已保存配置'}”未能完整恢复，已应用标准打印参数快照`,
          );
        }
      }
    }
  }

  // 5. 组装最终 WorkspaceSnapshot
  const nextQueueState: QueueState = {
    ...currentQueue,
    items: combinedItems,
    phase: 'editing',
    isPrinting: false,
    lastSummary: null,
  };

  const nextSnapshot: WorkspaceSnapshot = {
    queueState: nextQueueState,
    globalSettings: nextSettings,
    selectedRowKeys: [],
    activeId: newQueueItems.length > 0 ? newQueueItems[0].id : null,
  };

  return {
    status: 'ready',
    nextSnapshot,
    summary: {
      favoriteName: favorite.name,
      appendedFilesCount: newQueueItems.length,
      missingFilesCount: missingFilePaths.length,
      missingFilePaths,
      targetPrinterName,
      printerStatus,
      targetProfileName,
      profileStatus,
      warnings,
    },
  };
}
