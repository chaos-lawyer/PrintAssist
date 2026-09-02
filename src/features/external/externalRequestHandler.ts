import type {
  ExternalRequestV1,
  ExternalRequestResult,
} from './externalTypes';
import { writeExternalRequestResult } from '../../api/nativeBridge';

const PROCESSED_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_LOG_ENTRIES = 50;
const EXTERNAL_LOGS_STORAGE_KEY = 'printassist_external_request_logs';

const processedRequests = new Map<string, number>();

export function isRequestAlreadyProcessed(requestId: string): boolean {
  if (!requestId) return false;
  cleanExpiredRequestIds();
  return processedRequests.has(requestId);
}

export function recordRequestIdProcessed(requestId: string): void {
  if (!requestId) return;
  cleanExpiredRequestIds();
  processedRequests.set(requestId, Date.now());
}

export function cleanExpiredRequestIds(): void {
  const now = Date.now();
  for (const [id, time] of processedRequests.entries()) {
    if (now - time > PROCESSED_CACHE_TTL_MS) {
      processedRequests.delete(id);
    }
  }
}

export function resetProcessedRequestCache(): void {
  processedRequests.clear();
}

export interface ExternalRequestLogEntry {
  id: string;
  requestId: string;
  action: 'add' | 'print';
  pathsCount: number;
  favoriteId?: string;
  status: 'accepted' | 'completed' | 'rejected' | 'failed';
  message: string;
  timestamp: number;
}

export function loadExternalLogs(): ExternalRequestLogEntry[] {
  try {
    const raw = localStorage.getItem(EXTERNAL_LOGS_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ExternalRequestLogEntry[];
  } catch {
    return [];
  }
}

export function saveExternalLogs(logs: ExternalRequestLogEntry[]): void {
  try {
    localStorage.setItem(
      EXTERNAL_LOGS_STORAGE_KEY,
      JSON.stringify(logs.slice(0, MAX_LOG_ENTRIES)),
    );
  } catch {
    // ignore
  }
}

export function addExternalLog(
  entry: Omit<ExternalRequestLogEntry, 'id' | 'timestamp'>,
): ExternalRequestLogEntry {
  const fullEntry: ExternalRequestLogEntry = {
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
    ...entry,
  };
  const logs = loadExternalLogs();
  logs.unshift(fullEntry);
  saveExternalLogs(logs);
  return fullEntry;
}

export function clearExternalLogs(): void {
  try {
    localStorage.removeItem(EXTERNAL_LOGS_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Builds standard Quicker CLI command line string for adding files.
 */
export function buildQuickerAddCommand(exePath: string): string {
  const safeExe = exePath || 'PrintAssist.exe';
  return `"${safeExe}" --action add -- {selectedPaths}`;
}

/**
 * Builds standard Quicker CLI command line string for direct printing using a favorite.
 */
export function buildQuickerPrintCommand(
  exePath: string,
  favoriteId: string,
  options?: {
    duplicatePolicy?: 'ask' | 'skip' | 'include';
    busyPolicy?: 'reject' | 'enqueue';
    confirmBeforePrint?: boolean;
  },
): string {
  const safeExe = exePath || 'PrintAssist.exe';
  const dup = options?.duplicatePolicy || 'skip';
  const busy = options?.busyPolicy || 'reject';
  const confirmFlag = options?.confirmBeforePrint ? ' --confirm' : '';

  return `"${safeExe}" --action print --favorite-id "${favoriteId}" --duplicate ${dup} --busy ${busy}${confirmFlag} -- {selectedPaths}`;
}

/**
 * Helper to record and return external request result, also optionally writing to disk if resultFile specified.
 */
export async function emitExternalRequestResult(
  request: ExternalRequestV1,
  resultData: {
    status: 'accepted' | 'completed' | 'rejected' | 'failed';
    addedCount: number;
    skippedCount: number;
    message: string;
  },
): Promise<ExternalRequestResult> {
  const result: ExternalRequestResult = {
    requestId: request.requestId,
    status: resultData.status,
    action: request.action,
    addedCount: resultData.addedCount,
    skippedCount: resultData.skippedCount,
    message: resultData.message,
    timestamp: Date.now(),
  };

  addExternalLog({
    requestId: request.requestId,
    action: request.action,
    pathsCount: request.paths.length,
    favoriteId: request.favoriteId,
    status: result.status,
    message: result.message,
  });

  if (request.resultFile) {
    try {
      await writeExternalRequestResult(request.resultFile, result);
    } catch {
      // ignore write errors
    }
  }

  return result;
}
