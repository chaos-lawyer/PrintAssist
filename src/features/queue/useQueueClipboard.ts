import { useCallback, useState } from 'react';
import type { QueueItemSnapshot } from './queueReducer';

export interface QueueClipboardState {
  mode: 'copy' | 'cut';
  snapshots: QueueItemSnapshot[];
  sourceIds: string[];
}

export function useQueueClipboard() {
  const [clipboard, setClipboard] = useState<QueueClipboardState | null>(null);

  const copy = useCallback((snapshots: QueueItemSnapshot[], sourceIds: string[]) => {
    setClipboard({
      mode: 'copy',
      snapshots,
      sourceIds,
    });
  }, []);

  const cut = useCallback((snapshots: QueueItemSnapshot[], sourceIds: string[]) => {
    setClipboard({
      mode: 'cut',
      snapshots,
      sourceIds,
    });
  }, []);

  const clear = useCallback(() => {
    setClipboard(null);
  }, []);

  const updateCutSources = useCallback((sourceIds: string[]) => {
    setClipboard((prev) => {
      if (!prev || prev.mode !== 'cut') return prev;
      return {
        ...prev,
        sourceIds,
      };
    });
  }, []);

  return {
    clipboard,
    copy,
    cut,
    clear,
    updateCutSources,
    hasContent: Boolean(clipboard && clipboard.snapshots.length > 0),
  };
}
