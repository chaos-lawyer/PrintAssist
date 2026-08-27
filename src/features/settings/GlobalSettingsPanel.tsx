import { Alert, Button, InputNumber, Segmented, Typography } from 'antd';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SystemPrinter } from '../../shared/contracts/printer';
import type { ColorMode, FlipMode, PrintSettings, SidesMode } from '../../domain/printSettings';
import { evaluateSettingAvailability } from '../../domain/printSettings';

interface PrinterMenuPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: 'bottom' | 'top';
}

const PRINTER_MENU_GAP_PIXELS = 6;
const PRINTER_MENU_VIEWPORT_PADDING_PIXELS = 8;
const PRINTER_MENU_PREFERRED_MAX_HEIGHT_PIXELS = 280;

interface GlobalSettingsPanelProps {
  printers: SystemPrinter[];
  settings: PrintSettings;
  loadingPrinters: boolean;
  loadingProperties?: boolean;
  onOpenProperties?: () => void;
  onChange: (nextSettings: PrintSettings) => void;
}

function describePrinterState(printer: SystemPrinter): string {
  if (printer.state === 'ready') return '在线';
  if (printer.state === 'offline') return '离线';
  if (printer.state === 'error') return '错误';
  return '未知';
}

function describeCapabilitySupport(support: string): string {
  if (support === 'supported') return '支持';
  if (support === 'unsupported') return '不支持';
  return '未知';
}

export function GlobalSettingsPanel({
  printers,
  settings,
  loadingPrinters,
  loadingProperties = false,
  onOpenProperties,
  onChange,
}: GlobalSettingsPanelProps) {
  const selectedPrinter = printers.find((printer) => printer.name === settings.printerName);
  const availability = evaluateSettingAvailability(selectedPrinter);
  const showFlipOptions = settings.sidesMode === 'duplex' && availability.duplexEnabled;
  const showColorHint = Boolean(selectedPrinter) && !availability.colorEnabled;
  const showDuplexHint = Boolean(selectedPrinter) && !availability.duplexEnabled;
  const criticalReasons = availability.reasons.filter(
    (reason) =>
      reason.includes('离线') ||
      reason.includes('错误') ||
      reason.includes('尚未选择'),
  );
  const [printerSelectOpen, setPrinterSelectOpen] = useState(false);
  const printerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const printerMenuRef = useRef<HTMLDivElement | null>(null);
  const [printerMenuPosition, setPrinterMenuPosition] = useState<PrinterMenuPosition | null>(null);
  const printerListboxId = useId();
  const selectedPrinterLabel = selectedPrinter
    ? `${selectedPrinter.name}${selectedPrinter.isDefault ? '（默认）' : ''}`
    : loadingPrinters
      ? '正在读取系统打印机…'
      : '选择系统打印机';

  const updatePrinterMenuPosition = useCallback(() => {
    const triggerElement = printerTriggerRef.current;
    if (!triggerElement) {
      return;
    }

    const triggerRect = triggerElement.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const spaceBelow =
      viewportHeight - triggerRect.bottom - PRINTER_MENU_GAP_PIXELS - PRINTER_MENU_VIEWPORT_PADDING_PIXELS;
    const spaceAbove =
      triggerRect.top - PRINTER_MENU_GAP_PIXELS - PRINTER_MENU_VIEWPORT_PADDING_PIXELS;
    const preferBottom =
      spaceBelow >= Math.min(PRINTER_MENU_PREFERRED_MAX_HEIGHT_PIXELS, 160) || spaceBelow >= spaceAbove;
    const availableHeight = Math.max(120, preferBottom ? spaceBelow : spaceAbove);
    const maxHeight = Math.min(PRINTER_MENU_PREFERRED_MAX_HEIGHT_PIXELS, availableHeight);
    const width = Math.min(Math.max(triggerRect.width, 220), viewportWidth - PRINTER_MENU_VIEWPORT_PADDING_PIXELS * 2);
    const rawLeft = triggerRect.left;
    const left = Math.min(
      Math.max(PRINTER_MENU_VIEWPORT_PADDING_PIXELS, rawLeft),
      viewportWidth - width - PRINTER_MENU_VIEWPORT_PADDING_PIXELS,
    );
    const top = preferBottom
      ? triggerRect.bottom + PRINTER_MENU_GAP_PIXELS
      : Math.max(
          PRINTER_MENU_VIEWPORT_PADDING_PIXELS,
          triggerRect.top - PRINTER_MENU_GAP_PIXELS - maxHeight,
        );

    setPrinterMenuPosition({
      top,
      left,
      width,
      maxHeight,
      placement: preferBottom ? 'bottom' : 'top',
    });
  }, []);

  useLayoutEffect(() => {
    if (!printerSelectOpen) {
      setPrinterMenuPosition(null);
      return;
    }
    updatePrinterMenuPosition();
  }, [printerSelectOpen, printers.length, updatePrinterMenuPosition]);

  useEffect(() => {
    if (!printerSelectOpen) {
      return;
    }

    const handlePointerDownOutside = (event: MouseEvent) => {
      const targetNode = event.target;
      if (!(targetNode instanceof Node)) {
        return;
      }
      const clickedInsideTrigger = printerTriggerRef.current?.contains(targetNode);
      const clickedInsideMenu = printerMenuRef.current?.contains(targetNode);
      if (!clickedInsideTrigger && !clickedInsideMenu) {
        setPrinterSelectOpen(false);
      }
    };

    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPrinterSelectOpen(false);
      }
    };

    const handleViewportChange = () => {
      updatePrinterMenuPosition();
    };

    document.addEventListener('mousedown', handlePointerDownOutside);
    document.addEventListener('keydown', handleEscapeKey);
    window.addEventListener('resize', handleViewportChange);
    // Capture scroll from nested sider so floating menu stays under the trigger.
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDownOutside);
      document.removeEventListener('keydown', handleEscapeKey);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [printerSelectOpen, updatePrinterMenuPosition]);

  const printerMenu =
    printerSelectOpen && printerMenuPosition
      ? createPortal(
          <div
            ref={printerMenuRef}
            id={printerListboxId}
            className={`printer-picker-menu printer-picker-menu--${printerMenuPosition.placement}`}
            role="listbox"
            aria-labelledby="printer-select-label"
            style={{
              top: printerMenuPosition.top,
              left: printerMenuPosition.left,
              width: printerMenuPosition.width,
              maxHeight: printerMenuPosition.maxHeight,
            }}
          >
            {printers.length === 0 ? (
              <div className="printer-picker-empty">
                {loadingPrinters ? '正在读取系统打印机…' : '未找到系统打印机'}
              </div>
            ) : (
              printers.map((printer) => {
                const optionLabel = `${printer.name}${printer.isDefault ? '（默认）' : ''}`;
                const isSelected = printer.name === settings.printerName;
                return (
                  <button
                    key={printer.name}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`printer-picker-option${isSelected ? ' is-selected' : ''}`}
                    onClick={() => {
                      onChange({ ...settings, printerName: printer.name });
                      setPrinterSelectOpen(false);
                    }}
                  >
                    <span className="printer-picker-option-name">{optionLabel}</span>
                    <span className="printer-picker-option-meta">
                      {describePrinterState(printer)}
                      {printer.portName ? ` · ${printer.portName}` : ''}
                    </span>
                  </button>
                );
              })
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="settings-block">
      <div className="settings-block-head">
        <Typography.Text className="section-index">02 / 公共设置</Typography.Text>
        <Typography.Title level={5}>默认打印参数</Typography.Title>
      </div>

      <div className="setting-field">
        <div className="field-label-row">
          <span className="field-label" id="printer-select-label">
            打印机
          </span>
          <Button
            size="small"
            type="link"
            className="printer-properties-btn"
            disabled={!selectedPrinter || loadingPrinters || loadingProperties}
            loading={loadingProperties}
            icon={<SlidersHorizontal size={13} />}
            onClick={onOpenProperties}
          >
            打印机属性
          </Button>
        </div>
        {/*
          Custom floating menu (fixed + manual rect), not antd Select portal.
          Keeps page flow intact while avoiding the invisible-dropdown bug in WebView2.
        */}
        <div className="printer-picker">
          <button
            ref={printerTriggerRef}
            type="button"
            className={`printer-picker-trigger${printerSelectOpen ? ' is-open' : ''}${
              loadingPrinters ? ' is-loading' : ''
            }`}
            aria-labelledby="printer-select-label"
            aria-haspopup="listbox"
            aria-expanded={printerSelectOpen}
            aria-controls={printerListboxId}
            disabled={loadingPrinters && printers.length === 0}
            onClick={() => setPrinterSelectOpen((currentOpen) => !currentOpen)}
          >
            <span className="printer-picker-value">{selectedPrinterLabel}</span>
            <ChevronDown size={16} className="printer-picker-caret" aria-hidden />
          </button>
          {printerMenu}
        </div>
      </div>

      {selectedPrinter && (
        <div className={`printer-status-inline ${selectedPrinter.state}`}>
          <span className="status-pill">{describePrinterState(selectedPrinter)}</span>
          <span className="status-meta">
            彩色{describeCapabilitySupport(selectedPrinter.color.support)}
            <span className="status-dot-sep" aria-hidden>
              ·
            </span>
            双面{describeCapabilitySupport(selectedPrinter.duplex.support)}
            {selectedPrinter.portName ? (
              <>
                <span className="status-dot-sep" aria-hidden>
                  ·
                </span>
                {selectedPrinter.portName}
              </>
            ) : null}
          </span>
        </div>
      )}

      {settings.driverSummary && (
        <div className="driver-config-summary" title={settings.driverSummary}>
          <span className="driver-config-summary-tag">驱动配置</span>
          <span className="driver-config-summary-text">{settings.driverSummary}</span>
        </div>
      )}

      <div className="settings-controls">
        <div className="setting-row">
          <span className="setting-row-label" id="color-mode-label">
            颜色
          </span>
          <Segmented
            className="setting-segmented"
            size="small"
            block
            aria-labelledby="color-mode-label"
            value={settings.colorMode}
            options={[
              { label: '黑白', value: 'monochrome' },
              {
                label: '彩色',
                value: 'color',
                disabled: !availability.colorEnabled,
              },
            ]}
            onChange={(value) =>
              onChange({ ...settings, colorMode: value as ColorMode })
            }
          />
        </div>
        {showColorHint && (
          <Typography.Text type="secondary" className="field-hint field-hint-inline">
            彩色不可用：{selectedPrinter?.color.detail ?? '打印机不支持或能力未知'}
          </Typography.Text>
        )}

        <div className="setting-row">
          <span className="setting-row-label" id="sides-mode-label">
            单双面
          </span>
          <Segmented
            className="setting-segmented"
            size="small"
            block
            aria-labelledby="sides-mode-label"
            value={settings.sidesMode}
            options={[
              { label: '单面', value: 'simplex' },
              {
                label: '双面',
                value: 'duplex',
                disabled: !availability.duplexEnabled,
              },
            ]}
            onChange={(value) => {
              const sidesMode = value as SidesMode;
              onChange({
                ...settings,
                sidesMode,
              });
            }}
          />
        </div>

        {showFlipOptions && (
          <div className="setting-row setting-row-nested">
            <span className="setting-row-label" id="flip-mode-label">
              翻转
            </span>
            <Segmented
              className="setting-segmented"
              size="small"
              block
              aria-labelledby="flip-mode-label"
              value={settings.flipMode}
              options={[
                { label: '长边', value: 'longEdge' },
                { label: '短边', value: 'shortEdge' },
              ]}
              onChange={(value) =>
                onChange({ ...settings, flipMode: value as FlipMode })
              }
            />
          </div>
        )}
        {showDuplexHint && (
          <Typography.Text type="secondary" className="field-hint field-hint-inline">
            双面不可用：{selectedPrinter?.duplex.detail ?? '打印机不支持或能力未知'}
          </Typography.Text>
        )}

        <div className="setting-row setting-row-copies">
          <label className="setting-row-label" htmlFor="copies-input">
            份数
          </label>
          <div className="copies-control">
            <InputNumber
              id="copies-input"
              size="small"
              min={1}
              max={99}
              value={settings.copies}
              onChange={(value) =>
                onChange({
                  ...settings,
                  copies: typeof value === 'number' && value > 0 ? value : 1,
                })
              }
            />
            <Typography.Text type="secondary">份</Typography.Text>
          </div>
        </div>
      </div>

      {criticalReasons.length > 0 && (
        <Alert
          className="settings-alert"
          type="warning"
          showIcon
          banner
          message={criticalReasons.join('；')}
        />
      )}
    </div>
  );
}
