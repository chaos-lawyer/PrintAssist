// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isRequestAlreadyProcessed,
  recordRequestIdProcessed,
  resetProcessedRequestCache,
  loadExternalLogs,
  saveExternalLogs,
  addExternalLog,
  clearExternalLogs,
  buildQuickerAddCommand,
  buildQuickerPrintCommand,
  emitExternalRequestResult,
} from './externalRequestHandler';
import type { ExternalRequestV1 } from './externalTypes';
import * as nativeBridge from '../../api/nativeBridge';

describe('externalRequestHandler', () => {
  beforeEach(() => {
    localStorage.clear();
    resetProcessedRequestCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    resetProcessedRequestCache();
  });

  describe('Request ID Deduplication', () => {
    it('detects duplicate request IDs and ignores empty IDs', () => {
      expect(isRequestAlreadyProcessed('')).toBe(false);
      expect(isRequestAlreadyProcessed('req_123')).toBe(false);

      recordRequestIdProcessed('req_123');
      expect(isRequestAlreadyProcessed('req_123')).toBe(true);
      expect(isRequestAlreadyProcessed('req_456')).toBe(false);
    });

    it('resets processed request cache', () => {
      recordRequestIdProcessed('req_1');
      expect(isRequestAlreadyProcessed('req_1')).toBe(true);

      resetProcessedRequestCache();
      expect(isRequestAlreadyProcessed('req_1')).toBe(false);
    });
  });

  describe('External Logs Management', () => {
    it('loads empty logs initially', () => {
      expect(loadExternalLogs()).toEqual([]);
    });

    it('adds and persists log entries up to maximum limit', () => {
      addExternalLog({
        requestId: 'req_1',
        action: 'add',
        pathsCount: 2,
        status: 'accepted',
        message: '已添加 2 个文件',
      });

      const logs = loadExternalLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].requestId).toBe('req_1');
      expect(logs[0].action).toBe('add');
      expect(logs[0].pathsCount).toBe(2);
      expect(logs[0].status).toBe('accepted');

      clearExternalLogs();
      expect(loadExternalLogs()).toEqual([]);
    });
  });

  describe('Quicker Command Builders', () => {
    it('builds standard Quicker add command', () => {
      const cmd = buildQuickerAddCommand('C:\\Program Files\\PrintAssist\\PrintAssist.exe');
      expect(cmd).toBe(
        '"C:\\Program Files\\PrintAssist\\PrintAssist.exe" --action add -- {selectedPaths}',
      );
    });

    it('builds standard Quicker direct print command with favorite ID and options', () => {
      const cmd = buildQuickerPrintCommand(
        'D:\\Tools\\PrintAssist.exe',
        'fav_invoice_01',
        {
          duplicatePolicy: 'skip',
          busyPolicy: 'reject',
          confirmBeforePrint: true,
        },
      );
      expect(cmd).toBe(
        '"D:\\Tools\\PrintAssist.exe" --action print --favorite-id "fav_invoice_01" --duplicate skip --busy reject --confirm -- {selectedPaths}',
      );
    });
  });

  describe('emitExternalRequestResult', () => {
    it('records log and calls writeExternalRequestResult when resultFile provided', async () => {
      const writeSpy = vi.spyOn(nativeBridge, 'writeExternalRequestResult').mockResolvedValue(undefined);

      const request: ExternalRequestV1 = {
        version: 1,
        requestId: 'req_test_abc',
        action: 'print',
        paths: ['/path/to/doc.pdf'],
        resultFile: '/tmp/result.json',
      };

      const result = await emitExternalRequestResult(request, {
        status: 'accepted',
        addedCount: 1,
        skippedCount: 0,
        message: '已提交打印',
      });

      expect(result.requestId).toBe('req_test_abc');
      expect(result.status).toBe('accepted');
      expect(result.action).toBe('print');

      const logs = loadExternalLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].requestId).toBe('req_test_abc');

      expect(writeSpy).toHaveBeenCalledWith('/tmp/result.json', expect.objectContaining({
        requestId: 'req_test_abc',
        status: 'accepted',
      }));
    });
  });
});
