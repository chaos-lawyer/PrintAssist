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

  it('recognizes WPS native formats and extended Office formats', () => {
    // WPS Word / Writer
    expect(detectDocumentKind('document.wps')).toBe('word');
    expect(detectDocumentKind('template.wpt')).toBe('word');
    expect(detectDocumentKind('doc.dotx')).toBe('word');
    expect(detectDocumentKind('doc.docm')).toBe('word');

    // WPS Excel / Spreadsheet
    expect(detectDocumentKind('sheet.et')).toBe('excel');
    expect(detectDocumentKind('template.ett')).toBe('excel');
    expect(detectDocumentKind('data.xlsm')).toBe('excel');
    expect(detectDocumentKind('data.xltx')).toBe('excel');

    // WPS PowerPoint / Presentation
    expect(detectDocumentKind('slides.dps')).toBe('powerpoint');
    expect(detectDocumentKind('template.dpt')).toBe('powerpoint');
    expect(detectDocumentKind('show.ppsx')).toBe('powerpoint');
    expect(detectDocumentKind('slides.pptm')).toBe('powerpoint');
  });
});

describe('queueReducer', () => {
  it('appends approved files with unique IDs, allowing duplicates if requested', () => {
    const first = queueReducer(createEmptyQueueState(), {
      type: 'append_files',
      paths: ['C:\\docs\\a.pdf', 'C:\\docs\\b.docx'],
    });
    const second = queueReducer(first, {
      type: 'append_files',
      paths: ['C:\\docs\\a.pdf', 'C:\\docs\\c.txt'],
    });
    expect(second.items).toHaveLength(4);
    expect(second.items.map((item) => item.fileName)).toEqual(['a.pdf', 'b.docx', 'a.pdf', 'c.txt']);
    expect(second.items[0].id).not.toBe(second.items[2].id);
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

  it('clones items relative to targetId and resets sort to manual', () => {
    let state = queueReducer(createEmptyQueueState(), {
      type: 'append_files',
      paths: ['a.pdf', 'b.pdf', 'c.pdf'],
    });
    // Set fileName sort
    state = queueReducer(state, { type: 'toggle_filename_sort' });
    expect(state.order.mode).toBe('fileName');

    // Give a.pdf an override and failed status to check clone reset behavior
    state = queueReducer(state, {
      type: 'update_override',
      id: state.items[0].id,
      override: { copies: 3, colorMode: 'color' },
    });
    state = queueReducer(state, {
      type: 'set_item_status',
      id: state.items[0].id,
      status: 'failed',
      errorMessage: 'Mock error',
    });

    const aId = state.items[0].id;
    const bId = state.items[1].id;

    // Clone a.pdf after b.pdf
    state = queueReducer(state, {
      type: 'clone_items',
      sourceIds: [aId],
      targetId: bId,
      position: 'after',
    });

    expect(state.items).toHaveLength(4);
    expect(state.items.map((i) => i.fileName)).toEqual(['a.pdf', 'b.pdf', 'a.pdf', 'c.pdf']);
    expect(state.order).toEqual({ mode: 'manual' });

    // Verify clone item inherits override but resets status to ready
    const clonedItem = state.items[2];
    expect(clonedItem.id).not.toBe(aId);
    expect(clonedItem.override).toEqual({ copies: 3, colorMode: 'color' });
    expect(clonedItem.status).toBe('ready');
    expect(clonedItem.errorMessage).toBeUndefined();
  });

  it('pastes snapshots after targetId or at end when target is null', () => {
    let state = queueReducer(createEmptyQueueState(), {
      type: 'append_files',
      paths: ['first.pdf', 'second.pdf'],
    });

    const snapshot = {
      path: 'pasted.docx',
      fileName: 'pasted.docx',
      kind: 'word' as const,
      pageCount: 12,
      override: { copies: 2 },
    };

    // Paste after first.pdf
    state = queueReducer(state, {
      type: 'paste_snapshots',
      snapshots: [snapshot],
      targetId: state.items[0].id,
    });

    expect(state.items.map((i) => i.fileName)).toEqual(['first.pdf', 'pasted.docx', 'second.pdf']);
    expect(state.items[1].override).toEqual({ copies: 2 });
    expect(state.items[1].pageCount).toBe(12);
    expect(state.items[1].status).toBe('ready');
    expect(state.order).toEqual({ mode: 'manual' });

    // Paste at end with null targetId
    state = queueReducer(state, {
      type: 'paste_snapshots',
      snapshots: [{ ...snapshot, fileName: 'end.docx' }],
      targetId: null,
    });
    expect(state.items.map((i) => i.fileName)).toEqual(['first.pdf', 'pasted.docx', 'second.pdf', 'end.docx']);
  });

  describe('BatchPhase and task completion flow', () => {
    it('manages phase transitions from empty -> editing -> printing -> completed', () => {
      let state = createEmptyQueueState();
      expect(state.phase).toBe('empty');

      // Append files -> editing
      state = queueReducer(state, { type: 'append_files', paths: ['a.pdf', 'b.pdf'] });
      expect(state.phase).toBe('editing');

      // Begin print -> printing
      state = queueReducer(state, { type: 'begin_print' });
      expect(state.phase).toBe('printing');
      expect(state.isPrinting).toBe(true);

      // Finish print -> completed (all items preserved)
      state = queueReducer(state, {
        type: 'finish_print',
        summary: createPrintSummary([
          { queueItemId: state.items[0].id, path: 'a.pdf', fileName: 'a.pdf', status: 'succeeded' },
          { queueItemId: state.items[1].id, path: 'b.pdf', fileName: 'b.pdf', status: 'succeeded' },
        ]),
      });
      expect(state.phase).toBe('completed');
      expect(state.isPrinting).toBe(false);
      expect(state.items).toHaveLength(2);
      expect(state.items.every((i) => i.status === 'succeeded')).toBe(true);
    });

    it('rejects append_files, clone_items, paste_snapshots when completed', () => {
      let state = queueReducer(createEmptyQueueState(), {
        type: 'append_files',
        paths: ['a.pdf'],
      });
      state = queueReducer(state, { type: 'begin_print' });
      state = queueReducer(state, {
        type: 'finish_print',
        summary: createPrintSummary([
          { queueItemId: state.items[0].id, path: 'a.pdf', fileName: 'a.pdf', status: 'succeeded' },
        ]),
      });
      expect(state.phase).toBe('completed');

      // Try append
      const appended = queueReducer(state, { type: 'append_files', paths: ['b.pdf'] });
      expect(appended.items).toHaveLength(1);

      // Try clone
      const cloned = queueReducer(state, {
        type: 'clone_items',
        sourceIds: [state.items[0].id],
        targetId: state.items[0].id,
        position: 'after',
      });
      expect(cloned.items).toHaveLength(1);

      // Try paste
      const pasted = queueReducer(state, {
        type: 'paste_snapshots',
        snapshots: [{ path: 'p.pdf', fileName: 'p.pdf', kind: 'pdf', pageCount: 1, override: {} }],
        targetId: null,
      });
      expect(pasted.items).toHaveLength(1);
    });

    it('start_new_batch resets to empty phase and clears summary', () => {
      let state = queueReducer(createEmptyQueueState(), {
        type: 'append_files',
        paths: ['a.pdf'],
      });
      state = queueReducer(state, { type: 'begin_print' });
      state = queueReducer(state, {
        type: 'finish_print',
        summary: createPrintSummary([
          { queueItemId: state.items[0].id, path: 'a.pdf', fileName: 'a.pdf', status: 'succeeded' },
        ]),
      });

      const nextBatch = queueReducer(state, { type: 'start_new_batch' });
      expect(nextBatch.items).toHaveLength(0);
      expect(nextBatch.phase).toBe('empty');
      expect(nextBatch.lastSummary).toBeNull();
    });

    it('prepare_reprint_all resets all item statuses to ready and phase to editing', () => {
      let state = queueReducer(createEmptyQueueState(), {
        type: 'append_files',
        paths: ['a.pdf', 'b.pdf'],
      });
      state = queueReducer(state, { type: 'begin_print' });
      state = queueReducer(state, {
        type: 'finish_print',
        summary: createPrintSummary([
          { queueItemId: state.items[0].id, path: 'a.pdf', fileName: 'a.pdf', status: 'succeeded' },
          { queueItemId: state.items[1].id, path: 'b.pdf', fileName: 'b.pdf', status: 'failed', message: 'err' },
        ]),
      });

      const reprintState = queueReducer(state, { type: 'prepare_reprint_all' });
      expect(reprintState.phase).toBe('editing');
      expect(reprintState.lastSummary).toBeNull();
      expect(reprintState.items[0].status).toBe('ready');
      expect(reprintState.items[1].status).toBe('ready');
      expect(reprintState.items[1].errorMessage).toBeUndefined();
    });

    it('keep_failed_only removes succeeded items and resets failed items to ready', () => {
      let state = queueReducer(createEmptyQueueState(), {
        type: 'append_files',
        paths: ['s1.pdf', 'f1.pdf', 's2.pdf'],
      });
      state = queueReducer(state, { type: 'begin_print' });
      state = queueReducer(state, {
        type: 'finish_print',
        summary: createPrintSummary([
          { queueItemId: state.items[0].id, path: 's1.pdf', fileName: 's1.pdf', status: 'succeeded' },
          { queueItemId: state.items[1].id, path: 'f1.pdf', fileName: 'f1.pdf', status: 'failed', message: 'err' },
          { queueItemId: state.items[2].id, path: 's2.pdf', fileName: 's2.pdf', status: 'succeeded' },
        ]),
      });

      const failedOnly = queueReducer(state, { type: 'keep_failed_only' });
      expect(failedOnly.items).toHaveLength(1);
      expect(failedOnly.items[0].fileName).toBe('f1.pdf');
      expect(failedOnly.items[0].status).toBe('ready');
      expect(failedOnly.phase).toBe('editing');
      expect(failedOnly.lastSummary).toBeNull();
    });

    it('restore_batch restores items, summary, and phase from backup', () => {
      let state = queueReducer(createEmptyQueueState(), {
        type: 'append_files',
        paths: ['a.pdf'],
      });
      state = queueReducer(state, { type: 'begin_print' });
      state = queueReducer(state, {
        type: 'finish_print',
        summary: createPrintSummary([
          { queueItemId: state.items[0].id, path: 'a.pdf', fileName: 'a.pdf', status: 'succeeded' },
        ]),
      });

      const savedItems = state.items;
      const savedSummary = state.lastSummary;
      const savedPhase = state.phase;

      // Start new batch -> empty
      state = queueReducer(state, { type: 'start_new_batch' });
      expect(state.items).toHaveLength(0);

      // Restore
      const restored = queueReducer(state, {
        type: 'restore_batch',
        items: savedItems,
        summary: savedSummary,
        phase: savedPhase,
      });

      expect(restored.items).toHaveLength(1);
      expect(restored.items[0].fileName).toBe('a.pdf');
      expect(restored.lastSummary).toEqual(savedSummary);
      expect(restored.phase).toBe('completed');
    });

    it('manages playback state machine: pause, confirm, resume, terminate', () => {
      let state = queueReducer(createEmptyQueueState(), {
        type: 'append_files',
        paths: ['doc1.pdf', 'doc2.pdf'],
      });

      // 1. Begin print -> printing
      state = queueReducer(state, { type: 'begin_print' });
      expect(state.phase).toBe('printing');
      expect(state.isPrinting).toBe(true);

      // 2. Request pause -> pausing
      state = queueReducer(state, { type: 'request_pause' });
      expect(state.phase).toBe('pausing');
      expect(state.isPrinting).toBe(true);

      // 3. Confirm paused from backend -> paused
      state = queueReducer(state, { type: 'confirm_paused' });
      expect(state.phase).toBe('paused');
      expect(state.isPrinting).toBe(true);

      // 4. Resume print -> printing
      state = queueReducer(state, { type: 'resume_print' });
      expect(state.phase).toBe('printing');
      expect(state.isPrinting).toBe(true);

      // 5. Request terminate -> terminating
      state = queueReducer(state, { type: 'request_terminate' });
      expect(state.phase).toBe('terminating');
      expect(state.isPrinting).toBe(true);

      // 6. Finish print -> completed and isPrinting becomes false
      state = queueReducer(state, {
        type: 'finish_print',
        summary: createPrintSummary([
          { queueItemId: state.items[0].id, path: 'doc1.pdf', fileName: 'doc1.pdf', status: 'succeeded' },
          { queueItemId: state.items[1].id, path: 'doc2.pdf', fileName: 'doc2.pdf', status: 'skipped' },
        ]),
      });
      expect(state.phase).toBe('completed');
      expect(state.isPrinting).toBe(false);
      expect(state.lastSummary?.succeeded).toBe(1);
      expect(state.lastSummary?.skipped).toBe(1);
    });

    it('ignores invalid transitions and race conditions', () => {
      let state = queueReducer(createEmptyQueueState(), {
        type: 'append_files',
        paths: ['doc1.pdf'],
      });

      // Cannot pause when not printing
      expect(queueReducer(state, { type: 'request_pause' }).phase).toBe('editing');

      // Begin print
      state = queueReducer(state, { type: 'begin_print' });

      // If user requested terminate while pausing, confirm_paused must not override terminating!
      state = queueReducer(state, { type: 'request_pause' });
      state = queueReducer(state, { type: 'request_terminate' });
      expect(state.phase).toBe('terminating');

      state = queueReducer(state, { type: 'confirm_paused' });
      expect(state.phase).toBe('terminating');
    });
  });

  describe('reference page counts', () => {
    it('initializes docx and pdf with pending status, and other formats with unsupported', () => {
      const state = queueReducer(createEmptyQueueState(), {
        type: 'append_files',
        paths: ['report.docx', 'doc.pdf', 'image.png', 'sheet.xlsx'],
      });

      expect(state.items[0].pageCountStatus).toBe('pending');
      expect(state.items[0].pageCount).toBeNull();
      expect(state.items[0].pageCountReason).toBeUndefined();

      expect(state.items[1].pageCountStatus).toBe('pending');
      expect(state.items[1].pageCount).toBeNull();

      expect(state.items[2].pageCountStatus).toBe('unsupported');
      expect(state.items[2].pageCountReason).toBe('unsupportedFormat');

      expect(state.items[3].pageCountStatus).toBe('unsupported');
      expect(state.items[3].pageCountReason).toBe('unsupportedFormat');
    });

    it('updates reference page counts via update_reference_page_counts action', () => {
      let state = queueReducer(createEmptyQueueState(), {
        type: 'append_files',
        paths: ['report.docx', 'manual.pdf'],
      });

      const docxId = state.items[0].id;
      const pdfId = state.items[1].id;

      state = queueReducer(state, {
        type: 'update_reference_page_counts',
        updates: {
          [docxId]: {
            pageCount: 15,
            status: 'available',
            source: 'docxMetadata',
            fileVersion: '1234:5678',
          },
          [pdfId]: {
            pageCount: null,
            status: 'unavailable',
            source: null,
            reason: 'encryptedPdf',
            fileVersion: '9999:0000',
          },
        },
      });

      expect(state.items[0].pageCount).toBe(15);
      expect(state.items[0].pageCountStatus).toBe('available');
      expect(state.items[0].pageCountSource).toBe('docxMetadata');
      expect(state.items[0].pageCountFileVersion).toBe('1234:5678');

      expect(state.items[1].pageCount).toBeNull();
      expect(state.items[1].pageCountStatus).toBe('unavailable');
      expect(state.items[1].pageCountReason).toBe('encryptedPdf');
    });

    it('preserves reference page count fields during clone_items', () => {
      let state = queueReducer(createEmptyQueueState(), {
        type: 'append_files',
        paths: ['report.docx'],
      });

      const origId = state.items[0].id;
      state = queueReducer(state, {
        type: 'update_reference_page_counts',
        updates: {
          [origId]: {
            pageCount: 22,
            status: 'available',
            source: 'docxMetadata',
            fileVersion: '100:200',
          },
        },
      });

      state = queueReducer(state, {
        type: 'clone_items',
        sourceIds: [origId],
        targetId: origId,
        position: 'after',
      });

      expect(state.items.length).toBe(2);
      expect(state.items[1].pageCount).toBe(22);
      expect(state.items[1].pageCountStatus).toBe('available');
      expect(state.items[1].pageCountSource).toBe('docxMetadata');
      expect(state.items[1].pageCountFileVersion).toBe('100:200');
    });

    it('sorts queue items by pageCount ascending and descending with nulls placed at end', () => {
      let state = queueReducer(createEmptyQueueState(), {
        type: 'append_files',
        paths: ['a.docx', 'b.docx', 'c.docx', 'd.txt'],
      });

      const [idA, idB, idC] = [state.items[0].id, state.items[1].id, state.items[2].id];
      state = queueReducer(state, {
        type: 'update_reference_page_counts',
        updates: {
          [idA]: { pageCount: 10, status: 'available' },
          [idB]: { pageCount: 2, status: 'available' },
          [idC]: { pageCount: 50, status: 'available' },
        },
      });

      // Toggle sort on pageCount -> asc: 2 (b.docx), 10 (a.docx), 50 (c.docx), null (d.txt)
      state = queueReducer(state, { type: 'toggle_sort', field: 'pageCount' });
      expect(state.order).toEqual({ mode: 'pageCount', direction: 'asc' });
      expect(state.items.map((i) => i.fileName)).toEqual(['b.docx', 'a.docx', 'c.docx', 'd.txt']);

      // Toggle sort on pageCount -> desc: 50 (c.docx), 10 (a.docx), 2 (b.docx), null (d.txt)
      state = queueReducer(state, { type: 'toggle_sort', field: 'pageCount' });
      expect(state.order).toEqual({ mode: 'pageCount', direction: 'desc' });
      expect(state.items.map((i) => i.fileName)).toEqual(['c.docx', 'a.docx', 'b.docx', 'd.txt']);
    });
  });
});
