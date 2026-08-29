import { describe, expect, it } from 'vitest';
import { createEmptyQueueState } from '../../domain/queueTypes';
import { createPrintSummary, detectDocumentKind, queueReducer } from './queueReducer';

describe('detectDocumentKind', () => {
  it('recognizes common image formats as image', () => {
    const imagePaths = [
      'photo.webp',
      'scan.jfif',
      'camera.heic',
      'shot.avif',
      'logo.ico',
      'clip.emf',
      'raw.dib',
      'pic.jpe',
    ];
    for (const path of imagePaths) {
      expect(detectDocumentKind(path)).toBe('image');
    }
  });
});

describe('queueReducer', () => {
  it('appends unique files and keeps existing items', () => {
    const first = queueReducer(createEmptyQueueState(), {
      type: 'append_files',
      paths: ['C:\\\\docs\\\\a.pdf', 'C:\\\\docs\\\\b.docx'],
    });
    const second = queueReducer(first, {
      type: 'append_files',
      paths: ['C:\\\\docs\\\\a.pdf', 'C:\\\\docs\\\\c.txt'],
    });
    expect(second.items).toHaveLength(3);
    expect(second.items.map((item) => item.fileName)).toEqual(['a.pdf', 'b.docx', 'c.txt']);
  });

  it('resets on clear and supports failed retry', () => {
    let state = queueReducer(createEmptyQueueState(), {
      type: 'append_files',
      paths: ['C:\\\\docs\\\\a.pdf'],
    });
    state = queueReducer(state, {
      type: 'finish_print',
      summary: createPrintSummary([
        {
          queueItemId: state.items[0].id,
          path: state.items[0].path,
          fileName: state.items[0].fileName,
          status: 'failed',
          message: 'demo',
        },
      ]),
    });
    expect(state.items[0].status).toBe('failed');
    state = queueReducer(state, { type: 'retry_failed' });
    expect(state.items[0].status).toBe('ready');
    state = queueReducer(state, { type: 'clear_queue' });
    expect(state.items).toHaveLength(0);
  });

  it('rejects append_files when isPrinting is true', () => {
    let state = queueReducer(createEmptyQueueState(), {
      type: 'append_files',
      paths: ['C:\\\\docs\\\\a.pdf'],
    });
    state = queueReducer(state, { type: 'begin_print' });
    expect(state.isPrinting).toBe(true);

    const duringPrintState = queueReducer(state, {
      type: 'append_files',
      paths: ['C:\\\\docs\\\\b.pdf'],
    });
    expect(duringPrintState.items).toHaveLength(1);
    expect(duringPrintState.items[0].fileName).toBe('a.pdf');
  });

  it('removes multiple items via batch_remove', () => {
    let state = queueReducer(createEmptyQueueState(), {
      type: 'append_files',
      paths: ['C:\\\\docs\\\\a.pdf', 'C:\\\\docs\\\\b.pdf', 'C:\\\\docs\\\\c.pdf'],
    });
    expect(state.items).toHaveLength(3);
    const toRemove = [state.items[0].id, state.items[2].id];

    state = queueReducer(state, {
      type: 'batch_remove',
      ids: toRemove,
    });
    expect(state.items).toHaveLength(1);
    expect(state.items[0].fileName).toBe('b.pdf');
  });

  it('toggles filename sort between asc and desc', () => {
    let state = queueReducer(createEmptyQueueState(), {
      type: 'append_files',
      paths: ['file10.pdf', 'file2.pdf', 'file1.pdf'],
    });

    // First toggle -> asc
    state = queueReducer(state, { type: 'toggle_filename_sort' });
    expect(state.items.map((i) => i.fileName)).toEqual(['file1.pdf', 'file2.pdf', 'file10.pdf']);
    expect(state.order).toEqual({ mode: 'fileName', direction: 'asc' });

    // Second toggle -> desc
    state = queueReducer(state, { type: 'toggle_filename_sort' });
    expect(state.items.map((i) => i.fileName)).toEqual(['file10.pdf', 'file2.pdf', 'file1.pdf']);
    expect(state.order).toEqual({ mode: 'fileName', direction: 'desc' });

    // Third toggle -> asc again
    state = queueReducer(state, { type: 'toggle_filename_sort' });
    expect(state.items.map((i) => i.fileName)).toEqual(['file1.pdf', 'file2.pdf', 'file10.pdf']);
    expect(state.order).toEqual({ mode: 'fileName', direction: 'asc' });
  });

  it('reorders items by moving IDs relative to a target', () => {
    let state = queueReducer(createEmptyQueueState(), {
      type: 'append_files',
      paths: ['a.pdf', 'b.pdf', 'c.pdf'],
    });
    const cId = state.items[2].id;
    const aId = state.items[0].id;

    state = queueReducer(state, {
      type: 'reorder_items',
      movingIds: [cId],
      targetId: aId,
      position: 'before',
    });
    expect(state.items.map((i) => i.fileName)).toEqual(['c.pdf', 'a.pdf', 'b.pdf']);
    expect(state.order).toEqual({ mode: 'manual' });
  });

  it('moves multiple selected items together maintaining their relative order', () => {
    let state = queueReducer(createEmptyQueueState(), {
      type: 'append_files',
      paths: ['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf', 'e.pdf'],
    });
    const aId = state.items[0].id;
    const cId = state.items[2].id;
    const eId = state.items[4].id;

    // Move [a.pdf, c.pdf] after e.pdf
    state = queueReducer(state, {
      type: 'reorder_items',
      movingIds: [aId, cId],
      targetId: eId,
      position: 'after',
    });
    expect(state.items.map((i) => i.fileName)).toEqual(['b.pdf', 'd.pdf', 'e.pdf', 'a.pdf', 'c.pdf']);
    expect(state.order).toEqual({ mode: 'manual' });
  });

  it('auto-sorts appended files when fileName sort is active', () => {
    let state = queueReducer(createEmptyQueueState(), {
      type: 'append_files',
      paths: ['b.pdf', 'a.pdf'],
    });
    state = queueReducer(state, { type: 'toggle_filename_sort' });
    expect(state.items.map((i) => i.fileName)).toEqual(['a.pdf', 'b.pdf']);

    // Append more files - should auto-sort
    state = queueReducer(state, {
      type: 'append_files',
      paths: ['aa.pdf'],
    });
    expect(state.items.map((i) => i.fileName)).toEqual(['a.pdf', 'aa.pdf', 'b.pdf']);
    expect(state.order).toEqual({ mode: 'fileName', direction: 'asc' });
  });

  it('resets sort order to manual after reorder_items', () => {
    let state = queueReducer(createEmptyQueueState(), {
      type: 'append_files',
      paths: ['a.pdf', 'b.pdf', 'c.pdf'],
    });
    state = queueReducer(state, { type: 'toggle_filename_sort' });
    expect(state.order.mode).toBe('fileName');

    const cId = state.items[2].id;
    const aId = state.items[0].id;
    state = queueReducer(state, {
      type: 'reorder_items',
      movingIds: [cId],
      targetId: aId,
      position: 'before',
    });
    expect(state.order).toEqual({ mode: 'manual' });
  });

  it('applies batch_set_override to multiple items without erasing other settings', () => {
    let state = queueReducer(createEmptyQueueState(), {
      type: 'append_files',
      paths: ['first.pdf', 'second.pdf', 'third.pdf'],
    });

    // Give first item an existing override
    state = queueReducer(state, {
      type: 'update_override',
      id: state.items[0].id,
      override: { copies: 5 },
    });

    // Batch override colorMode on first and second
    state = queueReducer(state, {
      type: 'batch_set_override',
      ids: [state.items[0].id, state.items[1].id],
      override: { colorMode: 'color' },
    });

    // First item should now have BOTH copies: 5 AND colorMode: 'color'
    expect(state.items[0].override.copies).toBe(5);
    expect(state.items[0].override.colorMode).toBe('color');

    // Second item should have colorMode: 'color'
    expect(state.items[1].override.colorMode).toBe('color');

    // Third item untouched
    expect(state.items[2].override.colorMode).toBeUndefined();
  });
});
