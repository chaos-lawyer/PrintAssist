import type {
  FavoriteTemplateV1,
  FavoriteTaskSnapshot,
  FavoritePrinterRef,
  FavoritePrintConfig,
} from './favoriteTypes';

export const FAVORITES_STORAGE_KEY = 'printassist_favorites_v1';
export const MAX_FAVORITES = 100;
export const MAX_ITEMS_PER_FAVORITE = 500;
export const MAX_NAME_LENGTH = 60;

const memoryStorage: Record<string, string> = {};

function getStorage(): {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
} {
  const isStorageLike = (value: unknown): value is {
    getItem: (k: string) => string | null;
    setItem: (k: string, v: string) => void;
    removeItem: (k: string) => void;
  } => {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Record<string, unknown>;
    return (
      typeof candidate.getItem === 'function' &&
      typeof candidate.setItem === 'function' &&
      typeof candidate.removeItem === 'function'
    );
  };

  try {
    if (typeof window !== 'undefined' && isStorageLike(window.localStorage)) {
      return window.localStorage;
    }
  } catch {
    // ignore
  }

  try {
    if (typeof localStorage !== 'undefined' && isStorageLike(localStorage)) {
      return localStorage;
    }
  } catch {
    // ignore
  }

  return {
    getItem: (k: string) => memoryStorage[k] ?? null,
    setItem: (k: string, v: string) => {
      memoryStorage[k] = v;
    },
    removeItem: (k: string) => {
      delete memoryStorage[k];
    },
  };
}

export function _setRawFavoritesStorageForTesting(value: string | null): void {
  const storage = getStorage();
  if (value === null) {
    storage.removeItem(FAVORITES_STORAGE_KEY);
  } else {
    storage.setItem(FAVORITES_STORAGE_KEY, value);
  }
}

export function generateFavoriteId(): string {
  return `fav_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function sanitizeFavoriteName(name: string): string {
  return name.trim().slice(0, MAX_NAME_LENGTH);
}

export function validateFavoriteTemplate(candidate: unknown): FavoriteTemplateV1 | null {
  if (!candidate || typeof candidate !== 'object') return null;
  const item = candidate as Record<string, unknown>;

  if (item.schemaVersion !== 1 && item.schemaVersion !== undefined) {
    // Unsupported schema version
    return null;
  }

  if (typeof item.id !== 'string' || !item.id.trim()) {
    return null;
  }

  if (typeof item.name !== 'string' || !item.name.trim()) {
    return null;
  }

  const name = sanitizeFavoriteName(item.name);
  if (!name) return null;

  const createdAt = typeof item.createdAt === 'number' && !Number.isNaN(item.createdAt) ? item.createdAt : Date.now();
  const updatedAt = typeof item.updatedAt === 'number' && !Number.isNaN(item.updatedAt) ? item.updatedAt : createdAt;
  const lastLoadedAt = typeof item.lastLoadedAt === 'number' && !Number.isNaN(item.lastLoadedAt) ? item.lastLoadedAt : undefined;
  const order = typeof item.order === 'number' && !Number.isNaN(item.order) ? item.order : 0;
  const source = item.source === 'history-migration' || item.source === 'manual' ? item.source : 'manual';

  // Task validation
  let task: FavoriteTaskSnapshot | null = null;
  if (item.task && typeof item.task === 'object' && Array.isArray((item.task as Record<string, unknown>).items)) {
    const rawItems = (item.task as Record<string, unknown>).items as unknown[];
    const items = rawItems
      .filter((it): it is Record<string, unknown> => Boolean(it) && typeof it === 'object')
      .slice(0, MAX_ITEMS_PER_FAVORITE)
      .map((it) => ({
        path: typeof it.path === 'string' ? it.path : '',
        fileName: typeof it.fileName === 'string' && it.fileName.trim() ? it.fileName : '未命名文件',
        kind: (['pdf', 'image', 'word', 'excel', 'powerpoint', 'wps_text', 'wps_spreadsheet', 'wps_presentation'].includes(
          String(it.kind),
        )
          ? it.kind
          : 'pdf') as any,
        pageCount: typeof it.pageCount === 'number' && it.pageCount > 0 ? it.pageCount : null,
        override: it.override && typeof it.override === 'object' ? (it.override as any) : {},
      }));
    task = { items };
  }

  // Printer validation
  let printer: FavoritePrinterRef | null = null;
  if (item.printer && typeof item.printer === 'object') {
    const rawPrinter = item.printer as Record<string, unknown>;
    if (typeof rawPrinter.name === 'string' && rawPrinter.name.trim()) {
      printer = { name: rawPrinter.name.trim() };
    }
  }

  // Config validation
  let printConfig: FavoritePrintConfig | null = null;
  if (item.printConfig && typeof item.printConfig === 'object') {
    const rawConfig = item.printConfig as Record<string, unknown>;
    const std = rawConfig.standardSettings;
    if (std && typeof std === 'object') {
      const stdObj = std as Record<string, unknown>;
      printConfig = {
        persistentProfileId: typeof rawConfig.persistentProfileId === 'string' ? rawConfig.persistentProfileId : undefined,
        persistentProfileName: typeof rawConfig.persistentProfileName === 'string' ? rawConfig.persistentProfileName : undefined,
        standardSettings: {
          colorMode: stdObj.colorMode === 'color' ? 'color' : 'monochrome',
          sidesMode: stdObj.sidesMode === 'duplex' ? 'duplex' : 'simplex',
          copies: typeof stdObj.copies === 'number' && stdObj.copies > 0 ? Math.min(999, Math.floor(stdObj.copies)) : 1,
          orientation: stdObj.orientation === 'landscape' ? 'landscape' : 'portrait',
          pageRange: typeof stdObj.pageRange === 'string' ? stdObj.pageRange : undefined,
          paperSource: typeof stdObj.paperSource === 'string' ? stdObj.paperSource : undefined,
          paperSize: typeof stdObj.paperSize === 'string' ? stdObj.paperSize : undefined,
          nupMode: ['1', '2', '4', '6', '8', '9', '16'].includes(String(stdObj.nupMode)) ? (stdObj.nupMode as any) : undefined,
          nupOrder: stdObj.nupOrder === 'vertical' ? 'vertical' : 'horizontal',
          scaleMode: ['fit', 'fill', 'none'].includes(String(stdObj.scaleMode)) ? (stdObj.scaleMode as any) : undefined,
        } as any,
      };
    }
  }

  return {
    schemaVersion: 1,
    id: item.id.trim(),
    name,
    createdAt,
    updatedAt,
    lastLoadedAt,
    order,
    task,
    printer,
    printConfig,
    source,
  };
}

export function loadFavorites(): FavoriteTemplateV1[] {
  try {
    const raw = getStorage().getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const validated: FavoriteTemplateV1[] = [];
    for (const item of parsed) {
      const v = validateFavoriteTemplate(item);
      if (v) {
        validated.push(v);
      }
    }

    // Sort by order ascending, then by createdAt descending
    return validated.sort((a, b) => a.order - b.order || b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export function saveFavorites(favorites: FavoriteTemplateV1[]): void {
  const sanitized = favorites.slice(0, MAX_FAVORITES).map((fav, index) => ({
    ...fav,
    order: index,
  }));

  try {
    getStorage().setItem(FAVORITES_STORAGE_KEY, JSON.stringify(sanitized));
  } catch (err) {
    throw new Error('收藏保存失败，可能是本地存储空间不足');
  }
}

export function isFavoriteNameUnique(name: string, excludeId?: string, list?: FavoriteTemplateV1[]): boolean {
  const favorites = list ?? loadFavorites();
  const lower = name.trim().toLowerCase();
  return !favorites.some((f) => f.id !== excludeId && f.name.trim().toLowerCase() === lower);
}

export function getUniqueFavoriteName(baseName: string, excludeId?: string, list?: FavoriteTemplateV1[]): string {
  const favorites = list ?? loadFavorites();
  let candidate = sanitizeFavoriteName(baseName);
  if (!candidate) candidate = '未命名收藏';

  if (isFavoriteNameUnique(candidate, excludeId, favorites)) {
    return candidate;
  }

  let index = 2;
  while (index < 1000) {
    const suffixed = `${candidate} (${index})`;
    if (isFavoriteNameUnique(suffixed, excludeId, favorites)) {
      return suffixed;
    }
    index++;
  }
  return `${candidate}_${Date.now()}`;
}

export function addFavorite(
  template: Omit<FavoriteTemplateV1, 'id' | 'createdAt' | 'updatedAt' | 'order' | 'schemaVersion'> &
    Partial<Pick<FavoriteTemplateV1, 'id' | 'order'>>,
): FavoriteTemplateV1 {
  const favorites = loadFavorites();
  if (favorites.length >= MAX_FAVORITES) {
    throw new Error(`收藏数量已达到上限（最多 ${MAX_FAVORITES} 个），请先清理不需要的收藏`);
  }

  const name = sanitizeFavoriteName(template.name);
  if (!name) {
    throw new Error('收藏名称不能为空');
  }

  if (!isFavoriteNameUnique(name, undefined, favorites)) {
    throw new Error(`已存在名为“${name}”的收藏，请使用其他名称`);
  }

  const now = Date.now();
  let task = template.task || null;
  if (task && Array.isArray(task.items)) {
    task = {
      items: task.items.slice(0, MAX_ITEMS_PER_FAVORITE),
    };
  }

  const newFavorite: FavoriteTemplateV1 = {
    schemaVersion: 1,
    id: template.id || generateFavoriteId(),
    name,
    createdAt: now,
    updatedAt: now,
    order: template.order ?? favorites.length,
    task,
    printer: template.printer || null,
    printConfig: template.printConfig || null,
    source: template.source || 'manual',
  };

  const nextFavorites = [...favorites, newFavorite];
  saveFavorites(nextFavorites);
  return newFavorite;
}

export function updateFavorite(
  id: string,
  patch: Partial<Omit<FavoriteTemplateV1, 'id' | 'schemaVersion' | 'createdAt'>>,
): FavoriteTemplateV1 {
  const favorites = loadFavorites();
  const index = favorites.findIndex((f) => f.id === id);
  if (index === -1) {
    throw new Error('未找到指定的收藏项');
  }

  const current = favorites[index];

  if (patch.name !== undefined) {
    const trimmed = sanitizeFavoriteName(patch.name);
    if (!trimmed) {
      throw new Error('收藏名称不能为空');
    }
    if (!isFavoriteNameUnique(trimmed, id, favorites)) {
      throw new Error(`已存在名为“${trimmed}”的收藏，请使用其他名称`);
    }
    patch.name = trimmed;
  }

  const updated: FavoriteTemplateV1 = {
    ...current,
    ...patch,
    updatedAt: Date.now(),
  };

  favorites[index] = updated;
  saveFavorites(favorites);
  return updated;
}

export function recordFavoriteLoaded(id: string): void {
  try {
    const favorites = loadFavorites();
    const index = favorites.findIndex((f) => f.id === id);
    if (index !== -1) {
      favorites[index] = {
        ...favorites[index],
        lastLoadedAt: Date.now(),
      };
      saveFavorites(favorites);
    }
  } catch {
    // non-fatal
  }
}

export function deleteFavorite(id: string): FavoriteTemplateV1 | null {
  const favorites = loadFavorites();
  const index = favorites.findIndex((f) => f.id === id);
  if (index === -1) {
    return null;
  }

  const [removed] = favorites.splice(index, 1);
  saveFavorites(favorites);
  return removed;
}

export function restoreFavorite(favorite: FavoriteTemplateV1): void {
  const favorites = loadFavorites();
  if (favorites.some((f) => f.id === favorite.id)) {
    return;
  }
  const name = getUniqueFavoriteName(favorite.name, undefined, favorites);
  const toRestore: FavoriteTemplateV1 = {
    ...favorite,
    name,
    order: Math.min(favorite.order, favorites.length),
  };
  favorites.splice(toRestore.order, 0, toRestore);
  saveFavorites(favorites);
}

export function duplicateFavorite(id: string): FavoriteTemplateV1 {
  const favorites = loadFavorites();
  const target = favorites.find((f) => f.id === id);
  if (!target) {
    throw new Error('未找到指定的收藏项');
  }

  const newName = getUniqueFavoriteName(`${target.name} - 副本`, undefined, favorites);
  return addFavorite({
    name: newName,
    task: target.task ? JSON.parse(JSON.stringify(target.task)) : null,
    printer: target.printer ? { ...target.printer } : null,
    printConfig: target.printConfig ? JSON.parse(JSON.stringify(target.printConfig)) : null,
    source: 'manual',
  });
}

export function reorderFavorites(orderedIds: string[]): FavoriteTemplateV1[] {
  const favorites = loadFavorites();
  const map = new Map(favorites.map((f) => [f.id, f]));
  const reordered: FavoriteTemplateV1[] = [];

  for (const id of orderedIds) {
    const found = map.get(id);
    if (found) {
      reordered.push({ ...found, order: reordered.length });
      map.delete(id);
    }
  }

  // Append any remaining
  for (const remaining of map.values()) {
    reordered.push({ ...remaining, order: reordered.length });
  }

  saveFavorites(reordered);
  return reordered;
}

export interface FavoritesExportPayload {
  version: 1;
  exportedAt: number;
  favorites: FavoriteTemplateV1[];
}

export function exportFavoritesJson(): string {
  const favorites = loadFavorites();
  const payload: FavoritesExportPayload = {
    version: 1,
    exportedAt: Date.now(),
    favorites,
  };
  return JSON.stringify(payload, null, 2);
}

export function importFavoritesJson(jsonStr: string): { importedCount: number; skippedCount: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('无效的 JSON 格式文件');
  }

  let rawList: unknown[] = [];
  if (Array.isArray(parsed)) {
    rawList = parsed;
  } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).favorites)) {
    rawList = (parsed as Record<string, unknown>).favorites as unknown[];
  } else {
    throw new Error('未能识别有效的收藏备份数据');
  }

  const currentFavorites = loadFavorites();
  let importedCount = 0;
  let skippedCount = 0;

  for (const item of rawList) {
    if (currentFavorites.length >= MAX_FAVORITES) {
      break;
    }
    const validated = validateFavoriteTemplate(item);
    if (!validated) {
      skippedCount++;
      continue;
    }

    // Auto rename if colliding
    const uniqueName = getUniqueFavoriteName(validated.name, undefined, currentFavorites);
    const newFav: FavoriteTemplateV1 = {
      ...validated,
      id: generateFavoriteId(),
      name: uniqueName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      order: currentFavorites.length,
    };
    currentFavorites.push(newFav);
    importedCount++;
  }

  if (importedCount > 0) {
    saveFavorites(currentFavorites);
  }

  return { importedCount, skippedCount };
}
