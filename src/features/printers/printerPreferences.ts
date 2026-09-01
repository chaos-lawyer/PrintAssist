import type { SystemPrinter } from '../../shared/contracts/printer';

export interface PrinterPreferencesV1 {
  version: 1;
  orderedNames: string[];
  hiddenNames: string[];
}

export type DecoratedPrinter = SystemPrinter & {
  hidden: boolean;
};

export const PRINTER_PREFERENCES_STORAGE_KEY = 'printassist_printer_preferences_v1';

export function createDefaultPrinterPreferences(): PrinterPreferencesV1 {
  return {
    version: 1,
    orderedNames: [],
    hiddenNames: [],
  };
}

export function loadPrinterPreferences(): PrinterPreferencesV1 {
  try {
    const raw = localStorage.getItem(PRINTER_PREFERENCES_STORAGE_KEY);
    if (!raw) return createDefaultPrinterPreferences();
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.version === 1) {
      const orderedNames = Array.isArray(parsed.orderedNames)
        ? parsed.orderedNames.filter(
            (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0,
          )
        : [];
      const hiddenNames = Array.isArray(parsed.hiddenNames)
        ? parsed.hiddenNames.filter(
            (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0,
          )
        : [];
      return {
        version: 1,
        orderedNames: Array.from(new Set(orderedNames)),
        hiddenNames: Array.from(new Set(hiddenNames)),
      };
    }
  } catch {
    // fallback on error
  }
  return createDefaultPrinterPreferences();
}

export function savePrinterPreferences(prefs: PrinterPreferencesV1): void {
  try {
    localStorage.setItem(PRINTER_PREFERENCES_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

/**
 * Applies saved preferences to system printers:
 * 1. Respects user order in `orderedNames`.
 * 2. Any new/unseen printers from the system are appended to the end.
 *    (If preferences are empty, default printer is first, then rest in system order).
 * 3. Marks `hidden: true` if printer is in `hiddenNames`.
 * 4. Ensures at least one printer is visible (if all are hidden, unhides the first one).
 */
export function applyPrinterPreferences(
  systemPrinters: SystemPrinter[],
  preferences: PrinterPreferencesV1,
): DecoratedPrinter[] {
  if (systemPrinters.length === 0) return [];

  const printerMap = new Map<string, SystemPrinter>();
  for (const printer of systemPrinters) {
    printerMap.set(printer.name, printer);
  }

  const hiddenSet = new Set(preferences.hiddenNames);
  const orderedList: SystemPrinter[] = [];
  const addedNames = new Set<string>();

  // 1. Add printers in user-defined order if present in system
  for (const name of preferences.orderedNames) {
    const printer = printerMap.get(name);
    if (printer && !addedNames.has(name)) {
      orderedList.push(printer);
      addedNames.add(name);
    }
  }

  // 2. If no user order, default printer first, then the rest
  if (orderedList.length === 0) {
    const defaultPrinter = systemPrinters.find((p) => p.isDefault);
    if (defaultPrinter) {
      orderedList.push(defaultPrinter);
      addedNames.add(defaultPrinter.name);
    }
  }

  // 3. Append any system printers not yet in the ordered list
  for (const printer of systemPrinters) {
    if (!addedNames.has(printer.name)) {
      orderedList.push(printer);
      addedNames.add(printer.name);
    }
  }

  // 4. Map to DecoratedPrinter with hidden flag
  const decorated: DecoratedPrinter[] = orderedList.map((p) => ({
    ...p,
    hidden: hiddenSet.has(p.name),
  }));

  // 5. Ensure at least one printer is visible!
  const hasVisible = decorated.some((p) => !p.hidden);
  if (!hasVisible && decorated.length > 0) {
    // Unhide the first printer
    decorated[0] = { ...decorated[0], hidden: false };
  }

  return decorated;
}
