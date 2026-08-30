import { describe, expect, it } from 'vitest';
import { isNupActive, NUP_PRESETS, NupLayout } from './printSettings';

describe('N-up printing domain logic', () => {
  it('detects active N-up correctly', () => {
    expect(isNupActive(undefined)).toBe(false);
    expect(isNupActive({ cols: 1, rows: 1 })).toBe(false);
    expect(isNupActive({ cols: 1, rows: 2 })).toBe(true);
    expect(isNupActive({ cols: 2, rows: 2 })).toBe(true);
    expect(isNupActive({ cols: 3, rows: 2 })).toBe(true);
    expect(isNupActive({ cols: 3, rows: 3 })).toBe(true);
  });

  it('includes standard presets', () => {
    expect(NUP_PRESETS.length).toBe(5);
    expect(NUP_PRESETS[0]).toEqual({ label: '不拼接', layout: { cols: 1, rows: 1 } });
    expect(NUP_PRESETS[1]).toEqual({ label: '2合1', layout: { cols: 1, rows: 2 } });
    expect(NUP_PRESETS[2]).toEqual({ label: '4合1', layout: { cols: 2, rows: 2 } });
    expect(NUP_PRESETS[3]).toEqual({ label: '6合1', layout: { cols: 3, rows: 2 } });
    expect(NUP_PRESETS[4]).toEqual({ label: '9合1', layout: { cols: 3, rows: 3 } });
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
