export type PageRangeMode = 'all' | 'custom';

export interface PageRangeInput {
  mode: PageRangeMode;
  expression: string;
}

export interface PageRangeParseSuccess {
  ok: true;
  pages: number[];
  isDynamic?: boolean;
}

export interface PageRangeParseFailure {
  ok: false;
  message: string;
}

export type PageRangeParseResult = PageRangeParseSuccess | PageRangeParseFailure;

interface Endpoint {
  type: 'absolute' | 'fromEnd';
  value: number;
}

interface ParsedSegment {
  isExclude: boolean;
  rawText: string;
  start: Endpoint;
  end: Endpoint;
}

function normalizeExpression(expression: string): string {
  return expression
    .replace(/[\s\u3000]+/g, '')
    .replace(/，/g, ',')
    .replace(/！/g, '!')
    .replace(/[－—–]/g, '-');
}

function parseEndpoint(
  text: string,
  rawSegment: string,
): { ok: true; endpoint: Endpoint } | { ok: false; message: string } {
  if (!text) {
    return { ok: false, message: `页码段无效：${rawSegment}` };
  }

  const lower = text.toLowerCase();
  if (lower.startsWith('l')) {
    const remainder = lower.slice(1);
    if (!remainder) {
      return { ok: true, endpoint: { type: 'fromEnd', value: 1 } };
    }
    const offset = Number(remainder);
    if (!Number.isInteger(offset) || offset < 1) {
      return { ok: false, message: `倒数页码必须从 1 开始（如 L 或 L1）：${rawSegment}` };
    }
    return { ok: true, endpoint: { type: 'fromEnd', value: offset } };
  }

  const page = Number(text);
  if (!Number.isInteger(page) || page < 1) {
    return { ok: false, message: `页码段无效：${rawSegment}` };
  }
  return { ok: true, endpoint: { type: 'absolute', value: page } };
}

function resolveEndpoint(
  endpoint: Endpoint,
  totalPages?: number,
): { ok: true; page: number } | { ok: false; message: string } {
  if (endpoint.type === 'absolute') {
    if (totalPages !== undefined && endpoint.value > totalPages) {
      return { ok: false, message: `页码 ${endpoint.value} 超出文档总页数 ${totalPages}` };
    }
    return { ok: true, page: endpoint.value };
  }

  if (totalPages === undefined) {
    return { ok: false, message: '使用倒数页码语法（如 L 或 L1）需要提供文档总页数' };
  }
  if (endpoint.value > totalPages) {
    return { ok: false, message: `倒数第 ${endpoint.value} 页超出文档总页数 ${totalPages}` };
  }
  return { ok: true, page: totalPages - endpoint.value + 1 };
}

/**
 * Parses expressions such as:
 * - "1,3,5-8"
 * - "1-L" (where L or L1 is the last page)
 * - "1-L2" (where L2 is the second-to-last page)
 * - "1-10, !3, !L" (excludes page 3 and last page)
 * - "!1, !L" (implicit all pages, excluding page 1 and last page)
 *
 * Supports half-width and full-width commas (',' and '，'),
 * exclamation marks ('!' and '！'), and hyphens/dashes ('-', '－', '—', '–').
 * Pages are 1-based, unique, sorted ascending.
 */
export function parsePageRangeExpression(
  expression: string,
  totalPages?: number,
): PageRangeParseResult {
  const normalized = normalizeExpression(expression);
  if (!normalized) {
    return { ok: false, message: '页码表达式不能为空' };
  }

  const rawSegments = normalized.split(',');
  const parsedSegments: ParsedSegment[] = [];

  for (const raw of rawSegments) {
    if (!raw) {
      return { ok: false, message: '页码格式无效，存在连续逗号或空段' };
    }

    let isExclude = false;
    let body = raw;
    if (raw.startsWith('!')) {
      isExclude = true;
      body = raw.slice(1);
      if (!body || body.startsWith('!')) {
        return { ok: false, message: `排除语法无效：${raw}` };
      }
    }

    if (body.includes('-')) {
      const parts = body.split('-');
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        return { ok: false, message: `页码范围格式无效：${raw}` };
      }
      const startRes = parseEndpoint(parts[0], raw);
      if (!startRes.ok) return startRes;
      const endRes = parseEndpoint(parts[1], raw);
      if (!endRes.ok) return endRes;

      parsedSegments.push({
        isExclude,
        rawText: raw,
        start: startRes.endpoint,
        end: endRes.endpoint,
      });
    } else {
      const epRes = parseEndpoint(body, raw);
      if (!epRes.ok) return epRes;
      parsedSegments.push({
        isExclude,
        rawText: raw,
        start: epRes.endpoint,
        end: epRes.endpoint,
      });
    }
  }

  // Check if static validation is possible without totalPages
  const hasDynamic = parsedSegments.some(
    (seg) => seg.start.type === 'fromEnd' || seg.end.type === 'fromEnd',
  );
  const hasInclude = parsedSegments.some((seg) => !seg.isExclude);

  // If both ends of a range are absolute, we can always validate start <= end immediately
  for (const seg of parsedSegments) {
    if (seg.start.type === 'absolute' && seg.end.type === 'absolute') {
      if (seg.start.value > seg.end.value) {
        return { ok: false, message: `页码范围起止颠倒：${seg.rawText}` };
      }
    }
  }

  // If totalPages is not provided and expression has dynamic endpoints or only exclusions:
  if (totalPages === undefined && (hasDynamic || !hasInclude)) {
    // Syntax is valid, but full page list cannot be resolved statically.
    return { ok: true, pages: [], isDynamic: true };
  }

  const includeSet = new Set<number>();
  if (!hasInclude) {
    if (totalPages === undefined) {
      return { ok: false, message: '仅指定排除页码时必须提供文档总页数' };
    }
    for (let page = 1; page <= totalPages; page += 1) {
      includeSet.add(page);
    }
  }

  const excludeSet = new Set<number>();

  for (const seg of parsedSegments) {
    const startRes = resolveEndpoint(seg.start, totalPages);
    if (!startRes.ok) return startRes;
    const endRes = resolveEndpoint(seg.end, totalPages);
    if (!endRes.ok) return endRes;

    const startPage = startRes.page;
    const endPage = endRes.page;
    if (startPage > endPage) {
      return { ok: false, message: `页码范围起止颠倒：${seg.rawText}` };
    }

    const targetSet = seg.isExclude ? excludeSet : includeSet;
    for (let p = startPage; p <= endPage; p += 1) {
      targetSet.add(p);
    }
  }

  for (const ex of excludeSet) {
    includeSet.delete(ex);
  }

  const pages = Array.from(includeSet).sort((a, b) => a - b);
  if (pages.length === 0) {
    return { ok: false, message: '未解析到有效页码（排除后无剩余页码）' };
  }

  return { ok: true, pages };
}

export function describePageRange(pageRange: PageRangeInput): string {
  if (pageRange.mode === 'all') {
    return '全部页';
  }
  return pageRange.expression.trim() || '未指定';
}
