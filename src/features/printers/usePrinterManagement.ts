import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { message } from 'antd';
import { isTauriRuntime, listSystemPrinters } from '../../api/nativeBridge';
import type { PrintSettings } from '../../domain/printSettings';
import {
  evaluateSettingAvailability,
  sanitizeSettingsForPrinter,
} from '../../domain/printSettings';
import type { SystemPrinter } from '../../shared/contracts/printer';
import {
  applyPrinterPreferences,
  loadPrinterPreferences,
  savePrinterPreferences,
  type PrinterPreferencesV1,
} from './printerPreferences';

export interface UsePrinterManagementOptions {
  globalSettingsRef: React.MutableRefObject<PrintSettings>;
  setGlobalSettings: React.Dispatch<React.SetStateAction<PrintSettings>>;
  onPrinterAutoSelected?: (preferredName: string, isNewSelection: boolean) => Promise<void> | void;
  onSelectPrinterFallback?: (fallbackPrinterName: string) => Promise<void> | void;
}

export function usePrinterManagement(options: UsePrinterManagementOptions) {
  const { globalSettingsRef, setGlobalSettings, onPrinterAutoSelected, onSelectPrinterFallback } = options;

  const [systemPrinters, setSystemPrinters] = useState<SystemPrinter[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(true);
  const [printerPreferences, setPrinterPreferences] = useState<PrinterPreferencesV1>(loadPrinterPreferences);
  const printerPreferencesRef = useRef(printerPreferences);
  printerPreferencesRef.current = printerPreferences;

  const [printerManagerOpen, setPrinterManagerOpen] = useState(false);
  const knownPrinterNamesRef = useRef<Set<string> | null>(null);
  const refreshRequestIdRef = useRef(0);

  const orderedPrinters = useMemo(
    () => applyPrinterPreferences(systemPrinters, printerPreferences),
    [systemPrinters, printerPreferences],
  );

  const visiblePrinters = useMemo(
    () => orderedPrinters.filter((p) => !p.hidden),
    [orderedPrinters],
  );

  const printers = visiblePrinters;

  const selectedPrinter = useMemo(
    () => printers.find((printer) => printer.name === globalSettingsRef.current.printerName),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [printers, globalSettingsRef.current.printerName],
  );

  const availability = evaluateSettingAvailability(selectedPrinter);

  const refreshPrinters = useCallback(async () => {
    const requestId = ++refreshRequestIdRef.current;
    setLoadingPrinters(true);
    try {
      const nextPrinters = await listSystemPrinters();
      if (requestId !== refreshRequestIdRef.current) return;
      setSystemPrinters(nextPrinters);

      // Check for newly discovered printers
      if (knownPrinterNamesRef.current === null) {
        knownPrinterNamesRef.current = new Set(nextPrinters.map((p) => p.name));
      } else {
        const newlyFound = nextPrinters.filter(
          (p) => !knownPrinterNamesRef.current!.has(p.name),
        );
        if (newlyFound.length > 0) {
          newlyFound.forEach((p) => knownPrinterNamesRef.current!.add(p.name));
          if (newlyFound.length === 1) {
            message.info(`发现新打印机“${newlyFound[0].name}”，已添加到列表末尾`);
          } else {
            message.info(`发现 ${newlyFound.length} 台新打印机，已添加到列表末尾`);
          }
        }
      }

      const currentSettings = globalSettingsRef.current;
      const currentName = currentSettings.printerName;

      const decorated = applyPrinterPreferences(nextPrinters, printerPreferencesRef.current);
      const visible = decorated.filter((p) => !p.hidden);

      const isCurrentVisible = visible.some((p) => p.name === currentName);
      const preferredName = isCurrentVisible
        ? currentName
        : visible.find((printer) => printer.isDefault)?.name ||
          visible[0]?.name ||
          '';
      const preferredPrinter = nextPrinters.find((printer) => printer.name === preferredName);

      setGlobalSettings((curr) =>
        sanitizeSettingsForPrinter(
          { ...curr, printerName: preferredName },
          preferredPrinter,
        ),
      );

      if (preferredName && preferredName !== currentName) {
        await onPrinterAutoSelected?.(preferredName, true);
      }
    } catch (error) {
      if (requestId === refreshRequestIdRef.current) {
        message.error(error instanceof Error ? error.message : '读取系统打印机失败');
      }
    } finally {
      if (requestId === refreshRequestIdRef.current) {
        setLoadingPrinters(false);
      }
    }
  }, [globalSettingsRef, setGlobalSettings, onPrinterAutoSelected]);

  useEffect(() => {
    void refreshPrinters();
    if (isTauriRuntime()) {
      import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => {
          getCurrentWindow().maximize().catch(() => {});
        })
        .catch(() => {});
    }
  }, [refreshPrinters]);

  const handleSavePrinterPreferences = useCallback(
    (nextPrefs: PrinterPreferencesV1) => {
      savePrinterPreferences(nextPrefs);
      setPrinterPreferences(nextPrefs);

      const currentName = globalSettingsRef.current.printerName;
      const nextDecorated = applyPrinterPreferences(systemPrinters, nextPrefs);
      const nextVisible = nextDecorated.filter((p) => !p.hidden);

      const isCurrentVisible = nextVisible.some((p) => p.name === currentName);
      if (!isCurrentVisible && nextVisible.length > 0) {
        const fallbackPrinter =
          nextVisible.find((p) => p.isDefault) || nextVisible[0];
        void onSelectPrinterFallback?.(fallbackPrinter.name);
      }
    },
    [systemPrinters, globalSettingsRef, onSelectPrinterFallback],
  );

  return {
    systemPrinters,
    loadingPrinters,
    printerPreferences,
    printerPreferencesRef,
    orderedPrinters,
    visiblePrinters,
    printers,
    selectedPrinter,
    availability,
    printerManagerOpen,
    setPrinterManagerOpen,
    refreshPrinters,
    handleSavePrinterPreferences,
  };
}
