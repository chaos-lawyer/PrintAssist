// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OverflowTooltipText } from './OverflowTooltipText';

describe('OverflowTooltipText', () => {
  beforeEach(() => {
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };

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

  it('renders content correctly without showing tooltip if not overflowing', async () => {
    render(<OverflowTooltipText text="短文本" className="test-class" />);

    const el = screen.getByText('短文本');
    expect(el).toBeDefined();
    expect(el.className).toBe('test-class');

    // Simulate mouseEnter when scrollHeight <= clientHeight
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 20 });
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 20 });
    Object.defineProperty(el, 'scrollWidth', { configurable: true, value: 50 });
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: 50 });

    fireEvent.mouseEnter(el);

    // Should not render tooltip overlay
    expect(document.querySelector('.ant-tooltip')).toBeNull();
  });

  it('shows tooltip on hover when content is vertically or horizontally overflowing', async () => {
    render(
      <OverflowTooltipText
        text="这是一个非常非常长的文本被截断展示"
        tooltipTitle="完整标题展示"
      />,
    );

    const el = screen.getByText('这是一个非常非常长的文本被截断展示');

    // Simulate vertical overflow (e.g. line-clamp: 2)
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 60 });
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 36 });
    Object.defineProperty(el, 'scrollWidth', { configurable: true, value: 120 });
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: 120 });

    fireEvent.mouseEnter(el);

    // Wait for tooltip delay
    await waitFor(
      () => {
        expect(document.querySelector('.ant-tooltip')).not.toBeNull();
        expect(screen.getByText('完整标题展示')).toBeDefined();
      },
      { timeout: 500 },
    );
  });

  it('fires onDoubleClick when double clicked', () => {
    const handleDoubleClick = vi.fn();
    render(
      <OverflowTooltipText
        text="双击目标"
        onDoubleClick={handleDoubleClick}
      />,
    );

    const el = screen.getByText('双击目标');
    fireEvent.doubleClick(el);
    expect(handleDoubleClick).toHaveBeenCalledTimes(1);
  });
});
