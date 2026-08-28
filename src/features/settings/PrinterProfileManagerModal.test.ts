import { describe, expect, it } from 'vitest';
import type { SavedPrinterProfileSummary } from '../../shared/contracts/printer';
import { reorderProfileList } from './PrinterProfileManagerModal';

describe('reorderProfileList', () => {
  const sampleProfiles: SavedPrinterProfileSummary[] = [
    {
      id: 'p1',
      name: '配置 1',
      printerName: 'HP LaserJet',
      isDefault: false,
      compatibility: 'compatible',
      summary: 'A4 · 单面',
      settings: { printerName: 'HP LaserJet', driverExtraBytes: 0 },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'p2',
      name: '配置 2',
      printerName: 'HP LaserJet',
      isDefault: true,
      compatibility: 'compatible',
      summary: 'A4 · 双面',
      settings: { printerName: 'HP LaserJet', driverExtraBytes: 0 },
      createdAt: '2026-01-02T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    },
    {
      id: 'p3',
      name: '配置 3',
      printerName: 'HP LaserJet',
      isDefault: false,
      compatibility: 'compatible',
      summary: 'A3 · 彩色',
      settings: { printerName: 'HP LaserJet', driverExtraBytes: 0 },
      createdAt: '2026-01-03T00:00:00Z',
      updatedAt: '2026-01-03T00:00:00Z',
    },
  ];

  it('moves item up correctly', () => {
    const next = reorderProfileList(sampleProfiles, 2, 1);
    expect(next.map((p) => p.id)).toEqual(['p1', 'p3', 'p2']);
  });

  it('moves item down correctly', () => {
    const next = reorderProfileList(sampleProfiles, 0, 1);
    expect(next.map((p) => p.id)).toEqual(['p2', 'p1', 'p3']);
  });

  it('moves item to top correctly', () => {
    const next = reorderProfileList(sampleProfiles, 2, 0);
    expect(next.map((p) => p.id)).toEqual(['p3', 'p1', 'p2']);
  });

  it('moves item to bottom correctly', () => {
    const next = reorderProfileList(sampleProfiles, 0, 2);
    expect(next.map((p) => p.id)).toEqual(['p2', 'p3', 'p1']);
  });

  it('handles out of bounds indices gracefully', () => {
    const same = reorderProfileList(sampleProfiles, -1, 2);
    expect(same).toBe(sampleProfiles);
  });
});
