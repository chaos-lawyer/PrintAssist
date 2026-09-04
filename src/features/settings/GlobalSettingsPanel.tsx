import { Button, Checkbox, Input, InputNumber, Segmented, Select, Space, Tooltip, Typography } from 'antd';
import { ChevronDown, Printer, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PaperSourceCapability, SavedPrinterProfileSummary, SystemPrinter } from '../../shared/contracts/printer';
import { listPrinterPaperSources } from '../../api/nativeBridge';
import type { CollateMode, ColorMode, FlipMode, NupLayout, NupScope, PageScaleMode, PrintSettings, SidesMode } from '../../domain/printSettings';
import { evaluateSettingAvailability, isNupActive } from '../../domain/printSettings';
import { SettingSelect } from '../../components/SettingSelect';
import { NupSettings } from './NupSettings';

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

const collateModeDescriptions: Record<CollateMode, string> = {
  byPage: '逐页：先打印所有副本的第 1 页，再打印第 2 页，依此类推。',
  byDocument: '逐份：先完整打印一份文件，再打印下一份。',
  bySet: '逐套：按队列顺序完整打印所有文件，再开始下一套。',
};

interface GlobalSettingsPanelProps {
  printers: SystemPrinter[];
  settings: PrintSettings;
  loadingPrinters: boolean;
  loadingProperties?: boolean;
  savedProfiles?: SavedPrinterProfileSummary[];
  loadingProfiles?: boolean;
  onRefreshPrinters?: () => void;
  onOpenProperties?: () => void;
  onSelectProfile?: (profileId: string | null) => void;
  onOpenSaveProfile?: () => void;
  onOpenProfileManager?: () => void;
  onOpenPrinterManager?: () => void;
  onChange: (nextSettings: PrintSettings, changedKey?: keyof PrintSettings) => void;
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
  savedProfiles = [],
  loadingProfiles = false,
  onRefreshPrinters,
  onOpenProperties,
  onSelectProfile,
  onOpenSaveProfile,
  onOpenProfileManager,
  onOpenPrinterManager,
  onChange,
}: GlobalSettingsPanelProps) {
  const selectedPrinter = printers.find((printer) => printer.name === settings.printerName);
  const availability = evaluateSettingAvailability(selectedPrinter);
  const showFlipOptions = settings.sidesMode === 'duplex' && availability.duplexEnabled;
  const showColorHint = Boolean(selectedPrinter) && !availability.colorEnabled;
  const showDuplexHint = Boolean(selectedPrinter) && !availability.duplexEnabled;
  const [paperCapability, setPaperCapability] = useState<PaperSourceCapability | null>(null);
  const [loadingPaperSources, setLoadingPaperSources] = useState(false);

  const isNup = isNupActive(settings.nupLayout);

  useEffect(() => {
    if (!settings.printerName) {
      setPaperCapability(null);
      return;
    }
    let cancelled = false;
    setLoadingPaperSources(true);
    void listPrinterPaperSources(settings.printerName)
      .then((cap) => {
        if (!cancelled) {
          setPaperCapability(cap);
          const validCodes = new Set(cap.sources.map((s) => s.code));
          if (
            settings.sourceCode !== undefined &&
            (cap.status !== 'available' || !validCodes.has(settings.sourceCode))
          ) {
            onChange({ ...settings, sourceCode: undefined, sourceName: undefined });
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPaperCapability({ status: 'unavailable', sources: [] });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingPaperSources(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [settings.printerName, onChange, settings]);

  const [printerSelectOpen, setPrinterSelectOpen] = useState(false);
  const [profileSelectOpen, setProfileSelectOpen] = useState(false);
  const printerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const printerMenuRef = useRef<HTMLDivElement | null>(null);
  const profileTriggerRef = useRef<HTMLButtonElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const [printerMenuPosition, setPrinterMenuPosition] = useState<PrinterMenuPosition | null>(null);
  const [profileMenuPosition, setProfileMenuPosition] = useState<PrinterMenuPosition | null>(null);
  const printerListboxId = useId();
  const profileListboxId = useId();
  const selectedPrinterLabel = selectedPrinter
    ? `${selectedPrinter.name}${selectedPrinter.isDefault ? '（默认）' : ''}`
    : loadingPrinters
      ? '正在读取系统打印机…'
      : '选择系统打印机';
  const activeSavedProfile = savedProfiles.find(
    (profile) => profile.id === settings.persistentProfileId,
  );
  const selectedProfileLabel = activeSavedProfile
    ? activeSavedProfile.name
    : settings.persistentProfileName
      ? settings.persistentProfileName
      : loadingProfiles
        ? '正在读取保存的配置…'
        : '不使用已保存配置';

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

  const updateProfileMenuPosition = useCallback(() => {
    const triggerElement = profileTriggerRef.current;
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
    const left = Math.min(
      Math.max(PRINTER_MENU_VIEWPORT_PADDING_PIXELS, triggerRect.left),
      viewportWidth - width - PRINTER_MENU_VIEWPORT_PADDING_PIXELS,
    );
    const top = preferBottom
      ? triggerRect.bottom + PRINTER_MENU_GAP_PIXELS
      : Math.max(
          PRINTER_MENU_VIEWPORT_PADDING_PIXELS,
          triggerRect.top - PRINTER_MENU_GAP_PIXELS - maxHeight,
        );

    setProfileMenuPosition({
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

  useLayoutEffect(() => {
    if (!profileSelectOpen) {
      setProfileMenuPosition(null);
      return;
    }
    updateProfileMenuPosition();
  }, [profileSelectOpen, savedProfiles.length, updateProfileMenuPosition]);

  const [printerActiveIndex, setPrinterActiveIndex] = useState<number>(0);
  const [profileActiveIndex, setProfileActiveIndex] = useState<number>(0);

  // Focus and scroll active option into view
  useEffect(() => {
    if (printerSelectOpen && printerMenuRef.current) {
      const activeEl = printerMenuRef.current.querySelector<HTMLElement>('.is-focused');
      activeEl?.scrollIntoView({ block: 'nearest' });
    }
  }, [printerActiveIndex, printerSelectOpen]);

  useEffect(() => {
    if (profileSelectOpen && profileMenuRef.current) {
      const activeEl = profileMenuRef.current.querySelector<HTMLElement>('.is-focused');
      activeEl?.scrollIntoView({ block: 'nearest' });
    }
  }, [profileActiveIndex, profileSelectOpen]);

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

    const handleKeyDown = (event: KeyboardEvent) => {
      if (printers.length === 0) return;
      if (event.key === 'Escape' || event.key === 'Tab') {
        setPrinterSelectOpen(false);
        printerTriggerRef.current?.focus();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setPrinterActiveIndex((prev) => (prev + 1) % printers.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setPrinterActiveIndex((prev) => (prev - 1 + printers.length) % printers.length);
      } else if (event.key === 'Home') {
        event.preventDefault();
        setPrinterActiveIndex(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        setPrinterActiveIndex(printers.length - 1);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const selected = printers[printerActiveIndex];
        if (selected) {
          onChange({ ...settings, printerName: selected.name });
          setPrinterSelectOpen(false);
          printerTriggerRef.current?.focus();
        }
      }
    };

    const handleViewportChange = () => {
      updatePrinterMenuPosition();
    };

    document.addEventListener('mousedown', handlePointerDownOutside);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDownOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [printerSelectOpen, printerActiveIndex, printers, settings, onChange, updatePrinterMenuPosition]);

  const profileOptionsCount = 1 + savedProfiles.length;

  useEffect(() => {
    if (!profileSelectOpen) {
      return;
    }

    const handlePointerDownOutside = (event: MouseEvent) => {
      const targetNode = event.target;
      if (!(targetNode instanceof Node)) {
        return;
      }
      const clickedInsideTrigger = profileTriggerRef.current?.contains(targetNode);
      const clickedInsideMenu = profileMenuRef.current?.contains(targetNode);
      if (!clickedInsideTrigger && !clickedInsideMenu) {
        setProfileSelectOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (profileOptionsCount === 0) return;
      if (event.key === 'Escape' || event.key === 'Tab') {
        setProfileSelectOpen(false);
        profileTriggerRef.current?.focus();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setProfileActiveIndex((prev) => (prev + 1) % profileOptionsCount);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setProfileActiveIndex((prev) => (prev - 1 + profileOptionsCount) % profileOptionsCount);
      } else if (event.key === 'Home') {
        event.preventDefault();
        setProfileActiveIndex(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        setProfileActiveIndex(profileOptionsCount - 1);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (profileActiveIndex === 0) {
          onSelectProfile?.(null);
        } else {
          const profile = savedProfiles[profileActiveIndex - 1];
          if (profile) {
            onSelectProfile?.(profile.id);
          }
        }
        setProfileSelectOpen(false);
        profileTriggerRef.current?.focus();
      }
    };

    const handleViewportChange = () => {
      updateProfileMenuPosition();
    };

    document.addEventListener('mousedown', handlePointerDownOutside);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDownOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [profileSelectOpen, profileActiveIndex, profileOptionsCount, savedProfiles, onSelectProfile, updateProfileMenuPosition]);

  const printerMenu =
    printerSelectOpen && printerMenuPosition
      ? createPortal(
          <div
            ref={printerMenuRef}
            id={printerListboxId}
            className={`printer-picker-menu printer-picker-menu--${printerMenuPosition.placement}`}
            role="listbox"
            tabIndex={-1}
            aria-labelledby="printer-select-label"
            aria-activedescendant={`${printerListboxId}-option-${printerActiveIndex}`}
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
              printers.map((printer, index) => {
                const optionLabel = `${printer.name}${printer.isDefault ? '（默认）' : ''}`;
                const isSelected = printer.name === settings.printerName;
                const isFocused = index === printerActiveIndex;
                return (
                  <div
                    key={printer.name}
                    id={`${printerListboxId}-option-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    className={`printer-picker-option${isSelected ? ' is-selected' : ''}${isFocused ? ' is-focused' : ''}`}
                    onClick={() => {
                      onChange({ ...settings, printerName: printer.name });
                      setPrinterSelectOpen(false);
                    }}
                    onMouseEnter={() => setPrinterActiveIndex(index)}
                  >
                    <span className="printer-picker-option-name">{optionLabel}</span>
                    <span className="printer-picker-option-meta">
                      {describePrinterState(printer)}
                      {printer.portName ? ` · ${printer.portName}` : ''}
                    </span>
                    <div className="printer-picker-option-actions">
                      {index < 9 && (
                        <kbd className="profile-shortcut-badge" title={`按快捷键 Shift+${index + 1} 快速选择`}>
                          Shift+{index + 1}
                        </kbd>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>,
          document.body,
        )
      : null;

  const profileMenu =
    profileSelectOpen && profileMenuPosition
      ? createPortal(
          <div
            ref={profileMenuRef}
            id={profileListboxId}
            className={`printer-picker-menu profile-picker-menu printer-picker-menu--${profileMenuPosition.placement}`}
            role="listbox"
            tabIndex={-1}
            aria-labelledby="profile-select-label"
            aria-activedescendant={`${profileListboxId}-option-${profileActiveIndex}`}
            style={{
              top: profileMenuPosition.top,
              left: profileMenuPosition.left,
              width: profileMenuPosition.width,
              maxHeight: profileMenuPosition.maxHeight,
            }}
          >
            <button
              id={`${profileListboxId}-option-0`}
              type="button"
              role="option"
              aria-selected={!settings.persistentProfileId}
              className={`printer-picker-option${!settings.persistentProfileId ? ' is-selected' : ''}${profileActiveIndex === 0 ? ' is-focused' : ''}`}
              onClick={() => {
                onSelectProfile?.(null);
                setProfileSelectOpen(false);
              }}
              onMouseEnter={() => setProfileActiveIndex(0)}
            >
              <span className="printer-picker-option-name">不使用已保存配置</span>
            </button>
            {savedProfiles.map((profile, index) => {
              const optionIndex = index + 1;
              const isSelected = profile.id === settings.persistentProfileId;
              const isFocused = optionIndex === profileActiveIndex;
              return (
                <button
                  key={profile.id}
                  id={`${profileListboxId}-option-${optionIndex}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={profile.compatibility !== 'compatible' ? 'true' : undefined}
                  className={`printer-picker-option${isSelected ? ' is-selected' : ''}${isFocused ? ' is-focused' : ''}${profile.compatibility !== 'compatible' ? ' is-disabled' : ''}`}
                  title={profile.compatibility !== 'compatible' ? (profile.compatibility === 'driverChanged' ? '驱动已更新，需在管理界面重建' : '配置不兼容') : undefined}
                  onClick={() => {
                    if (profile.compatibility !== 'compatible') return;
                    onSelectProfile?.(profile.id);
                    setProfileSelectOpen(false);
                  }}
                  onMouseEnter={() => setProfileActiveIndex(optionIndex)}
                >
                  <span className="printer-picker-option-name">{profile.name}</span>
                  {index < 9 && (
                    <kbd className="profile-shortcut-badge" title={`按数字键 ${index + 1} 快速应用`}>
                      {index + 1}
                    </kbd>
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="settings-block">
      <div className="settings-block-head">
        <Typography.Title level={5} className="settings-panel-title">
          2. 打印设置
        </Typography.Title>
      </div>

      <div className="setting-field">
        <div className="field-label-row">
          <span className="field-label" id="printer-select-label">
            打印机
          </span>
          <Space size={4}>
            <Button
              type="text"
              className="profile-action-btn"
              onClick={onOpenPrinterManager}
              disabled={loadingPrinters && printers.length === 0}
            >
              管理
            </Button>
            <Tooltip title="刷新打印机列表">
              <Button
                type="text"
                className="profile-action-btn refresh-printers-btn"
                icon={<RefreshCw size={13} className={loadingPrinters ? 'spin-icon' : ''} />}
                loading={loadingPrinters}
                onClick={onRefreshPrinters}
                aria-label="刷新打印机列表"
              />
            </Tooltip>
          </Space>
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
            onClick={() => {
              setProfileSelectOpen(false);
              setPrinterSelectOpen((currentOpen) => !currentOpen);
            }}
          >
            <span className="printer-picker-value">{selectedPrinterLabel}</span>
            <ChevronDown size={16} className="printer-picker-caret" aria-hidden />
          </button>
          {printerMenu}
        </div>
      </div>

      {!selectedPrinter ? (
        <div className="settings-empty-printer-card">
          <div className="settings-empty-printer-icon">
            <Printer size={28} />
          </div>
          <div className="settings-empty-printer-title">请先选择打印机</div>
          <div className="settings-empty-printer-desc">
            选择目标打印机后，系统将加载支持的颜色、双面及模板参数
          </div>
        </div>
      ) : (
        <>
          <div className={`printer-status-inline ${selectedPrinter.state}`}>
            <span className="status-pill">{describePrinterState(selectedPrinter)}</span>
            <span className="status-meta">
              {selectedPrinter.isDefault && <span className="status-tag-default">默认</span>}
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

          <div className="setting-field">
            <div className="field-label-row">
              <span className="field-label" id="profile-select-label">
                常用模板
                {settings.profileDirty && (
                  <span className="profile-dirty-badge" title="当前参数与已保存配置不一致">
                    * 未保存修改
                  </span>
                )}
              </span>
              <Space size={4}>
                <Button
                  type="text"
                  className="profile-action-btn"
                  disabled={!selectedPrinter || loadingProperties}
                  onClick={onOpenSaveProfile}
                >
                  保存
                </Button>
                <Button
                  type="text"
                  className="profile-action-btn"
                  disabled={!selectedPrinter}
                  onClick={onOpenProfileManager}
                >
                  管理
                </Button>
                <Button
                  type="text"
                  className="profile-action-btn"
                  disabled={!selectedPrinter || loadingPrinters || loadingProperties}
                  loading={loadingProperties}
                  icon={<SlidersHorizontal size={13} />}
                  onClick={onOpenProperties}
                  title="打开 Windows 原生打印机属性窗口"
                >
                  属性
                </Button>
              </Space>
            </div>
            <div className="printer-picker profile-select">
              <button
                ref={profileTriggerRef}
                type="button"
                className={`printer-picker-trigger${profileSelectOpen ? ' is-open' : ''}${
                  loadingProfiles ? ' is-loading' : ''
                }`}
                aria-labelledby="profile-select-label"
                aria-haspopup="listbox"
                aria-expanded={profileSelectOpen}
                aria-controls={profileListboxId}
                disabled={!selectedPrinter || loadingProfiles}
                onClick={() => {
                  setPrinterSelectOpen(false);
                  setProfileSelectOpen((currentOpen) => !currentOpen);
                }}
              >
                <span className="printer-picker-value">{selectedProfileLabel}</span>
                <ChevronDown size={16} className="printer-picker-caret" aria-hidden />
              </button>
              {profileMenu}
            </div>
          </div>

          <div className="settings-controls">
            <div className="settings-controls-title">
              <span>基础打印设置</span>
              <span className="settings-controls-hint">所有选项已展开</span>
            </div>
            <div className="setting-row">
              <Tooltip title="快捷键：S 切换黑白/彩色" mouseEnterDelay={0.5}>
                <span className="setting-row-label" id="color-mode-label">
                  颜色
                </span>
              </Tooltip>
              <Segmented
                className="setting-segmented"
                size="small"
                block
                aria-labelledby="color-mode-label"
                value={settings.colorMode}
                options={[
                  { label: '黑白 (更低成本)', value: 'monochrome' },
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

            <div className="setting-group">
              <div className="setting-row">
                <Tooltip title="快捷键：D 切换单双面" mouseEnterDelay={0.5}>
                  <span className="setting-row-label" id="sides-mode-label">
                    单双面
                  </span>
                </Tooltip>
                <Segmented
                  className="setting-segmented"
                  size="small"
                  block
                  aria-labelledby="sides-mode-label"
                  value={settings.sidesMode}
                  options={[
                    { label: '单面', value: 'simplex' },
                    {
                      label: '双面 (节约纸张)',
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
                <div className="setting-submenu setting-submenu-compact">
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
            </div>
            {showDuplexHint && (
              <Typography.Text type="secondary" className="field-hint field-hint-inline">
                双面不可用：{selectedPrinter?.duplex.detail ?? '打印机不支持或能力未知'}
              </Typography.Text>
            )}

            <div className="setting-group">
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
                      onChange(
                        {
                          ...settings,
                          copies: typeof value === 'number' && value > 0 ? value : 1,
                        },
                        'copies',
                      )
                    }
                  />
                  <Typography.Text type="secondary">份</Typography.Text>
                </div>
              </div>

              {settings.copies > 1 && (
                <div className="setting-submenu setting-submenu-compact">
                  <span className="setting-row-label" id="collate-mode-label">
                    分发
                  </span>
                  <Segmented
                    className="setting-segmented"
                    size="small"
                    block
                    aria-labelledby="collate-mode-label"
                    value={settings.collateMode ?? (settings.collate ? 'byDocument' : 'byPage')}
                    options={[
                      {
                        label: (
                          <Tooltip title={collateModeDescriptions.byPage} mouseEnterDelay={0.2}>
                            <span
                              aria-label={collateModeDescriptions.byPage}
                              title={collateModeDescriptions.byPage}
                              style={{ display: 'inline-block', width: '100%' }}
                            >
                              逐页
                            </span>
                          </Tooltip>
                        ),
                        value: 'byPage',
                      },
                      {
                        label: (
                          <Tooltip title={collateModeDescriptions.byDocument} mouseEnterDelay={0.2}>
                            <span
                              aria-label={collateModeDescriptions.byDocument}
                              title={collateModeDescriptions.byDocument}
                              style={{ display: 'inline-block', width: '100%' }}
                            >
                              逐份
                            </span>
                          </Tooltip>
                        ),
                        value: 'byDocument',
                      },
                      {
                        label: (
                          <Tooltip title={collateModeDescriptions.bySet} mouseEnterDelay={0.2}>
                            <span
                              aria-label={collateModeDescriptions.bySet}
                              title={collateModeDescriptions.bySet}
                              style={{ display: 'inline-block', width: '100%' }}
                            >
                              逐套
                            </span>
                          </Tooltip>
                        ),
                        value: 'bySet',
                      },
                    ]}
                    onChange={(value) => {
                      const nextMode = value as CollateMode;
                      onChange({
                        ...settings,
                        collateMode: nextMode,
                        collate: nextMode !== 'byPage',
                      });
                    }}
                  />
                </div>
              )}
            </div>

            <div className="setting-group">
              <div className="setting-row">
                <span className="setting-row-label" id="page-range-label">
                  页码
                </span>
                <Segmented
                  className="setting-segmented"
                  size="small"
                  block
                  aria-labelledby="page-range-label"
                  value={settings.pageRange?.mode ?? 'all'}
                  options={[
                    { label: '全部页', value: 'all' },
                    { label: '自定义', value: 'custom' },
                  ]}
                  onChange={(value) => {
                    const mode = value as 'all' | 'custom';
                    onChange({
                      ...settings,
                      pageRange: {
                        mode,
                        expression: settings.pageRange?.expression || (mode === 'custom' ? '1,3,5-8' : ''),
                      },
                    });
                  }}
                />
              </div>

              {settings.pageRange?.mode === 'custom' && (
                <div className="setting-submenu setting-submenu-compact">
                  <span className="setting-row-label" id="page-expr-label">
                    范围
                  </span>
                  <Input
                    id="page-expr-input"
                    size="small"
                    placeholder="例如 1,3,5-8"
                    value={settings.pageRange?.expression}
                    onChange={(e) =>
                      onChange(
                        {
                          ...settings,
                          pageRange: {
                            mode: 'custom',
                            expression: e.target.value,
                          },
                        },
                        'pageRange',
                      )
                    }
                  />
                </div>
              )}
            </div>

            <div className="settings-expanded-options">
              {paperCapability?.status === 'available' && paperCapability.sources.length >= 1 && (
                <div className="setting-row">
                  <span className="setting-row-label" id="paper-tray-label">
                    纸盘
                  </span>
                  <SettingSelect
                    ariaLabelledBy="paper-tray-label"
                    value={settings.sourceCode ?? -1}
                    options={[
                      { value: -1, label: '自动选择 / 默认纸盘' },
                      ...paperCapability.sources.map((s) => ({
                        value: s.code,
                        label: s.name,
                      })),
                    ]}
                    onChange={(val) => {
                      if (val === -1) {
                        onChange({ ...settings, sourceCode: undefined, sourceName: undefined });
                      } else {
                        const found = paperCapability.sources.find((s) => s.code === val);
                        onChange({ ...settings, sourceCode: val, sourceName: found?.name });
                      }
                    }}
                  />
                </div>
              )}

              <div className="setting-row">
                <span className="setting-row-label" id="scale-mode-label">
                  缩放
                </span>
                <Tooltip title={isNup ? '拼接模式下自动适应网格大小' : undefined}>
                  <div style={{ width: '100%' }}>
                    <SettingSelect
                      ariaLabelledBy="scale-mode-label"
                      value={settings.scaleMode ?? 'actualSize'}
                      disabled={isNup}
                      options={[
                        { value: 'actualSize', label: '实际大小 (100%)' },
                        { value: 'shrinkOversized', label: '仅缩小过大页面' },
                        { value: 'fitPrintable', label: '适应可打印区域' },
                      ]}
                      onChange={(val) =>
                        onChange({
                          ...settings,
                          scaleMode: val as PageScaleMode,
                        })
                      }
                    />
                  </div>
                </Tooltip>
              </div>

              <NupSettings settings={settings} onChange={onChange} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
