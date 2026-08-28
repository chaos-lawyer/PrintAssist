import { Button, Drawer, Input, InputNumber, Radio, Select, Space, Switch, Tooltip, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import type { QueueItem } from '../../domain/queueTypes';
import type { PaperSourceOption } from '../../shared/contracts/printer';
import { listPrinterPaperSources } from '../../api/nativeBridge';
import type {
  ColorMode,
  FileSettingsOverride,
  FlipMode,
  PageScaleMode,
  PrintSettings,
  SidesMode,
} from '../../domain/printSettings';
import { mergePrintSettings } from '../../domain/printSettings';
import { parsePageRangeExpression } from '../../domain/pageRange';

interface FileSettingsDrawerProps {
  open: boolean;
  item: QueueItem | null;
  globalSettings: PrintSettings;
  colorEnabled: boolean;
  duplexEnabled: boolean;
  onClose: () => void;
  onSave: (override: FileSettingsOverride) => void;
}

export function FileSettingsDrawer({
  open,
  item,
  globalSettings,
  colorEnabled,
  duplexEnabled,
  onClose,
  onSave,
}: FileSettingsDrawerProps) {
  const [useCustomColor, setUseCustomColor] = useState(false);
  const [useCustomSides, setUseCustomSides] = useState(false);
  const [useCustomCopies, setUseCustomCopies] = useState(false);
  const [useCustomSource, setUseCustomSource] = useState(false);
  const [useCustomScale, setUseCustomScale] = useState(false);
  const [useCustomPages, setUseCustomPages] = useState(false);
  const [colorMode, setColorMode] = useState<ColorMode>('monochrome');
  const [sidesMode, setSidesMode] = useState<SidesMode>('simplex');
  const [flipMode, setFlipMode] = useState<FlipMode>('longEdge');
  const [copies, setCopies] = useState(1);
  const [sourceCode, setSourceCode] = useState<number | undefined>(undefined);
  const [sourceName, setSourceName] = useState<string | undefined>(undefined);
  const [scaleMode, setScaleMode] = useState<PageScaleMode>('actualSize');
  const [paperSources, setPaperSources] = useState<PaperSourceOption[]>([]);
  const [loadingPaperSources, setLoadingPaperSources] = useState(false);
  const [pageExpression, setPageExpression] = useState('1,3,5-8');

  useEffect(() => {
    if (!globalSettings.printerName) {
      setPaperSources([]);
      return;
    }
    let cancelled = false;
    setLoadingPaperSources(true);
    void listPrinterPaperSources(globalSettings.printerName)
      .then((sources) => {
        if (!cancelled) {
          setPaperSources(sources);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPaperSources([]);
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
  }, [globalSettings.printerName]);

  useEffect(() => {
    if (!item) {
      return;
    }
    const merged = mergePrintSettings(globalSettings, item.override);
    setUseCustomColor(item.override.colorMode !== undefined);
    setUseCustomSides(item.override.sidesMode !== undefined || item.override.flipMode !== undefined);
    setUseCustomCopies(item.override.copies !== undefined);
    setUseCustomSource(item.override.sourceCode !== undefined);
    setUseCustomScale(item.override.scaleMode !== undefined);
    setUseCustomPages(item.override.pageRange !== undefined);
    setColorMode(merged.colorMode);
    setSidesMode(merged.sidesMode);
    setFlipMode(merged.flipMode);
    setCopies(merged.copies);
    setSourceCode(merged.sourceCode);
    setSourceName(merged.sourceName);
    setScaleMode(merged.scaleMode ?? 'actualSize');
    setPageExpression(
      item.override.pageRange?.expression ||
        (merged.pageRange.mode === 'custom' ? merged.pageRange.expression : '1,3,5-8'),
    );
  }, [item, globalSettings]);

  const handleSave = () => {
    if (!item) {
      return;
    }

    const nextOverride: FileSettingsOverride = {};

    if (useCustomColor) {
      nextOverride.colorMode = colorMode;
    }
    if (useCustomSides) {
      nextOverride.sidesMode = sidesMode;
      nextOverride.flipMode = flipMode;
    }
    if (useCustomCopies) {
      nextOverride.copies = copies;
    }
    if (useCustomSource) {
      nextOverride.sourceCode = sourceCode;
      nextOverride.sourceName = sourceName;
    }
    if (useCustomScale) {
      nextOverride.scaleMode = scaleMode;
    }
    if (useCustomPages) {
      const parseResult = parsePageRangeExpression(
        pageExpression,
        item.pageCount ?? undefined,
      );
      if (!parseResult.ok) {
        message.error(parseResult.message);
        return;
      }
      nextOverride.pageRange = {
        mode: 'custom',
        expression: pageExpression.trim(),
      };
    }

    onSave(nextOverride);
    onClose();
  };

  return (
    <Drawer
      title="单文件设置"
      open={open}
      onClose={onClose}
      width={420}
      destroyOnClose
      className="file-settings-drawer"
      extra={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" onClick={handleSave}>保存</Button>
        </Space>
      }
    >
      {item && (
        <div className="drawer-file-meta">
          <span className="drawer-file-meta-label">当前文件</span>
          <Tooltip title={item.fileName} placement="bottomLeft">
            <div className="drawer-file-name" title={item.fileName}>
              {item.fileName}
            </div>
          </Tooltip>
          {item.path && item.path !== item.fileName && (
            <Tooltip title={item.path} placement="bottomLeft">
              <div className="drawer-file-path" title={item.path}>
                {item.path}
              </div>
            </Tooltip>
          )}
        </div>
      )}

      <Typography.Paragraph type="secondary">
        未开启覆盖的选项将继承公共默认值。页码范围仅作用于当前文件。
      </Typography.Paragraph>

      <div className="drawer-field">
        <div className="drawer-field-head">
          <Typography.Text strong>颜色</Typography.Text>
          <Switch checked={useCustomColor} onChange={setUseCustomColor} />
        </div>
        <Radio.Group
          disabled={!useCustomColor || !colorEnabled}
          value={colorMode}
          onChange={(event) => setColorMode(event.target.value as ColorMode)}
        >
          <Radio.Button value="monochrome">黑白</Radio.Button>
          <Radio.Button value="color">彩色</Radio.Button>
        </Radio.Group>
      </div>

      <div className="drawer-field">
        <div className="drawer-field-head">
          <Typography.Text strong>单双面与翻转</Typography.Text>
          <Switch checked={useCustomSides} onChange={setUseCustomSides} />
        </div>
        <Radio.Group
          disabled={!useCustomSides}
          value={sidesMode}
          onChange={(event) => setSidesMode(event.target.value as SidesMode)}
        >
          <Radio.Button value="simplex">单面</Radio.Button>
          <Radio.Button value="duplex" disabled={!duplexEnabled}>双面</Radio.Button>
        </Radio.Group>
        <Radio.Group
          className="drawer-secondary-group"
          disabled={!useCustomSides || sidesMode !== 'duplex' || !duplexEnabled}
          value={flipMode}
          onChange={(event) => setFlipMode(event.target.value as FlipMode)}
        >
          <Radio.Button value="longEdge">长边翻转</Radio.Button>
          <Radio.Button value="shortEdge">短边翻转</Radio.Button>
        </Radio.Group>
      </div>

      <div className="drawer-field">
        <div className="drawer-field-head">
          <Typography.Text strong>打印份数</Typography.Text>
          <Switch checked={useCustomCopies} onChange={setUseCustomCopies} />
        </div>
        <InputNumber
          min={1}
          max={99}
          disabled={!useCustomCopies}
          value={copies}
          onChange={(value) => setCopies(typeof value === 'number' && value > 0 ? value : 1)}
        />
      </div>

      <div className="drawer-field">
        <div className="drawer-field-head">
          <Typography.Text strong>纸盘</Typography.Text>
          <Switch checked={useCustomSource} onChange={setUseCustomSource} />
        </div>
        <Select
          style={{ width: '100%' }}
          disabled={!useCustomSource}
          loading={loadingPaperSources}
          placeholder="自动选择"
          value={sourceCode ?? -1}
          onChange={(val) => {
            if (val === -1) {
              setSourceCode(undefined);
              setSourceName(undefined);
            } else {
              const found = paperSources.find((s) => s.code === val);
              setSourceCode(val);
              setSourceName(found?.name);
            }
          }}
          options={[
            { label: '自动选择 / 默认纸盘', value: -1 },
            ...paperSources.map((s) => ({
              label: s.name,
              value: s.code,
            })),
          ]}
        />
      </div>

      <div className="drawer-field">
        <div className="drawer-field-head">
          <Typography.Text strong>页面缩放</Typography.Text>
          <Switch checked={useCustomScale} onChange={setUseCustomScale} />
        </div>
        <Select
          style={{ width: '100%' }}
          disabled={!useCustomScale}
          value={scaleMode}
          onChange={(val) => setScaleMode(val as PageScaleMode)}
          options={[
            { label: '实际大小 (100%)', value: 'actualSize' },
            { label: '仅缩小过大页', value: 'shrinkOversized' },
            { label: '适应可打印区域', value: 'fitPrintable' },
          ]}
        />
      </div>

      <div className="drawer-field">
        <div className="drawer-field-head">
          <Typography.Text strong>页码范围</Typography.Text>
          <Switch checked={useCustomPages} onChange={setUseCustomPages} />
        </div>
        <Input
          disabled={!useCustomPages}
          value={pageExpression}
          placeholder="例如 1,3,5-8"
          onChange={(event) => setPageExpression(event.target.value)}
        />
        <Typography.Text type="secondary" className="field-hint">
          关闭后打印全部页；开启后支持逗号与连续区间。
        </Typography.Text>
      </div>
    </Drawer>
  );
}
