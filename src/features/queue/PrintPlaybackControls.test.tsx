// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrintPlaybackControls } from './PrintPlaybackControls';

describe('PrintPlaybackControls', () => {
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

    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('renders "开始打印" in editing phase, calls onStartPrint on click', () => {
    const handleStart = vi.fn();
    render(
      <PrintPlaybackControls
        phase="editing"
        printEnabled={true}
        hasItems={true}
        onStartPrint={handleStart}
        onPausePrint={() => {}}
        onResumePrint={() => {}}
        onTerminatePrint={() => {}}
      />
    );

    const startBtn = screen.getByRole('button', { name: '开始打印' });
    expect(startBtn).toBeDefined();
    expect(startBtn.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByRole('button', { name: /终止/ })).toBeNull();

    fireEvent.click(startBtn);
    expect(handleStart).toHaveBeenCalled();
  });

  it('disables "开始打印" when queue is empty or printing is not enabled', () => {
    const { rerender } = render(
      <PrintPlaybackControls
        phase="editing"
        printEnabled={false}
        disabledReason="打印机离线"
        hasItems={true}
        onStartPrint={() => {}}
        onPausePrint={() => {}}
        onResumePrint={() => {}}
        onTerminatePrint={() => {}}
      />
    );

    let startBtn = screen.getByRole('button', { name: '开始打印' });
    expect(startBtn.hasAttribute('disabled')).toBe(true);

    rerender(
      <PrintPlaybackControls
        phase="empty"
        printEnabled={true}
        hasItems={false}
        onStartPrint={() => {}}
        onPausePrint={() => {}}
        onResumePrint={() => {}}
        onTerminatePrint={() => {}}
      />
    );

    startBtn = screen.getByRole('button', { name: '开始打印' });
    expect(startBtn.hasAttribute('disabled')).toBe(true);
  });

  it('renders "暂停" and "终止" in printing phase', () => {
    const handlePause = vi.fn();
    const handleTerminate = vi.fn();

    render(
      <PrintPlaybackControls
        phase="printing"
        printEnabled={true}
        hasItems={true}
        onStartPrint={() => {}}
        onPausePrint={handlePause}
        onResumePrint={() => {}}
        onTerminatePrint={handleTerminate}
      />
    );

    const pauseBtn = screen.getByRole('button', { name: '暂停打印' });
    const termBtn = screen.getByRole('button', { name: '终止剩余打印' });

    expect(pauseBtn).toBeDefined();
    expect(termBtn).toBeDefined();

    fireEvent.click(pauseBtn);
    expect(handlePause).toHaveBeenCalled();

    fireEvent.click(termBtn);
    expect(handleTerminate).toHaveBeenCalled();
  });

  it('renders "正在暂停" and "终止" in pausing phase', () => {
    const handleTerminate = vi.fn();

    render(
      <PrintPlaybackControls
        phase="pausing"
        printEnabled={true}
        hasItems={true}
        onStartPrint={() => {}}
        onPausePrint={() => {}}
        onResumePrint={() => {}}
        onTerminatePrint={handleTerminate}
      />
    );

    expect(screen.getByText('正在暂停')).toBeDefined();
    const termBtn = screen.getByRole('button', { name: '终止剩余打印' });
    expect(termBtn).toBeDefined();

    fireEvent.click(termBtn);
    expect(handleTerminate).toHaveBeenCalled();
  });

  it('renders "继续" and "终止" in paused phase', () => {
    const handleResume = vi.fn();
    const handleTerminate = vi.fn();

    render(
      <PrintPlaybackControls
        phase="paused"
        printEnabled={true}
        hasItems={true}
        onStartPrint={() => {}}
        onPausePrint={() => {}}
        onResumePrint={handleResume}
        onTerminatePrint={handleTerminate}
      />
    );

    const resumeBtn = screen.getByRole('button', { name: '继续打印' });
    const termBtn = screen.getByRole('button', { name: '终止剩余打印' });

    expect(resumeBtn).toBeDefined();
    expect(termBtn).toBeDefined();

    fireEvent.click(resumeBtn);
    expect(handleResume).toHaveBeenCalled();

    fireEvent.click(termBtn);
    expect(handleTerminate).toHaveBeenCalled();
  });

  it('renders "正在终止" in terminating phase with disabled buttons', () => {
    render(
      <PrintPlaybackControls
        phase="terminating"
        printEnabled={true}
        hasItems={true}
        onStartPrint={() => {}}
        onPausePrint={() => {}}
        onResumePrint={() => {}}
        onTerminatePrint={() => {}}
      />
    );

    const termBtn = screen.getByText('正在终止').closest('button');
    expect(termBtn?.hasAttribute('disabled')).toBe(true);
  });
});
