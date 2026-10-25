import { describe, expect, it } from 'vitest';
import { parsePageRangeExpression } from './pageRange';

describe('parsePageRangeExpression', () => {
  it('parses mixed commas and ranges', () => {
    const result = parsePageRangeExpression('1,3,5-8');
    expect(result).toEqual({ ok: true, pages: [1, 3, 5, 6, 7, 8] });
  });

  it('rejects inverted ranges', () => {
    const result = parsePageRangeExpression('8-5');
    expect(result.ok).toBe(false);
  });

  it('rejects out-of-bounds page', () => {
    const result = parsePageRangeExpression('1,12', 10);
    expect(result.ok).toBe(false);
  });

  it('rejects empty expression', () => {
    const result = parsePageRangeExpression('   ');
    expect(result.ok).toBe(false);
  });

  it('parses fullwidth commas and exclamation marks and fullwidth hyphens', () => {
    const result = parsePageRangeExpression('1，3，5－7，！6', 10);
    expect(result).toEqual({ ok: true, pages: [1, 3, 5, 7] });
  });

  it('parses reverse indexing L and L1, L2', () => {
    const resultL = parsePageRangeExpression('1-L', 10);
    expect(resultL).toEqual({
      ok: true,
      pages: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    });

    const resultL1 = parsePageRangeExpression('1-L1', 10);
    expect(resultL1).toEqual({
      ok: true,
      pages: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    });

    const resultL2 = parsePageRangeExpression('1-L2', 10);
    expect(resultL2).toEqual({
      ok: true,
      pages: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    });

    const resultLastThree = parsePageRangeExpression('L3-L', 10);
    expect(resultLastThree).toEqual({
      ok: true,
      pages: [8, 9, 10],
    });

    const resultLower = parsePageRangeExpression('l2-l', 10);
    expect(resultLower).toEqual({
      ok: true,
      pages: [9, 10],
    });
  });

  it('supports exclusion and only exclusions', () => {
    const result = parsePageRangeExpression('1-10, !3, !5-7, !L', 10);
    expect(result).toEqual({ ok: true, pages: [1, 2, 4, 8, 9] });

    // Only exclusions (implicit all)
    const resultOnlyEx = parsePageRangeExpression('!1, !L', 5);
    expect(resultOnlyEx).toEqual({ ok: true, pages: [2, 3, 4] });
  });

  it('handles syntax validation when totalPages is undefined', () => {
    // Dynamic expressions without totalPages pass validation with isDynamic: true
    const resultL = parsePageRangeExpression('1-L, !2');
    expect(resultL).toEqual({ ok: true, pages: [], isDynamic: true });

    const resultOnlyEx = parsePageRangeExpression('!1, !L');
    expect(resultOnlyEx).toEqual({ ok: true, pages: [], isDynamic: true });

    // Static expressions without totalPages still resolve full pages
    const resultStatic = parsePageRangeExpression('1-5, !2');
    expect(resultStatic).toEqual({ ok: true, pages: [1, 3, 4, 5] });

    // Inverted static range is still rejected even without totalPages
    const resultInverted = parsePageRangeExpression('8-5');
    expect(resultInverted.ok).toBe(false);
  });

  it('rejects invalid cases', () => {
    // Inverted with L: L1 is 10, L3 is 8 -> 10-8
    expect(parsePageRangeExpression('L1-L3', 10).ok).toBe(false);

    // Exceeding total pages
    expect(parsePageRangeExpression('L15', 10).ok).toBe(false);

    // All pages excluded
    expect(parsePageRangeExpression('1-3, !1-3', 10).ok).toBe(false);

    // Malformed segments
    expect(parsePageRangeExpression('1,,3', 10).ok).toBe(false);
    expect(parsePageRangeExpression('! ', 10).ok).toBe(false);
    expect(parsePageRangeExpression('1-!', 10).ok).toBe(false);
  });
});
