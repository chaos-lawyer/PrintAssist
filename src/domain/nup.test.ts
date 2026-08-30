import { describe, expect, it } from 'vitest';
import {
  clampNupDimension,
  findMatchingNupTemplate,
  getLinkedNupMin,
  getNupLayoutSummary,
  isNupActive,
  NUP_TEMPLATES,
  type NupLayout,
} from './printSettings';

describe('N-up printing domain logic', () => {
  it('detects active N-up correctly', () => {
    expect(isNupActive(undefined)).toBe(false);
    expect(isNupActive({ cols: 1, rows: 1 })).toBe(false);
    expect(isNupActive({ cols: 2, rows: 1 })).toBe(true);
    expect(isNupActive({ cols: 1, rows: 2 })).toBe(true);
    expect(isNupActive({ cols: 2, rows: 2 })).toBe(true);
    expect(isNupActive({ cols: 3, rows: 2 })).toBe(true);
    expect(isNupActive({ cols: 3, rows: 3 })).toBe(true);
  });

  it('includes standard active templates', () => {
    expect(NUP_TEMPLATES.length).toBe(5);
    expect(NUP_TEMPLATES.map((t) => t.id)).toEqual(['2x1', '1x2', '2x2', '3x2', '3x3']);
    expect(NUP_TEMPLATES[0]).toEqual({
      id: '2x1',
      label: '2 × 1',
      layout: { cols: 2, rows: 1 },
      description: '两页并排，适合文档对照和讲义',
    });
    expect(NUP_TEMPLATES[1]).toEqual({
      id: '1x2',
      label: '1 × 2',
      layout: { cols: 1, rows: 2 },
      description: '两页上下排列，兼容纵排布局',
    });
  });

  it('matches templates accurately or identifies custom layout', () => {
    expect(findMatchingNupTemplate({ cols: 2, rows: 1 })?.id).toBe('2x1');
    expect(findMatchingNupTemplate({ cols: 1, rows: 2 })?.id).toBe('1x2');
    expect(findMatchingNupTemplate({ cols: 2, rows: 2 })?.id).toBe('2x2');
    expect(findMatchingNupTemplate({ cols: 3, rows: 2 })?.id).toBe('3x2');
    expect(findMatchingNupTemplate({ cols: 3, rows: 3 })?.id).toBe('3x3');
    expect(findMatchingNupTemplate({ cols: 4, rows: 3 })).toBeUndefined();
    expect(findMatchingNupTemplate({ cols: 1, rows: 1 })).toBeUndefined();
    expect(findMatchingNupTemplate(undefined)).toBeUndefined();
  });

  it('clamps dimensions to 1-4', () => {
    expect(clampNupDimension(0)).toBe(1);
    expect(clampNupDimension(-2)).toBe(1);
    expect(clampNupDimension(3)).toBe(3);
    expect(clampNupDimension(5)).toBe(4);
    expect(clampNupDimension(2.9)).toBe(2);
  });

  it('calculates linked minimum constraint to prevent 1x1 in N-up mode', () => {
    // When the other dimension is 1, current dimension cannot be 1 (min must be 2)
    expect(getLinkedNupMin(1)).toBe(2);
    // When the other dimension is > 1, current dimension can be 1
    expect(getLinkedNupMin(2)).toBe(1);
    expect(getLinkedNupMin(3)).toBe(1);
    expect(getLinkedNupMin(4)).toBe(1);
  });

  it('generates layout summary with accurate orientation and capacity', () => {
    const summary2x1 = getNupLayoutSummary({ cols: 2, rows: 1 });
    expect(summary2x1.slots).toBe(2);
    expect(summary2x1.slotsText).toBe('2 × 1，每个打印面容纳 2 页');
    expect(summary2x1.orientationHint).toBe('预计横向纸张');
    expect(summary2x1.customLabel).toBe('2 × 1');

    const summary1x2 = getNupLayoutSummary({ cols: 1, rows: 2 });
    expect(summary1x2.orientationHint).toBe('预计纵向纸张');
    expect(summary1x2.customLabel).toBe('1 × 2');

    const summary2x2 = getNupLayoutSummary({ cols: 2, rows: 2 });
    expect(summary2x2.orientationHint).toBe('预计保持纸张方向');

    const summaryCustom4x3 = getNupLayoutSummary({ cols: 4, rows: 3 });
    expect(summaryCustom4x3.slots).toBe(12);
    expect(summaryCustom4x3.customLabel).toBe('自定义 4 × 3');
    expect(summaryCustom4x3.orientationHint).toBe('预计横向纸张');
  });

  describe('estimated sheet calculations', () => {
    function calculateSheets(
      pagesPerFile: number[],
      layout: NupLayout,
      scope: 'perFile' | 'crossFile',
      sides: 'simplex' | 'duplex',
      copies = 1,
    ): number {
      const slots = layout.cols * layout.rows;
      const isCross = slots > 1 && scope === 'crossFile';

      if (isCross) {
        const totalPages = pagesPerFile.reduce((acc, p) => acc + p, 0);
        const sidesNeeded = Math.ceil(totalPages / slots);
        const sheetsPerCopy = sides === 'duplex' ? Math.ceil(sidesNeeded / 2) : sidesNeeded;
        return sheetsPerCopy * copies;
      }

      let totalSheets = 0;
      for (const pages of pagesPerFile) {
        const sidesNeeded = Math.ceil(pages / slots);
        const sheetsPerCopy = sides === 'duplex' ? Math.ceil(sidesNeeded / 2) : sidesNeeded;
        totalSheets += sheetsPerCopy * copies;
      }
      return totalSheets;
    }

    it('calculates simplex sheets without N-up', () => {
      expect(calculateSheets([10], { cols: 1, rows: 1 }, 'perFile', 'simplex')).toBe(10);
      expect(calculateSheets([10], { cols: 1, rows: 1 }, 'perFile', 'duplex')).toBe(5);
    });

    it('calculates 4-in-1 (2x2) perFile sheets', () => {
      // 10 pages in 4-in-1: ceil(10/4) = 3 logical sides
      expect(calculateSheets([10], { cols: 2, rows: 2 }, 'perFile', 'simplex')).toBe(3);
      // duplex: ceil(3/2) = 2 physical sheets
      expect(calculateSheets([10], { cols: 2, rows: 2 }, 'perFile', 'duplex')).toBe(2);
    });

    it('demonstrates paper saving in crossFile mode across small files', () => {
      // 2 files with 1 page each in 4-in-1:
      // perFile: ceil(1/4) + ceil(1/4) = 1 + 1 = 2 sheets
      expect(calculateSheets([1, 1], { cols: 2, rows: 2 }, 'perFile', 'simplex')).toBe(2);
      // crossFile: ceil((1+1)/4) = 1 sheet
      expect(calculateSheets([1, 1], { cols: 2, rows: 2 }, 'crossFile', 'simplex')).toBe(1);
    });
  });
});
