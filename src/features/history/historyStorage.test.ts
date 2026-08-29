import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPrintHistory,
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
});
