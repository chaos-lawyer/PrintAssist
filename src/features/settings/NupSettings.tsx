import { InputNumber, Segmented, Tooltip } from 'antd';
import React, { useEffect, useRef } from 'react';
import {
  clampNupDimension,
  getLinkedNupMin,
  isNupActive,
  type NupLayout,
  type NupScope,
  type PrintSettings,
} from '../../domain/printSettings';

export interface NupSettingsProps {
  settings: PrintSettings;
  onChange: (next: PrintSettings) => void;
}

export function NupSettings({ settings, onChange }: NupSettingsProps) {
  const currentLayout = settings.nupLayout ?? { cols: 1, rows: 1 };
  const isNup = isNupActive(currentLayout);

  // Cache last valid non-1x1 layout during this session, defaulting to 2x1 (horizontal 2-in-1)
  const lastValidLayoutRef = useRef<NupLayout>({ cols: 2, rows: 1 });

  useEffect(() => {
    if (isNupActive(settings.nupLayout)) {
      lastValidLayoutRef.current = settings.nupLayout;
    }
  }, [settings.nupLayout?.cols, settings.nupLayout?.rows]);

  const cols = clampNupDimension(currentLayout.cols);
  const rows = clampNupDimension(currentLayout.rows);

  const handleModeChange = (mode: string) => {
    if (mode === 'none') {
      if (isNupActive(settings.nupLayout)) {
        lastValidLayoutRef.current = settings.nupLayout;
      }
      onChange({
        ...settings,
        nupLayout: { cols: 1, rows: 1 },
      });
    } else {
      const target = lastValidLayoutRef.current ?? { cols: 2, rows: 1 };
      onChange({
        ...settings,
        nupLayout: target,
      });
    }
  };

  const handleColsChange = (val: number | null) => {
    if (val === null) return;
    const minCols = getLinkedNupMin(rows);
    const clampedCols = Math.max(minCols, Math.min(4, Math.floor(val)));
    onChange({
      ...settings,
      nupLayout: { cols: clampedCols, rows },
    });
  };

  const handleRowsChange = (val: number | null) => {
    if (val === null) return;
    const minRows = getLinkedNupMin(cols);
    const clampedRows = Math.max(minRows, Math.min(4, Math.floor(val)));
    onChange({
      ...settings,
      nupLayout: { cols, rows: clampedRows },
    });
  };

  return (
    <div className="setting-group nup-settings-wrapper">
      <div className="setting-row">
        <span className="setting-row-label" id="nup-mode-label">
          多页拼接
        </span>
        <Segmented
          className="setting-segmented"
          size="small"
          block
          aria-labelledby="nup-mode-label"
          value={isNup ? 'nup' : 'none'}
          options={[
            { label: '不拼接', value: 'none' },
            { label: '拼接', value: 'nup' },
          ]}
          onChange={handleModeChange}
        />
      </div>

      {isNup && (
        <div
          className="setting-submenu setting-submenu-wide nup-config-panel"
          role="group"
          aria-label="拼接布局设置"
        >
          {/* 横向与纵向计数 */}
          <div className="nup-section">
            <div className="nup-counts-container">
              <div className="nup-count-col">
                <label className="nup-count-label" htmlFor="nup-input-cols">
                  横向页数（列）
                </label>
                <InputNumber
                  id="nup-input-cols"
                  size="small"
                  min={getLinkedNupMin(rows)}
                  max={4}
                  precision={0}
                  value={cols}
                  onChange={handleColsChange}
                  aria-label="横向页数（列）"
                  style={{ width: '100%' }}
                />
              </div>

              <span className="nup-counts-times" aria-hidden="true">
                ×
              </span>

              <div className="nup-count-col">
                <label className="nup-count-label" htmlFor="nup-input-rows">
                  纵向页数（行）
                </label>
                <InputNumber
                  id="nup-input-rows"
                  size="small"
                  min={getLinkedNupMin(cols)}
                  max={4}
                  precision={0}
                  value={rows}
                  onChange={handleRowsChange}
                  aria-label="纵向页数（行）"
                  style={{ width: '100%' }}
                />
              </div>
            </div>
          </div>

          <div className="nup-section nup-scope-section">
            <Segmented
              className="setting-segmented"
              size="small"
              block
              aria-label="拼接范围"
              value={settings.nupScope ?? 'perFile'}
              options={[
                {
                  label: (
                    <Tooltip title="每个文件的页面从新物理纸开始打印，末尾不足一页的格子留空">
                      <span>文件独立</span>
                    </Tooltip>
                  ),
                  value: 'perFile',
                },
                {
                  label: (
                    <Tooltip title="所有文件连续流式排版，不同文件的页面可共享同一张纸">
                      <span>跨文件拼接</span>
                    </Tooltip>
                  ),
                  value: 'crossFile',
                },
              ]}
              onChange={(val) =>
                onChange({
                  ...settings,
                  nupScope: val as NupScope,
                })
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
