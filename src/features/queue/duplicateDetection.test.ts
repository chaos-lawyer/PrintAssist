import { describe, expect, it } from 'vitest';
import {
  normalizeLocalPath,
  partitionIncomingPaths,
  extractBaseFileName,
} from './duplicateDetection';
import type { QueueItem } from '../../domain/queueTypes';

function makeMockItem(path: string, fileName = 'file.pdf'): QueueItem {
  return {
    id: `mock::${path}`,
    path,
    fileName,
    kind: 'pdf',
    pageCount: null,
    status: 'ready',
    override: {},
    addedAt: Date.now(),
  };
}

describe('duplicateDetection', () => {
  describe('normalizeLocalPath', () => {
    it('normalizes slashes and lowercases paths', () => {
      expect(normalizeLocalPath('C:/Users/Admin/Doc.PDF')).toBe('c:\\users\\admin\\doc.pdf');
      expect(normalizeLocalPath('C:\\Users\\Admin\\Doc.PDF')).toBe('c:\\users\\admin\\doc.pdf');
    });

    it('collapses redundant consecutive backslashes', () => {
      expect(normalizeLocalPath('C:\\\\Users\\\\Admin\\\\Doc.PDF')).toBe('c:\\users\\admin\\doc.pdf');
      expect(normalizeLocalPath('C:/Users//Admin///Doc.PDF')).toBe('c:\\users\\admin\\doc.pdf');
    });

    it('trims trailing slashes unless root', () => {
      expect(normalizeLocalPath('C:\\Users\\Admin\\Folder\\')).toBe('c:\\users\\admin\\folder');
      expect(normalizeLocalPath('C:\\')).toBe('c:\\');
    });
  });

  describe('partitionIncomingPaths', () => {
    it('detects duplicates against existing queue items', () => {
      const existing = [
        makeMockItem('C:\\docs\\report.pdf'),
        makeMockItem('D:\\photos\\img.png'),
      ];

      const incoming = [
        'C:/docs/report.pdf', // duplicate (slash/case normalized)
        'C:\\docs\\invoice.pdf', // new
        'd:/photos/img.png', // duplicate
        'E:\\new\\file.docx', // new
      ];

      const result = partitionIncomingPaths(existing, incoming);
      expect(result.totalIncoming).toBe(4);
      expect(result.newPaths).toEqual(['C:\\docs\\invoice.pdf', 'E:\\new\\file.docx']);
      expect(result.duplicatePaths).toEqual(['C:/docs/report.pdf', 'd:/photos/img.png']);
    });

    it('detects duplicates within the incoming batch itself', () => {
      const existing: QueueItem[] = [];

      const incoming = [
        'C:\\docs\\report.pdf',
        'C:/docs/report.pdf', // duplicate of first incoming
        'C:\\docs\\other.pdf',
        'C:\\docs\\other.pdf', // duplicate of third incoming
      ];

      const result = partitionIncomingPaths(existing, incoming);
      expect(result.newPaths).toEqual(['C:\\docs\\report.pdf', 'C:\\docs\\other.pdf']);
      expect(result.duplicatePaths).toEqual(['C:/docs/report.pdf', 'C:\\docs\\other.pdf']);
    });

    it('does not falsely flag files with identical name but different directories', () => {
      const existing = [makeMockItem('C:\\projectA\\contract.pdf', 'contract.pdf')];
      const incoming = ['C:\\projectB\\contract.pdf'];

      const result = partitionIncomingPaths(existing, incoming);
      expect(result.newPaths).toEqual(['C:\\projectB\\contract.pdf']);
      expect(result.duplicatePaths).toEqual([]);
    });
  });

  describe('extractBaseFileName', () => {
    it('extracts filename correctly for both windows and unix slashes', () => {
      expect(extractBaseFileName('C:\\docs\\report.pdf')).toBe('report.pdf');
      expect(extractBaseFileName('/home/user/report.pdf')).toBe('report.pdf');
    });
  });

  describe('duplicate item selection logic (Ctrl+Shift+A)', () => {
    it('identifies all queue item IDs matching the target file path regardless of slash or case', () => {
      const items = [
        makeMockItem('C:\\docs\\A.pdf'),
        makeMockItem('C:\\docs\\B.pdf'),
        makeMockItem('c:/docs/a.pdf'),
        makeMockItem('C:\\docs\\C.pdf'),
        makeMockItem('C:/DOCS/A.PDF'),
      ];
      items[0].id = 'id-1';
      items[1].id = 'id-2';
      items[2].id = 'id-3';
      items[3].id = 'id-4';
      items[4].id = 'id-5';

      const targetKey = normalizeLocalPath(items[0].path);
      const duplicateIds = items
        .filter((i) => normalizeLocalPath(i.path) === targetKey)
        .map((i) => i.id);

      expect(duplicateIds).toEqual(['id-1', 'id-3', 'id-5']);
    });
  });
});
