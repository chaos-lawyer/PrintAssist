// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedPrinterProfileSummary } from '../../shared/contracts/printer';
import { PrinterProfileManagerModal } from './PrinterProfileManagerModal';
import * as nativeBridge from '../../api/nativeBridge';

describe('PrinterProfileManagerModal - Export All & Multi Import', () => {
  beforeEach(() => {
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any;

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
    vi.restoreAllMocks();
  });

  const mockProfiles: SavedPrinterProfileSummary[] = [
    {
      id: 'profile-1',
      name: '双面黑白经济',
      printerName: 'Test Printer',
      summary: 'A4 · 双面',
      settings: { printerName: 'Test Printer', driverExtraBytes: 0 },
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
      isDefault: true,
      compatibility: 'compatible',
    },
    {
      id: 'profile-2',
      name: '单面彩色高质量',
      printerName: 'Test Printer',
      summary: 'A4 · 单面',
      settings: { printerName: 'Test Printer', driverExtraBytes: 0 },
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
      isDefault: false,
      compatibility: 'compatible',
    },
  ];

  it('renders icon-only buttons for export-all and import without text', () => {
    render(
      <PrinterProfileManagerModal
        open={true}
        currentPrinterName="Test Printer"
        profiles={mockProfiles}
        activeProfileId="profile-1"
        onClose={() => {}}
        onRefreshProfiles={async () => {}}
        onApplyProfile={() => {}}
      />,
    );

    const exportBtn = screen.getByRole('button', { name: '导出全部配置' });
    const importBtn = screen.getByRole('button', { name: '导入配置' });

    expect(exportBtn).toBeDefined();
    expect(importBtn).toBeDefined();

    // Verify neither button contains plain text
    expect(exportBtn.textContent?.trim()).toBe('');
    expect(importBtn.textContent?.trim()).toBe('');

    // When profiles exist, export button is enabled
    expect(exportBtn.hasAttribute('disabled')).toBe(false);
  });

  it('disables export-all button when printer has no profiles', () => {
    render(
      <PrinterProfileManagerModal
        open={true}
        currentPrinterName="Test Printer"
        profiles={[]}
        activeProfileId={undefined}
        onClose={() => {}}
        onRefreshProfiles={async () => {}}
        onApplyProfile={() => {}}
      />,
    );

    const exportBtn = screen.getByRole('button', { name: '导出全部配置' });
    expect(exportBtn.hasAttribute('disabled')).toBe(true);
  });

  it('triggers export-all workflow on export button click', async () => {
    const saveExportSpy = vi
      .spyOn(nativeBridge, 'saveExportProfilePath')
      .mockResolvedValue('/downloads/Test_Printer-全部配置.paprofile');
    const exportAllSpy = vi
      .spyOn(nativeBridge, 'exportAllPrinterProfiles')
      .mockResolvedValue(2);

    render(
      <PrinterProfileManagerModal
        open={true}
        currentPrinterName="Test Printer"
        profiles={mockProfiles}
        activeProfileId="profile-1"
        onClose={() => {}}
        onRefreshProfiles={async () => {}}
        onApplyProfile={() => {}}
      />,
    );

    const exportBtn = screen.getByRole('button', { name: '导出全部配置' });
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(saveExportSpy).toHaveBeenCalledWith('Test Printer-全部配置.paprofile');
      expect(exportAllSpy).toHaveBeenCalledWith(
        'Test Printer',
        '/downloads/Test_Printer-全部配置.paprofile',
      );
    });
  });

  it('triggers multi-file import workflow on import button click and refreshes', async () => {
    const pickFilesSpy = vi
      .spyOn(nativeBridge, 'pickImportProfileFiles')
      .mockResolvedValue(['/docs/profile1.paprofile', '/docs/profile2.paprofile']);
    const importProfilesSpy = vi
      .spyOn(nativeBridge, 'importPrinterProfiles')
      .mockResolvedValue(mockProfiles);
    const refreshSpy = vi.fn().mockResolvedValue(undefined);

    render(
      <PrinterProfileManagerModal
        open={true}
        currentPrinterName="Test Printer"
        profiles={mockProfiles}
        activeProfileId="profile-1"
        onClose={() => {}}
        onRefreshProfiles={refreshSpy}
        onApplyProfile={() => {}}
      />,
    );

    const importBtn = screen.getByRole('button', { name: '导入配置' });
    fireEvent.click(importBtn);

    await waitFor(() => {
      expect(pickFilesSpy).toHaveBeenCalledTimes(1);
      expect(importProfilesSpy).toHaveBeenCalledWith(
        ['/docs/profile1.paprofile', '/docs/profile2.paprofile'],
        'Test Printer',
      );
      expect(refreshSpy).toHaveBeenCalledTimes(1);
    });
  });
});
