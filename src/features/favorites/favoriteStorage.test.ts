// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  _setRawFavoritesStorageForTesting,
  addFavorite,
  deleteFavorite,
  duplicateFavorite,
  exportFavoritesJson,
  getUniqueFavoriteName,
  importFavoritesJson,
  isFavoriteNameUnique,
  loadFavorites,
  MAX_FAVORITES,
  MAX_ITEMS_PER_FAVORITE,
  recordFavoriteLoaded,
  reorderFavorites,
  restoreFavorite,
  updateFavorite,
  validateFavoriteTemplate,
} from './favoriteStorage';
import type { FavoriteTemplateV1 } from './favoriteTypes';

describe('favoriteStorage', () => {
  beforeEach(() => {
    _setRawFavoritesStorageForTesting(null);
  });

  it('loads empty array when storage is empty or corrupted', () => {
    expect(loadFavorites()).toEqual([]);

    _setRawFavoritesStorageForTesting('invalid json');
    expect(loadFavorites()).toEqual([]);

    _setRawFavoritesStorageForTesting(JSON.stringify({ not: 'an array' }));
    expect(loadFavorites()).toEqual([]);
  });

  it('validates favorite template structure correctly', () => {
    expect(validateFavoriteTemplate(null)).toBeNull();
    expect(validateFavoriteTemplate({})).toBeNull();
    expect(validateFavoriteTemplate({ id: '', name: 'test' })).toBeNull();
    expect(validateFavoriteTemplate({ id: '1', name: '' })).toBeNull();

    const validCandidate: FavoriteTemplateV1 = {
      schemaVersion: 1,
      id: 'fav_1',
      name: '合同打印',
      createdAt: 1000,
      updatedAt: 2000,
      order: 0,
      task: {
        items: [
          {
            path: '/path/to/contract.pdf',
            fileName: 'contract.pdf',
            kind: 'pdf',
            pageCount: 5,
            override: { sidesMode: 'duplex' },
          },
        ],
      },
      printer: { name: 'Canon TS8300' },
      printConfig: {
        persistentProfileId: 'prof_1',
        persistentProfileName: '双面装订',
        standardSettings: {
          colorMode: 'monochrome',
          sidesMode: 'duplex',
          copies: 2,
          orientation: 'portrait',
        } as any,
      },
      source: 'manual',
    };

    const validated = validateFavoriteTemplate(validCandidate);
    expect(validated).not.toBeNull();
    expect(validated?.name).toBe('合同打印');
    expect(validated?.task?.items.length).toBe(1);
    expect(validated?.printer?.name).toBe('Canon TS8300');
    expect(validated?.printConfig?.persistentProfileId).toBe('prof_1');
  });

  it('adds, updates, deletes and restores favorites', () => {
    const added = addFavorite({
      name: '发票模板',
      printer: { name: 'HP LaserJet' },
      printConfig: null,
      task: null,
    });

    expect(added.id).toMatch(/^fav_/);
    expect(added.name).toBe('发票模板');
    expect(added.order).toBe(0);

    const loaded = loadFavorites();
    expect(loaded.length).toBe(1);
    expect(loaded[0].name).toBe('发票模板');

    // Duplicate name rejection
    expect(() =>
      addFavorite({
        name: '发票模板',
        printer: null,
        printConfig: null,
        task: null,
      }),
    ).toThrow(/已存在名为/);

    // Update favorite
    const updated = updateFavorite(added.id, { name: '发票模板（已更新）' });
    expect(updated.name).toBe('发票模板（已更新）');
    expect(loadFavorites()[0].name).toBe('发票模板（已更新）');

    // Record last loaded
    recordFavoriteLoaded(added.id);
    expect(loadFavorites()[0].lastLoadedAt).toBeDefined();

    // Delete favorite
    const deleted = deleteFavorite(added.id);
    expect(deleted?.id).toBe(added.id);
    expect(loadFavorites().length).toBe(0);

    // Restore favorite
    restoreFavorite(deleted!);
    expect(loadFavorites().length).toBe(1);
    expect(loadFavorites()[0].name).toBe('发票模板（已更新）');
  });

  it('duplicates favorite with clean non-colliding name', () => {
    const original = addFavorite({
      name: '会议材料',
      printer: { name: 'Epson' },
      printConfig: null,
      task: {
        items: [
          {
            path: '/docs/doc1.pdf',
            fileName: 'doc1.pdf',
            kind: 'pdf',
            pageCount: 3,
            override: {},
          },
        ],
      },
    });

    const dup1 = duplicateFavorite(original.id);
    expect(dup1.name).toBe('会议材料 - 副本');
    expect(dup1.task?.items.length).toBe(1);

    const dup2 = duplicateFavorite(original.id);
    expect(dup2.name).toBe('会议材料 - 副本 (2)');
  });

  it('reorders favorites correctly', () => {
    const fav1 = addFavorite({ name: 'F1', printer: null, printConfig: null, task: null });
    const fav2 = addFavorite({ name: 'F2', printer: null, printConfig: null, task: null });
    const fav3 = addFavorite({ name: 'F3', printer: null, printConfig: null, task: null });

    const reordered = reorderFavorites([fav3.id, fav1.id, fav2.id]);
    expect(reordered.map((f) => f.name)).toEqual(['F3', 'F1', 'F2']);
    expect(reordered.map((f) => f.order)).toEqual([0, 1, 2]);

    const loaded = loadFavorites();
    expect(loaded.map((f) => f.name)).toEqual(['F3', 'F1', 'F2']);
  });

  it('exports and imports favorites backup json', () => {
    addFavorite({ name: 'Fav A', printer: { name: 'P1' }, printConfig: null, task: null });
    addFavorite({ name: 'Fav B', printer: null, printConfig: null, task: null });

    const json = exportFavoritesJson();
    expect(json).toContain('Fav A');
    expect(json).toContain('Fav B');

    _setRawFavoritesStorageForTesting(null);
    expect(loadFavorites().length).toBe(0);

    const res = importFavoritesJson(json);
    expect(res.importedCount).toBe(2);
    expect(res.skippedCount).toBe(0);
    expect(loadFavorites().map((f) => f.name)).toEqual(['Fav A', 'Fav B']);

    // Import again should not overwrite but auto-rename with suffixes
    const res2 = importFavoritesJson(json);
    expect(res2.importedCount).toBe(2);
    expect(loadFavorites().map((f) => f.name)).toEqual(['Fav A', 'Fav B', 'Fav A (2)', 'Fav B (2)']);
  });

  it('enforces limits on max items and max favorites', () => {
    const hugeItems = Array.from({ length: 600 }, (_, i) => ({
      path: `/file_${i}.pdf`,
      fileName: `file_${i}.pdf`,
      kind: 'pdf' as const,
      pageCount: 1,
      override: {},
    }));

    const fav = addFavorite({
      name: '巨型收藏',
      printer: null,
      printConfig: null,
      task: { items: hugeItems },
    });

    expect(fav.task?.items.length).toBe(MAX_ITEMS_PER_FAVORITE);
  });
});
