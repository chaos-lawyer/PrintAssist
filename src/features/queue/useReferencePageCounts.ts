import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch } from 'react';
import type { QueueAction } from './queueReducer';
import type {
  QueueItem,
  ReferencePageCountReason,
  ReferencePageCountSource,
  ReferencePageCountStatus,
} from '../../domain/queueTypes';
import { getReferencePageCount } from '../../api/nativeBridge';

interface CacheEntry {
  pageCount: number | null;
  status: ReferencePageCountStatus;
  source: ReferencePageCountSource;
  reason?: ReferencePageCountReason;
  fileVersion: string;
}

const MAX_CACHE_SIZE = 1000;
const BATCH_FLUSH_INTERVAL_MS = 60;

class SimpleLRUCache<K, V> {
  private map = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) {
        this.map.delete(firstKey);
      }
    }
    this.map.set(key, value);
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

// Session-level LRU cache
const sessionPageCountCache = new SimpleLRUCache<string, CacheEntry>(MAX_CACHE_SIZE);

export function isSupportedReferenceFormat(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext === 'docx' || ext === 'pdf';
}

function getCacheKey(path: string, fileSize?: number, modifiedAt?: number): string {
  if (fileSize !== undefined && modifiedAt !== undefined) {
    return `${path}:${fileSize}:${modifiedAt}`;
  }
  return path;
}

export interface UseReferencePageCountsOptions {
  items: QueueItem[];
  isPrinting: boolean;
  dispatch: Dispatch<QueueAction>;
}

export function useReferencePageCounts({
  items,
  isPrinting,
  dispatch,
}: UseReferencePageCountsOptions) {
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const isPrintingRef = useRef(isPrinting);
  isPrintingRef.current = isPrinting;

  const inFlightRef = useRef(false);
  const currentIdRef = useRef<string | null>(null);
  const generationRef = useRef(0);

  const batchBufferRef = useRef<
    Record<
      string,
      {
        pageCount: number | null;
        status: ReferencePageCountStatus;
        source?: ReferencePageCountSource;
        reason?: ReferencePageCountReason;
        fileVersion?: string;
      }
    >
  >({});
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushBatch = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const updates = batchBufferRef.current;
    if (Object.keys(updates).length === 0) return;
    batchBufferRef.current = {};
    dispatch({ type: 'update_reference_page_counts', updates });
  }, [dispatch]);

  const queueUpdate = useCallback(
    (
      itemId: string,
      update: {
        pageCount: number | null;
        status: ReferencePageCountStatus;
        source?: ReferencePageCountSource;
        reason?: ReferencePageCountReason;
        fileVersion?: string;
      },
    ) => {
      batchBufferRef.current[itemId] = update;
      if (!flushTimerRef.current) {
        flushTimerRef.current = setTimeout(flushBatch, BATCH_FLUSH_INTERVAL_MS);
      }
    },
    [flushBatch],
  );

  const processNext = useCallback(async () => {
    if (inFlightRef.current || isPrintingRef.current) return;

    const currentItems = itemsRef.current;
    const nextItem = currentItems.find(
      (item) =>
        isSupportedReferenceFormat(item.path) &&
        (item.pageCountStatus === 'pending' ||
          item.pageCountStatus === undefined ||
          (item.pageCountStatus === 'loading' && currentIdRef.current !== item.id)),
    );

    if (!nextItem) return;

    // Check LRU cache first
    const cacheKey = getCacheKey(nextItem.path, nextItem.fileSize, nextItem.modifiedAt);
    const cached = sessionPageCountCache.get(cacheKey) || sessionPageCountCache.get(nextItem.path);

    if (cached) {
      queueUpdate(nextItem.id, {
        pageCount: cached.pageCount,
        status: cached.status,
        source: cached.source,
        reason: cached.reason,
        fileVersion: cached.fileVersion,
      });

      // Synchronize any duplicate items in the queue with the same path
      currentItems.forEach((it) => {
        if (
          it.id !== nextItem.id &&
          it.path === nextItem.path &&
          (it.pageCountStatus === 'pending' ||
            it.pageCountStatus === undefined ||
            it.pageCountStatus === 'loading')
        ) {
          queueUpdate(it.id, {
            pageCount: cached.pageCount,
            status: cached.status,
            source: cached.source,
            reason: cached.reason,
            fileVersion: cached.fileVersion,
          });
        }
      });

      setTimeout(processNext, 0);
      return;
    }

    inFlightRef.current = true;
    currentIdRef.current = nextItem.id;
    queueUpdate(nextItem.id, {
      pageCount: null,
      status: 'loading',
    });

    const requestGen = generationRef.current;
    const targetPath = nextItem.path;
    const targetId = nextItem.id;

    try {
      const result = await getReferencePageCount(targetPath);

      if (generationRef.current !== requestGen) return;

      const latestItems = itemsRef.current;
      const stillExists = latestItems.some((it) => it.id === targetId && it.path === targetPath);
      if (!stillExists) return;

      const fileVersion = `${result.fileSize ?? 0}:${result.modifiedAt ?? 0}`;
      const cacheEntry: CacheEntry = {
        pageCount: result.pageCount,
        status: result.status,
        source: result.source,
        reason: result.reason as ReferencePageCountReason,
        fileVersion,
      };

      sessionPageCountCache.set(
        getCacheKey(targetPath, result.fileSize, result.modifiedAt),
        cacheEntry,
      );
      sessionPageCountCache.set(targetPath, cacheEntry);

      latestItems.forEach((it) => {
        if (
          it.path === targetPath &&
          (it.id === targetId ||
            it.pageCountStatus === 'pending' ||
            it.pageCountStatus === 'loading' ||
            it.pageCountStatus === undefined)
        ) {
          queueUpdate(it.id, {
            pageCount: result.pageCount,
            status: result.status,
            source: result.source,
            reason: result.reason as ReferencePageCountReason,
            fileVersion,
          });
        }
      });
    } catch (err) {
      console.error('Failed to read reference page count', err);
      queueUpdate(targetId, {
        pageCount: null,
        status: 'unavailable',
        source: null,
        reason: 'ioError',
      });
    } finally {
      inFlightRef.current = false;
      currentIdRef.current = null;
      if (!isPrintingRef.current) {
        setTimeout(processNext, 0);
      }
    }
  }, [queueUpdate]);

  useEffect(() => {
    if (!isPrinting) {
      processNext();
    }
  }, [items, isPrinting, processNext]);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
      }
    };
  }, []);

  const refreshReferencePageCounts = useCallback(
    (ids?: string[]) => {
      const currentItems = itemsRef.current;
      const targetIds = ids && ids.length > 0 ? new Set(ids) : null;

      const updates: Record<
        string,
        {
          pageCount: number | null;
          status: ReferencePageCountStatus;
          reason?: ReferencePageCountReason;
        }
      > = {};

      for (const item of currentItems) {
        if (targetIds && !targetIds.has(item.id)) continue;
        if (!isSupportedReferenceFormat(item.path)) continue;

        sessionPageCountCache.delete(getCacheKey(item.path, item.fileSize, item.modifiedAt));
        sessionPageCountCache.delete(item.path);

        updates[item.id] = {
          pageCount: null,
          status: 'pending',
        };
      }

      if (Object.keys(updates).length > 0) {
        dispatch({ type: 'update_reference_page_counts', updates });
        setTimeout(processNext, 0);
      }
    },
    [dispatch, processNext],
  );

  return {
    refreshReferencePageCounts,
  };
}
