import { describe, expect, it } from 'vitest';
import {
  filterHistoryRecords,
  formatFileNameSummary,
  formatHistoryTime,
  getBatchResultStatus,
} from './historyHelpers';
import type { PrintHistoryRecord } from './historyStorage';

describe('historyHelpers', () => {
  describe('formatHistoryTime', () => {
    it('formats display time without seconds and detailed time with seconds', () => {
      // 2026-08-30 14:32:05
      const date = new Date(2026, 7, 30, 14, 32, 5);
      const res = formatHistoryTime(date.getTime());
      expect(res.display).toBe('2026-08-30 14:32');
      expect(res.detailed).toBe('2026-08-30 14:32:05');
    });
  });

  describe('formatFileNameSummary', () => {
    it('handles empty files array', () => {
      const summary = formatFileNameSummary([]);
      expect(summary.first).toBe('未命名文件');
      expect(summary.second).toBeUndefined();
      expect(summary.moreCount).toBe(0);
    });

    it('handles 1 file', () => {
      const summary = formatFileNameSummary([{ fileName: 'contract.pdf' }]);
      expect(summary.first).toBe('contract.pdf');
      expect(summary.second).toBeUndefined();
      expect(summary.moreCount).toBe(0);
    });

    it('handles 2 files', () => {
      const summary = formatFileNameSummary([
        { fileName: 'contract.pdf' },
        { fileName: 'appendix.docx' },
      ]);
      expect(summary.first).toBe('contract.pdf');
      expect(summary.second).toBe('appendix.docx');
      expect(summary.moreCount).toBe(0);
    });

    it('handles 3 or more files and counts remaining', () => {
      const summary = formatFileNameSummary([
        { fileName: 'doc1.pdf' },
        { fileName: 'doc2.pdf' },
        { fileName: 'doc3.pdf' },
        { fileName: 'doc4.pdf' },
        { fileName: 'doc5.pdf' },
      ]);
      expect(summary.first).toBe('doc1.pdf');
      expect(summary.second).toBe('doc2.pdf');
      expect(summary.moreCount).toBe(3);
    });

    it('falls back to 未命名文件 when fileName is empty string or spaces', () => {
      const summary = formatFileNameSummary([{ fileName: '   ' }, { fileName: '' }]);
      expect(summary.first).toBe('未命名文件');
      expect(summary.second).toBe('未命名文件');
    });
  });

  describe('getBatchResultStatus', () => {
    it('identifies all success', () => {
      const status = getBatchResultStatus({
        succeededCount: 5,
        failedCount: 0,
        skippedCount: 0,
      });
      expect(status.text).toBe('全部成功');
      expect(status.tagColor).toBe('success');
      expect(status.tooltip).toContain('成功: 5');
    });

    it('identifies all failed', () => {
      const status = getBatchResultStatus({
        succeededCount: 0,
        failedCount: 3,
        skippedCount: 0,
      });
      expect(status.text).toBe('全部失败');
      expect(status.tagColor).toBe('error');
    });

    it('identifies all skipped', () => {
      const status = getBatchResultStatus({
        succeededCount: 0,
        failedCount: 0,
        skippedCount: 2,
      });
      expect(status.text).toBe('已跳过');
      expect(status.tagColor).toBe('default');
    });

    it('identifies partial failure', () => {
      const status = getBatchResultStatus({
        succeededCount: 2,
        failedCount: 1,
        skippedCount: 1,
      });
      expect(status.text).toBe('部分失败');
      expect(status.tagColor).toBe('warning');
    });
  });

  describe('filterHistoryRecords', () => {
    const sampleRecords: PrintHistoryRecord[] = [
      {
        id: '1',
        timestamp: 1000,
        printerName: 'P1',
        totalFiles: 2,
        succeededCount: 2,
        failedCount: 0,
        skippedCount: 0,
        files: [
          { fileName: 'Quarterly_Report_2026.pdf', path: 'path1', status: 'succeeded' },
          { fileName: 'Invoice_Aug.xlsx', path: 'path2', status: 'succeeded' },
        ],
      },
      {
        id: '2',
        timestamp: 2000,
        printerName: 'P2',
        totalFiles: 1,
        succeededCount: 1,
        failedCount: 0,
        skippedCount: 0,
        files: [{ fileName: 'Presentation.pptx', path: 'path3', status: 'succeeded' }],
      },
    ];

    it('returns all records when query is empty', () => {
      expect(filterHistoryRecords(sampleRecords, '')).toHaveLength(2);
    });

    it('filters by filename case-insensitively across all files in batch', () => {
      const matchesReport = filterHistoryRecords(sampleRecords, 'report');
      expect(matchesReport).toHaveLength(1);
      expect(matchesReport[0].id).toBe('1');

      const matchesInvoice = filterHistoryRecords(sampleRecords, 'INVOICE');
      expect(matchesInvoice).toHaveLength(1);
      expect(matchesInvoice[0].id).toBe('1');

      const matchesPpt = filterHistoryRecords(sampleRecords, 'presentation');
      expect(matchesPpt).toHaveLength(1);
      expect(matchesPpt[0].id).toBe('2');

      const matchesNone = filterHistoryRecords(sampleRecords, 'nonexistent');
      expect(matchesNone).toHaveLength(0);
    });
  });
});
