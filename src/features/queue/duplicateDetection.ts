import type { QueueItem } from '../../domain/queueTypes';

/**
 * Normalizes a local file path for consistent cross-platform / Windows duplicate detection.
 * - Converts forward slashes to backslashes
 * - Trims trailing separators (except drive root like C:\)
 * - Collapses redundant consecutive separators
 * - Lowercases for case-insensitive comparison on Windows
 */
export function normalizeLocalPath(filePath: string): string {
  if (!filePath) return '';
  let normalized = filePath.trim().replace(/\//g, '\\');

  // Collapse consecutive backslashes (except leading UNC \\)
  const isUnc = normalized.startsWith('\\\\');
  if (isUnc) {
    normalized = '\\\\' + normalized.slice(2).replace(/\\+/g, '\\');
  } else {
    normalized = normalized.replace(/\\+/g, '\\');
  }

  // Remove trailing backslash unless drive root like C:\ or \
  if (normalized.length > 3 && normalized.endsWith('\\')) {
    normalized = normalized.slice(0, -1);
  }

  return normalized.toLowerCase();
}

export interface PartitionResult {
  newPaths: string[];
  duplicatePaths: string[];
  totalIncoming: number;
}

/**
 * Partitions incoming paths into newPaths and duplicatePaths.
 * Checks against both existing queue items and intra-batch duplicates.
 */
export function partitionIncomingPaths(
  existingItems: QueueItem[],
  incomingPaths: string[],
): PartitionResult {
  const existingPathKeys = new Set(
    existingItems.map((item) => normalizeLocalPath(item.path)),
  );

  const seenInBatch = new Set<string>();
  const newPaths: string[] = [];
  const duplicatePaths: string[] = [];

  for (const rawPath of incomingPaths) {
    const key = normalizeLocalPath(rawPath);
    if (!key) continue;

    if (existingPathKeys.has(key) || seenInBatch.has(key)) {
      duplicatePaths.push(rawPath);
    } else {
      newPaths.push(rawPath);
      seenInBatch.add(key);
    }
  }

  return {
    newPaths,
    duplicatePaths,
    totalIncoming: incomingPaths.length,
  };
}

export function extractBaseFileName(filePath: string): string {
  const normalized = filePath.replace(/\//g, '\\');
  const parts = normalized.split('\\').filter(Boolean);
  return parts[parts.length - 1] || filePath;
}
