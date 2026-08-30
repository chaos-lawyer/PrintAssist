// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PrintJobSummary } from '../../domain/queueTypes';
import { PrintSummary } from './PrintSummary';

describe('PrintSummary', () => {
  beforeEach(() => {
    window.matchMedia =
      window.matchMedia ||
      function () {
        return {
          matches: false,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        };
      };
  });

  afterEach(() => {
    cleanup();
  });

  it('renders null when summary is null', () => {
    const { container } = render(<PrintSummary summary={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders null when all items succeeded (suppresses top alert)', () => {
    const summary: PrintJobSummary = {
      succeeded: 5,
      failed: 0,
      skipped: 0,
      results: [
        { queueItemId: '1', path: 'a.pdf', fileName: 'a.pdf', status: 'succeeded' },
        { queueItemId: '2', path: 'b.pdf', fileName: 'b.pdf', status: 'succeeded' },
      ],
    };

    const { container } = render(<PrintSummary summary={summary} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders warning alert and failure list when there are failed items', () => {
    const summary: PrintJobSummary = {
      succeeded: 2,
      failed: 1,
      skipped: 0,
      results: [
        { queueItemId: '1', path: 'a.pdf', fileName: 'a.pdf', status: 'succeeded' },
        { queueItemId: '2', path: 'b.docx', fileName: 'b.docx', status: 'failed', message: 'Office 未安装' },
      ],
    };

    render(<PrintSummary summary={summary} />);

    expect(screen.getByText(/打印完成：成功 2 个，失败 1 个/)).toBeDefined();
    expect(screen.getByText('失败明细')).toBeDefined();
    expect(screen.getByText('b.docx')).toBeDefined();
    expect(screen.getByText('Office 未安装')).toBeDefined();
  });

  it('renders info alert when items were cancelled/skipped without failures', () => {
    const summary: PrintJobSummary = {
      succeeded: 2,
      failed: 0,
      skipped: 3,
      results: [
        { queueItemId: '1', path: 'a.pdf', fileName: 'a.pdf', status: 'succeeded' },
        { queueItemId: '2', path: 'b.pdf', fileName: 'b.pdf', status: 'skipped', message: '用户已终止打印' },
      ],
    };

    render(<PrintSummary summary={summary} />);

    expect(screen.getByText(/打印已取消：已完成 2 个，未打印 3 个/)).toBeDefined();
    expect(screen.getByText(/未打印的文件已保留在列表中/)).toBeDefined();
    expect(screen.queryByText('失败明细')).toBeNull();
  });
});
