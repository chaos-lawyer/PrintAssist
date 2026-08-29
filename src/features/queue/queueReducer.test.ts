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

  it('sorts queue by fileName using natural numeric order', () => {
    let state = queueReducer(createEmptyQueueState(), {
      type: 'append_files',
      paths: ['file10.pdf', 'file2.pdf', 'file1.pdf'],
    });

    state = queueReducer(state, {
      type: 'sort_queue',
      by: 'fileName',
      direction: 'asc',
    });
    expect(state.items.map((i) => i.fileName)).toEqual(['file1.pdf', 'file2.pdf', 'file10.pdf']);

    state = queueReducer(state, {
      type: 'sort_queue',
      by: 'fileName',
      direction: 'desc',
    });
    expect(state.items.map((i) => i.fileName)).toEqual(['file10.pdf', 'file2.pdf', 'file1.pdf']);
  });

  it('reverses queue order correctly', () => {
    let state = queueReducer(createEmptyQueueState(), {
      type: 'append_files',
      paths: ['doc1.pdf', 'doc2.pdf', 'doc3.pdf'],
    });

    state = queueReducer(state, { type: 'reverse_queue' });
    expect(state.items.map((i) => i.fileName)).toEqual(['doc3.pdf', 'doc2.pdf', 'doc1.pdf']);
  });

  it('reorders items from source index to target index', () => {
    let state = queueReducer(createEmptyQueueState(), {
      type: 'append_files',
      paths: ['a.pdf', 'b.pdf', 'c.pdf'],
    });

    state = queueReducer(state, {
      type: 'reorder_items',
      sourceIndex: 2,
      targetIndex: 0,
    });
    expect(state.items.map((i) => i.fileName)).toEqual(['c.pdf', 'a.pdf', 'b.pdf']);
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
