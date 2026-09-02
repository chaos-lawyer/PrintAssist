import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_HISTORY_ITEMS,
  _setRawStorageForTesting,
  clearPrintHistory,
  deletePrintHistoryRecord,
  loadPrintHistory,
  savePrintHistoryRecord,
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

  it('evicts oldest record when reaching maximum capacity', () => {
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

    const oldestId = records[records.length - 1].id;
    expect(records[records.length - 1].printerName).toBe('Printer 0');

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
    // Oldest (Printer 0) is evicted
    expect(records.some((r) => r.id === oldestId)).toBe(false);
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
  });

  describe('deletePrintHistoryRecord', () => {
    it('deletes a record by id successfully', () => {
      savePrintHistoryRecord({
        printerName: 'Printer A',
        totalFiles: 1,
        succeededCount: 1,
        failedCount: 0,
        skippedCount: 0,
        files: [{ fileName: 'a.pdf', path: 'a.pdf', status: 'succeeded' }],
      });
      savePrintHistoryRecord({
        printerName: 'Printer B',
        totalFiles: 1,
        succeededCount: 1,
        failedCount: 0,
        skippedCount: 0,
        files: [{ fileName: 'b.pdf', path: 'b.pdf', status: 'succeeded' }],
      });

      const records = loadPrintHistory();
      expect(records).toHaveLength(2);
      const toDeleteId = records[0].id; // newest (Printer B)

      const success = deletePrintHistoryRecord(toDeleteId);
      expect(success).toBe(true);

      const remaining = loadPrintHistory();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).not.toBe(toDeleteId);
      expect(remaining[0].printerName).toBe('Printer A');
    });

    it('returns false when deleting a non-existent id', () => {
      savePrintHistoryRecord({
        printerName: 'Printer A',
        totalFiles: 1,
        succeededCount: 1,
        failedCount: 0,
        skippedCount: 0,
        files: [{ fileName: 'a.pdf', path: 'a.pdf', status: 'succeeded' }],
      });

      const success = deletePrintHistoryRecord('non-existent-id');
      expect(success).toBe(false);
      expect(loadPrintHistory()).toHaveLength(1);
    });
  });
});
