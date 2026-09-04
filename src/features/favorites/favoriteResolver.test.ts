// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { resolveFavorite } from './favoriteResolver';
import type { FavoriteTemplateV1 } from './favoriteTypes';
import { createEmptyQueueState } from '../../domain/queueTypes';
import { createDefaultGlobalSettings } from '../../domain/printSettings';
import type { SystemPrinter } from '../../shared/contracts/printer';

describe('favoriteResolver', () => {
  const mockSystemPrinters: SystemPrinter[] = [
    {
      name: 'Canon TS8300',
      isDefault: true,
      portName: 'USB001',
      state: 'ready' as const,
      statusCode: 0,
      color: { support: 'supported', source: 'driver' },
      duplex: { support: 'supported', source: 'driver' },
    },
    {
      name: 'HP LaserJet',
      isDefault: false,
      portName: 'IP_192.168.1.100',
      state: 'ready' as const,
      statusCode: 0,
      color: { support: 'unsupported', source: 'driver' },
      duplex: { support: 'unsupported', source: 'driver' },
    },
  ];

  const defaultPreferences = {
    version: 1 as const,
    orderedNames: ['Canon TS8300', 'HP LaserJet'],
    hiddenNames: [],
  };

  const sampleFavorite: FavoriteTemplateV1 = {
    schemaVersion: 1,
    id: 'fav_123',
    name: '周例会材料',
    createdAt: 1000,
    updatedAt: 1000,
    order: 0,
    task: {
      items: [
        {
          path: '/docs/doc1.pdf',
          fileName: 'doc1.pdf',
          kind: 'pdf',
          pageCount: 3,
          override: { sidesMode: 'duplex' },
        },
        {
          path: '/docs/doc2.pdf',
          fileName: 'doc2.pdf',
          kind: 'pdf',
          pageCount: 5,
          override: {},
        },
      ],
    },
    printer: { name: 'HP LaserJet' },
    printConfig: {
      persistentProfileId: 'prof_hp_eco',
      persistentProfileName: '省墨草稿',
      standardSettings: {
        colorMode: 'monochrome',
        sidesMode: 'simplex',
        copies: 3,
        orientation: 'portrait',
      } as any,
    },
  };

  it('blocks resolution if printing is in progress', async () => {
    const queue = createEmptyQueueState();
    queue.isPrinting = true;

    const res = await resolveFavorite({
      favorite: sampleFavorite,
      currentQueue: queue,
      currentSettings: createDefaultGlobalSettings(),
      systemPrinters: mockSystemPrinters,
      printerPreferences: defaultPreferences,
      savedProfiles: [],
      validatePathsFn: async (paths) => ({ valid: paths, unsupported: [] }),
    });

    expect(res.status).toBe('blocked');
    expect(res.blockedReason).toContain('打印进行中');
  });

  it('resolves complete template and applies printer, profile, and files', async () => {
    const queue = createEmptyQueueState();
    const settings = createDefaultGlobalSettings();

    const mockLoadProfile = vi.fn().mockResolvedValue({
      persistentProfile: {
        id: 'prof_hp_eco',
        name: '省墨草稿',
        printerName: 'HP LaserJet',
      },
      settings: { colorMode: 'monochrome', sidesMode: 'simplex' },
      runtimeProfileId: 'dev_123',
    });

    const res = await resolveFavorite({
      favorite: sampleFavorite,
      currentQueue: queue,
      currentSettings: settings,
      systemPrinters: mockSystemPrinters,
      printerPreferences: defaultPreferences,
      savedProfiles: [],
      loadProfileFn: mockLoadProfile,
      validatePathsFn: async (paths) => ({ valid: paths, unsupported: [] }),
    });

    expect(res.status).toBe('ready');
    expect(res.nextSnapshot?.queueState.items.length).toBe(2);
    expect(res.nextSnapshot?.queueState.items[0].override.sidesMode).toBe('duplex');
    expect(res.nextSnapshot?.globalSettings.printerName).toBe('HP LaserJet');
    expect(res.nextSnapshot?.globalSettings.persistentProfileId).toBe('prof_hp_eco');
    expect(res.summary?.profileStatus).toBe('matched');
  });

  it('filters missing files and generates warnings', async () => {
    const queue = createEmptyQueueState();

    const res = await resolveFavorite({
      favorite: sampleFavorite,
      currentQueue: queue,
      currentSettings: createDefaultGlobalSettings(),
      systemPrinters: mockSystemPrinters,
      printerPreferences: defaultPreferences,
      savedProfiles: [],
      validatePathsFn: async (paths) => ({
        valid: ['/docs/doc1.pdf'],
        unsupported: ['/docs/doc2.pdf'],
      }),
    });

    expect(res.status).toBe('ready');
    expect(res.nextSnapshot?.queueState.items.length).toBe(1);
    expect(res.summary?.missingFilesCount).toBe(1);
    expect(res.summary?.missingFilePaths).toContain('/docs/doc2.pdf');
    expect(res.summary?.warnings.length).toBeGreaterThan(0);
  });

  it('detects duplicates and requires duplicate decision', async () => {
    const queue = createEmptyQueueState();
    queue.items = [
      {
        id: 'existing_1',
        path: '/docs/doc1.pdf',
        fileName: 'doc1.pdf',
        kind: 'pdf',
        pageCount: 3,
        status: 'ready',
        addedAt: 1,
        override: {},
      },
    ];

    // Without decision
    const res = await resolveFavorite({
      favorite: sampleFavorite,
      currentQueue: queue,
      currentSettings: createDefaultGlobalSettings(),
      systemPrinters: mockSystemPrinters,
      printerPreferences: defaultPreferences,
      savedProfiles: [],
      validatePathsFn: async (paths) => ({ valid: paths, unsupported: [] }),
    });

    expect(res.status).toBe('needs_duplicate_decision');
    expect(res.duplicateResult?.duplicatePaths.length).toBe(1);

    // With 'new_only' decision
    const resNewOnly = await resolveFavorite({
      favorite: sampleFavorite,
      currentQueue: queue,
      currentSettings: createDefaultGlobalSettings(),
      systemPrinters: mockSystemPrinters,
      printerPreferences: defaultPreferences,
      savedProfiles: [],
      duplicateDecision: 'new_only',
      validatePathsFn: async (paths) => ({ valid: paths, unsupported: [] }),
    });

    expect(resNewOnly.status).toBe('ready');
    expect(resNewOnly.nextSnapshot?.queueState.items.length).toBe(2); // 1 existing + 1 new (doc2.pdf)
    expect(resNewOnly.summary?.appendedFilesCount).toBe(1);
  });

  it('falls back to standardSettings when profile is unavailable', async () => {
    const queue = createEmptyQueueState();

    const res = await resolveFavorite({
      favorite: sampleFavorite,
      currentQueue: queue,
      currentSettings: createDefaultGlobalSettings(),
      systemPrinters: mockSystemPrinters,
      printerPreferences: defaultPreferences,
      savedProfiles: [],
      loadProfileFn: vi.fn().mockRejectedValue(new Error('Profile not found')),
      validatePathsFn: async (paths) => ({ valid: paths, unsupported: [] }),
    });

    expect(res.status).toBe('ready');
    expect(res.summary?.profileStatus).toBe('fallback_standard');
    expect(res.nextSnapshot?.globalSettings.copies).toBe(3);
    expect(res.nextSnapshot?.globalSettings.sidesMode).toBe('simplex');
  });

  it('handles missing printer by retaining current printer and warning', async () => {
    const queue = createEmptyQueueState();
    const settings = createDefaultGlobalSettings();
    settings.printerName = 'Canon TS8300';

    const favWithMissingPrinter: FavoriteTemplateV1 = {
      ...sampleFavorite,
      printer: { name: 'Nonexistent Printer XYZ' },
    };

    const res = await resolveFavorite({
      favorite: favWithMissingPrinter,
      currentQueue: queue,
      currentSettings: settings,
      systemPrinters: mockSystemPrinters,
      printerPreferences: defaultPreferences,
      savedProfiles: [],
      validatePathsFn: async (paths) => ({ valid: paths, unsupported: [] }),
    });

    expect(res.status).toBe('ready');
    expect(res.summary?.printerStatus).toBe('missing');
    expect(res.nextSnapshot?.globalSettings.printerName).toBe('Canon TS8300');
    expect(res.summary?.warnings.some((w) => w.includes('未安装或不可用'))).toBe(true);
  });
});
