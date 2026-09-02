import type { PrintHistoryRecord } from './historyStorage';

export interface HistoryTimeDisplay {
  display: string;
  detailed: string;
}

export function formatHistoryTime(timestamp: number): HistoryTimeDisplay {
  const d = new Date(timestamp);
  const pad = (n: number) => n.toString().padStart(2, '0');
  const datePart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const minutePart = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const secondPart = `${minutePart}:${pad(d.getSeconds())}`;

  return {
    display: `${datePart} ${minutePart}`,
    detailed: `${datePart} ${secondPart}`,
  };
}

export interface FileNameSummary {
  first: string;
  second?: string;
  moreCount: number;
}

export function getFileNameSummary(files: Array<{ fileName?: string }>): FileNameSummary {
  if (!files || files.length === 0) {
    return {
      first: '未命名文件',
      moreCount: 0,
    };
  }

  const cleanName = (name?: string) => (name && name.trim() ? name.trim() : '未命名文件');

  if (files.length === 1) {
    return {
      first: cleanName(files[0].fileName),
      moreCount: 0,
    };
  }

  if (files.length === 2) {
    return {
      first: cleanName(files[0].fileName),
      second: cleanName(files[1].fileName),
      moreCount: 0,
    };
  }

  return {
    first: cleanName(files[0].fileName),
    second: cleanName(files[1].fileName),
    moreCount: files.length - 2,
  };
}

export const formatFileNameSummary = getFileNameSummary;

export interface BatchResultStatus {
  text: string;
  tagColor: 'success' | 'warning' | 'error' | 'default';
  tooltip: string;
}

export function getBatchResultStatus(record: Pick<PrintHistoryRecord, 'succeededCount' | 'failedCount' | 'skippedCount'>): BatchResultStatus {
  const { succeededCount = 0, failedCount = 0, skippedCount = 0 } = record;
  const tooltip = `成功: ${succeededCount} · 失败: ${failedCount} · 跳过: ${skippedCount}`;

  if (failedCount === 0 && skippedCount === 0) {
    return {
      text: '全部成功',
      tagColor: 'success',
      tooltip,
    };
  }

  if (succeededCount === 0 && skippedCount === 0 && failedCount > 0) {
    return {
      text: '全部失败',
      tagColor: 'error',
      tooltip,
    };
  }

  if (succeededCount === 0 && failedCount === 0 && skippedCount > 0) {
    return {
      text: '已跳过',
      tagColor: 'default',
      tooltip,
    };
  }

  return {
    text: '部分失败',
    tagColor: 'warning',
    tooltip,
  };
}

export function filterHistoryRecords(
  records: PrintHistoryRecord[],
  searchQuery: string
): PrintHistoryRecord[] {
  const trimmed = searchQuery.trim().toLowerCase();
  if (!trimmed) {
    return records;
  }

  return records.filter((record) => {
    return record.files.some((f) =>
      (f.fileName || '').toLowerCase().includes(trimmed)
    );
  });
}
