import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_HISTORY_ITEMS,
  _setRawStorageForTesting,
  clearPrintHistory,
  loadPrintHistory,
  savePrintHistoryRecord,
  setPrintHistoryFavorite,
} from './historyStorage';

describe('historyStorage', () => {
  beforeEach(() => {
    clearPrintHistory();
  });

  it('saves and loads print history records', () => {
    expect(loadPrintHistory()).toEqual([]);

    savePrintHistoryRecord({
      printerName: 'Canon iR-ADV C5535',
      totalFiles: 2,
      succeededCount: 2,
      failedCount: 0,
      skippedCount: 0,
      files: [
        { fileName: 'report.pdf', path: 'C:\\docs\\report.pdf', status: 'succeeded' },
        { fileName: 'invoice.pdf', path: 'C:\\docs\\invoice.pdf', status: 'succeeded' },
      ],
    });

    const records = loadPrintHistory();
    expect(records).toHaveLength(1);
    expect(records[0].printerName).toBe('Canon iR-ADV C5535');
    expect(records[0].totalFiles).toBe(2);
    expect(records[0].succeededCount).toBe(2);
    expect(records[0].files).toHaveLength(2);
    expect(records[0].isFavorite).toBe(false);
  });

  it('prepends newer records first', () => {
    savePrintHistoryRecord({
      printerName: 'Printer 1',
      totalFiles: 1,
      succeededCount: 1,
      failedCount: 0,
      skippedCount: 0,
      files: [{ fileName: 'a.pdf', path: 'a.pdf', status: 'succeeded' }],
    });

    savePrintHistoryRecord({
      printerName: 'Printer 2',
      totalFiles: 1,
      succeededCount: 1,
      failedCount: 0,
      skippedCount: 0,
      files: [{ fileName: 'b.pdf', path: 'b.pdf', status: 'succeeded' }],
    });

    const records = loadPrintHistory();
    expect(records).toHaveLength(2);
    expect(records[0].printerName).toBe('Printer 2');
    expect(records[1].printerName).toBe('Printer 1');
  });

  it('clears history', () => {
    savePrintHistoryRecord({
      printerName: 'Printer 1',
      totalFiles: 1,
      succeededCount: 1,
      failedCount: 0,
      skippedCount: 0,
      files: [{ fileName: 'a.pdf', path: 'a.pdf', status: 'succeeded' }],
    });
    expect(loadPrintHistory()).toHaveLength(1);
    clearPrintHistory();
    expect(loadPrintHistory()).toHaveLength(0);
  });

  it('handles legacy records missing isFavorite and sets default to false', () => {
    const legacyData = [
      {
        id: 'legacy-1',
        timestamp: 1700000000000,
        printerName: 'Legacy Printer',
        totalFiles: 1,
        succeededCount: 1,
        failedCount: 0,
        skippedCount: 0,
        files: [{ fileName: 'legacy.pdf', path: 'C:\\legacy.pdf', status: 'succeeded' }],
        // no isFavorite
      },
    ];
    _setRawStorageForTesting(JSON.stringify(legacyData));

    const loaded = loadPrintHistory();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('legacy-1');
    expect(loaded[0].isFavorite).toBe(false);
  });

  it('updates favorite state for a specific record without affecting others', () => {
    savePrintHistoryRecord({
      printerName: 'Printer 1',
      totalFiles: 1,
      succeededCount: 1,
      failedCount: 0,
      skippedCount: 0,
      files: [{ fileName: 'doc1.pdf', path: 'doc1.pdf', status: 'succeeded' }],
    });
    savePrintHistoryRecord({
      printerName: 'Printer 2',
      totalFiles: 1,
      succeededCount: 1,
      failedCount: 0,
      skippedCount: 0,
      files: [{ fileName: 'doc2.pdf', path: 'doc2.pdf', status: 'succeeded' }],
    });

    const records = loadPrintHistory();
    const targetId = records[1].id;

    const success = setPrintHistoryFavorite(targetId, true);
    expect(success).toBe(true);

    const updated = loadPrintHistory();
    expect(updated[1].id).toBe(targetId);
    expect(updated[1].isFavorite).toBe(true);
    expect(updated[0].isFavorite).toBe(false);

    // Unfavorite
    setPrintHistoryFavorite(targetId, false);
    expect(loadPrintHistory()[1].isFavorite).toBe(false);
  });

  it('returns false when trying to favorite a non-existent id', () => {
    const success = setPrintHistoryFavorite('non-existent-id', true);
    expect(success).toBe(false);
  });

  it('prioritizes evicting un-favorited records when reaching maximum capacity', () => {
    for (let i = 0; i < MAX_HISTORY_ITEMS; i++) {
      savePrintHistoryRecord({
        printerName: `Printer ${i}`,
        totalFiles: 1,
        succeededCount: 1,
        failedCount: 0,
        skippedCount: 0,
        files: [{ fileName: `file_${i}.pdf`, path: `path_${i}`, status: 'succeeded' }],
      });
    }

    let records = loadPrintHistory();
    expect(records).toHaveLength(MAX_HISTORY_ITEMS);

    // Mark the oldest record (at the end of the array, i.e., Printer 0) as favorite
    const oldestId = records[records.length - 1].id;
    expect(records[records.length - 1].printerName).toBe('Printer 0');
    setPrintHistoryFavorite(oldestId, true);

    // Also mark another record as favorite
    const secondOldestId = records[records.length - 2].id;
    setPrintHistoryFavorite(secondOldestId, true);

    // Now insert a new record (Printer New)
    savePrintHistoryRecord({
      printerName: 'Printer New',
      totalFiles: 1,
      succeededCount: 1,
      failedCount: 0,
      skippedCount: 0,
      files: [{ fileName: 'new.pdf', path: 'new.pdf', status: 'succeeded' }],
    });

    records = loadPrintHistory();
    expect(records).toHaveLength(MAX_HISTORY_ITEMS);
    // Newest is at index 0
    expect(records[0].printerName).toBe('Printer New');
    // The favorited oldest records should still be preserved!
    expect(records.some((r) => r.id === oldestId)).toBe(true);
    expect(records.some((r) => r.id === secondOldestId)).toBe(true);
    // The un-favorited record 'Printer 2' (the oldest un-favorited one) should have been evicted
    expect(records.some((r) => r.printerName === 'Printer 2')).toBe(false);
  });

  it('evicts oldest record if all records are favorited', () => {
    const recordsToSave = [];
    for (let i = MAX_HISTORY_ITEMS - 1; i >= 0; i--) {
      recordsToSave.push({
        id: `id_${i}`,
        timestamp: 1000 + i,
        printerName: `Printer ${i}`,
        totalFiles: 1,
        succeededCount: 1,
        failedCount: 0,
        skippedCount: 0,
        isFavorite: true,
        files: [{ fileName: `file_${i}.pdf`, path: `path_${i}`, status: 'succeeded' as const }],
      });
    }
    _setRawStorageForTesting(JSON.stringify(recordsToSave));

    // Save a new record
    savePrintHistoryRecord({
      printerName: 'Printer Brand New',
      totalFiles: 1,
      succeededCount: 1,
      failedCount: 0,
      skippedCount: 0,
      files: [{ fileName: 'brandnew.pdf', path: 'brandnew.pdf', status: 'succeeded' }],
    });

    const loaded = loadPrintHistory();
    expect(loaded).toHaveLength(MAX_HISTORY_ITEMS);
    expect(loaded[0].printerName).toBe('Printer Brand New');
    // The oldest favorited record (id_0 at the end) should be evicted
    expect(loaded.some((r) => r.id === 'id_0')).toBe(false);
    expect(loaded.some((r) => r.id === 'id_1')).toBe(true);
  });

  it('handles corrupted JSON or missing fields gracefully', () => {
    _setRawStorageForTesting('invalid json {');
    expect(loadPrintHistory()).toEqual([]);

    _setRawStorageForTesting(
      JSON.stringify([
        null,
        undefined,
        {
          id: '',
          timestamp: 'invalid' as unknown as number,
          printerName: '',
          files: [{ fileName: '', path: '' }],
        },
      ])
    );
    const safeRecords = loadPrintHistory();
    expect(safeRecords).toHaveLength(1);
    expect(safeRecords[0].printerName).toBe('默认打印机');
    expect(safeRecords[0].files[0].fileName).toBe('未命名文件');
    expect(safeRecords[0].isFavorite).toBe(false);
  });
});
