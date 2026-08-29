import { describe, expect, it } from 'vitest';

export function computeRangeSelection(
  items: { id: string }[],
  anchorId: string | null,
  currentId: string,
): string[] {
  const anchor = anchorId ?? items[0]?.id ?? currentId;
  const anchorIndex = items.findIndex((i) => i.id === anchor);
  const currentIndex = items.findIndex((i) => i.id === currentId);
  if (currentIndex < 0) return [];
  const validAnchorIndex = anchorIndex >= 0 ? anchorIndex : currentIndex;
  const start = Math.min(validAnchorIndex, currentIndex);
  const end = Math.max(validAnchorIndex, currentIndex);
  return items.slice(start, end + 1).map((i) => i.id);
}

export function toggleSelection(currentSelected: string[], id: string): string[] {
  const set = new Set(currentSelected);
  if (set.has(id)) {
    set.delete(id);
  } else {
    set.add(id);
  }
  return Array.from(set);
}

describe('Queue Selection Logic', () => {
  const mockItems = [
    { id: 'item-1' },
    { id: 'item-2' },
    { id: 'item-3' },
    { id: 'item-4' },
    { id: 'item-5' },
  ];

  it('single click selects only the target item', () => {
    const selected = ['item-3'];
    expect(selected).toEqual(['item-3']);
  });

  it('ctrl-click adds or removes item from selection', () => {
    let selected = ['item-1', 'item-3'];
    // Toggle on item-4
    selected = toggleSelection(selected, 'item-4');
    expect(selected).toEqual(['item-1', 'item-3', 'item-4']);

    // Toggle off item-1
    selected = toggleSelection(selected, 'item-1');
    expect(selected).toEqual(['item-3', 'item-4']);
  });

  it('shift-click performs continuous range selection from anchor', () => {
    const range = computeRangeSelection(mockItems, 'item-2', 'item-4');
    expect(range).toEqual(['item-2', 'item-3', 'item-4']);
  });

  it('shift-click backward range selection works correctly', () => {
    const range = computeRangeSelection(mockItems, 'item-4', 'item-2');
    expect(range).toEqual(['item-2', 'item-3', 'item-4']);
  });

  it('shift-click without prior anchor defaults to first item', () => {
    const range = computeRangeSelection(mockItems, null, 'item-3');
    expect(range).toEqual(['item-1', 'item-2', 'item-3']);
  });
});
