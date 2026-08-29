import {
  Button,
  Drawer,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { useEffect, useState } from 'react';
import type { QueueItem } from '../../domain/queueTypes';
import type { PaperSourceCapability } from '../../shared/contracts/printer';
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
  batchItems?: QueueItem[];
  globalSettings: PrintSettings;
  colorEnabled: boolean;
  duplexEnabled: boolean;
  onClose: () => void;
  onSave: (override: FileSettingsOverride) => void;
  onBatchSave?: (override: Partial<FileSettingsOverride>) => void;
}

export function FileSettingsDrawer({
  open,
  item,
  batchItems,
  globalSettings,
  colorEnabled,
  duplexEnabled,
  onClose,
  onSave,
  onBatchSave,
}: FileSettingsDrawerProps) {
  const isBatch = Boolean(batchItems && batchItems.length > 1);
  const [draftOverride, setDraftOverride] = useState<FileSettingsOverride>({});
  const [paperCapability, setPaperCapability] = useState<PaperSourceCapability | null>(null);
  const [loadingPaperSources, setLoadingPaperSources] = useState(false);

  useEffect(() => {
    if (!globalSettings.printerName) {
      setPaperCapability(null);
      return;
    }
    let cancelled = false;
    setLoadingPaperSources(true);
    void listPrinterPaperSources(globalSettings.printerName)
      .then((cap) => {
        if (!cancelled) {
          setPaperCapability(cap);
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
  }, [globalSettings.printerName]);

  // Synchronize draftOverride when opening or switching item
  useEffect(() => {
    if (open) {
      if (isBatch) {
        setDraftOverride({});
      } else if (item) {
        setDraftOverride(item.override ? { ...item.override } : {});
      }
    }
  }, [open, item, isBatch]);

  if (!open) {
    return null;
  }

  if (!isBatch && !item) {
    return null;
  }

  // Compute effective display values dynamically from globalSettings + draftOverride
  const effective = mergePrintSettings(globalSettings, draftOverride);

  // Field override flags
  const isColorOverridden = draftOverride.colorMode !== undefined;
  const isSidesOverridden =
    draftOverride.sidesMode !== undefined || draftOverride.flipMode !== undefined;
  const isCopiesOverridden = draftOverride.copies !== undefined;
  const isCollateOverridden = draftOverride.collate !== undefined;
  const isSourceOverridden =
    draftOverride.sourceCode !== undefined || draftOverride.sourceName !== undefined;
  const isScaleOverridden = draftOverride.scaleMode !== undefined;
  const isPageRangeOverridden = draftOverride.pageRange !== undefined;

  const totalOverriddenCount = [
    isColorOverridden,
    isSidesOverridden,
    isCopiesOverridden,
    isCollateOverridden,
    isSourceOverridden,
    isScaleOverridden,
    isPageRangeOverridden,
  ].filter(Boolean).length;

  const handleResetField = (
    field: 'color' | 'sides' | 'copies' | 'collate' | 'source' | 'scale' | 'pageRange',
  ) => {
    setDraftOverride((prev) => {
      const next = { ...prev };
      if (field === 'color') {
        delete next.colorMode;
      } else if (field === 'sides') {
        delete next.sidesMode;
        delete next.flipMode;
      } else if (field === 'copies') {
        delete next.copies;
      } else if (field === 'collate') {
        delete next.collate;
      } else if (field === 'source') {
        delete next.sourceCode;
        delete next.sourceName;
      } else if (field === 'scale') {
        delete next.scaleMode;
      } else if (field === 'pageRange') {
        delete next.pageRange;
      }
      return next;
    });
  };

  const handleResetAll = () => {
    setDraftOverride({});
    message.success(isBatch ? '已清空本次批量修改项' : '已全部恢复为跟随全局设置');
  };

  const handleSave = () => {
    if (draftOverride.pageRange) {
      const parseResult = parsePageRangeExpression(
        draftOverride.pageRange.expression,
        item?.pageCount ?? undefined,
      );
      if (!parseResult.ok) {
        message.error(parseResult.message);
        return;
      }
    }

    if (isBatch) {
      if (totalOverriddenCount === 0) {
        message.info('未修改任何配置');
        onClose();
        return;
      }
      onBatchSave?.(draftOverride);
      message.success(`已对 ${batchItems!.length} 个文件应用批量设置`);
    } else {
      onSave(draftOverride);
    }
    onClose();
  };

  const renderStatus = (isOverridden: boolean, onReset: () => void) => {
    if (isBatch) {
      if (!isOverridden) {
        return (
          <span className="field-status-inherit">
            保持文件原设置
          </span>
        );
      }
      return (
        <Space size={6} align="center">
          <Tag color="processing" bordered={false} className="field-status-tag">
            将批量应用
          </Tag>
          <Button
            type="link"
            size="small"
            className="field-reset-link"
            onClick={onReset}
          >
            撤销修改
          </Button>
        </Space>
      );
    }

    if (!isOverridden) {
      return (
        <span className="field-status-inherit">
          跟随全局
        </span>
      );
    }
    return (
      <Space size={6} align="center">
        <Tag color="processing" bordered={false} className="field-status-tag">
          已单独设置
        </Tag>
        <Button
          type="link"
          size="small"
          className="field-reset-link"
          onClick={onReset}
        >
          恢复为全局
        </Button>
      </Space>
    );
  };

  return (
    <Drawer
      title={isBatch ? `批量打印设置 (${batchItems!.length} 个文件)` : '单文件打印设置'}
      open={open}
      onClose={onClose}
      width={440}
      destroyOnClose
      className="file-settings-drawer"
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button
            danger
            type="link"
            size="small"
            style={{ padding: 0 }}
            disabled={totalOverriddenCount === 0}
            onClick={handleResetAll}
          >
            {isBatch ? '清空本次修改' : '全部恢复为全局设置'}
          </Button>
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" onClick={handleSave}>
              {isBatch ? `应用到 ${batchItems!.length} 个文件` : '保存设置'}
            </Button>
          </Space>
        </div>
      }
    >
      {isBatch ? (
        <div className="drawer-file-meta">
          <span className="drawer-file-meta-label">已选中批量文件 ({batchItems!.length})</span>
          <div
            style={{
              maxHeight: 70,
              overflowY: 'auto',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
              marginTop: 4,
            }}
          >
            {batchItems!.map((bItem) => (
              <Tag key={bItem.id} style={{ margin: 0 }}>
                {bItem.fileName}
              </Tag>
            ))}
          </div>
        </div>
      ) : item ? (
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
      ) : null}

      <Typography.Paragraph type="secondary" className="drawer-tip">
        {isBatch
          ? '仅修改需要批量调整的字段，未做修改的字段将继续保持各个文件原有的单独设置或全局设置。'
          : '直接修改字段即可为当前文件创建单独配置；未单独修改的选项始终跟随全局公共设置。'}
      </Typography.Paragraph>

      <div className="drawer-field">
        <div className="drawer-field-head">
          <Typography.Text strong>颜色</Typography.Text>
          {renderStatus(isColorOverridden, () => handleResetField('color'))}
        </div>
        <Radio.Group
          disabled={!colorEnabled}
          value={effective.colorMode}
          onChange={(event) => {
            const nextVal = event.target.value as ColorMode;
            setDraftOverride((prev) => ({ ...prev, colorMode: nextVal }));
          }}
        >
          <Radio.Button value="monochrome">黑白</Radio.Button>
          <Radio.Button value="color">彩色</Radio.Button>
        </Radio.Group>
        {!colorEnabled && (
          <Typography.Text type="secondary" className="field-hint">
            当前打印机不支持彩色打印
          </Typography.Text>
        )}
      </div>

      <div className="drawer-field">
        <div className="drawer-field-head">
          <Typography.Text strong>单双面与翻转</Typography.Text>
          {renderStatus(isSidesOverridden, () => handleResetField('sides'))}
        </div>
        <Radio.Group
          value={effective.sidesMode}
          onChange={(event) => {
            const nextSides = event.target.value as SidesMode;
            setDraftOverride((prev) => ({
              ...prev,
              sidesMode: nextSides,
              flipMode: prev.flipMode ?? effective.flipMode,
            }));
          }}
        >
          <Radio.Button value="simplex">单面</Radio.Button>
          <Radio.Button value="duplex" disabled={!duplexEnabled}>
            双面
          </Radio.Button>
        </Radio.Group>
        {effective.sidesMode === 'duplex' && duplexEnabled && (
          <Radio.Group
            className="drawer-secondary-group"
            value={effective.flipMode}
            onChange={(event) => {
              const nextFlip = event.target.value as FlipMode;
              setDraftOverride((prev) => ({
                ...prev,
                sidesMode: prev.sidesMode ?? effective.sidesMode,
                flipMode: nextFlip,
              }));
            }}
          >
            <Radio.Button value="longEdge">长边翻转</Radio.Button>
            <Radio.Button value="shortEdge">短边翻转</Radio.Button>
          </Radio.Group>
        )}
        {!duplexEnabled && (
          <Typography.Text type="secondary" className="field-hint">
            当前打印机不支持自动双面打印
          </Typography.Text>
        )}
      </div>

      <div className="drawer-field">
        <div className="drawer-field-head">
          <Typography.Text strong>打印份数</Typography.Text>
          {renderStatus(isCopiesOverridden, () => handleResetField('copies'))}
        </div>
        <InputNumber
          min={1}
          max={99}
          value={effective.copies}
          onChange={(value) => {
            const nextVal = typeof value === 'number' && value > 0 ? value : 1;
            setDraftOverride((prev) => ({ ...prev, copies: nextVal }));
          }}
        />
      </div>

      <div className="drawer-field">
        <div className="drawer-field-head">
          <Typography.Text strong>分发模式（多份打印）</Typography.Text>
          {renderStatus(isCollateOverridden, () => handleResetField('collate'))}
        </div>
        <Radio.Group
          value={effective.collate ? 'collated' : 'uncollated'}
          onChange={(event) => {
            const val = event.target.value === 'collated';
            setDraftOverride((prev) => ({ ...prev, collate: val }));
          }}
        >
          <Radio.Button value="collated">逐份出纸 (成套 1,2,3...)</Radio.Button>
          <Radio.Button value="uncollated">逐页出纸 (相同页堆叠)</Radio.Button>
        </Radio.Group>
      </div>

      {paperCapability?.status === 'available' && paperCapability.sources.length >= 1 && (
        <div className="drawer-field">
          <div className="drawer-field-head">
            <Typography.Text strong>纸盘</Typography.Text>
            {renderStatus(isSourceOverridden, () => handleResetField('source'))}
          </div>
          <select
            className="setting-custom-select"
            value={effective.sourceCode ?? -1}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (val === -1) {
                handleResetField('source');
              } else {
                const found = paperCapability.sources.find((s) => s.code === val);
                setDraftOverride((prev) => ({
                  ...prev,
                  sourceCode: val,
                  sourceName: found?.name,
                }));
              }
            }}
          >
            <option value={-1}>自动选择 / 默认纸盘</option>
            {paperCapability.sources.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="drawer-field">
        <div className="drawer-field-head">
          <Typography.Text strong>页面缩放</Typography.Text>
          {renderStatus(isScaleOverridden, () => handleResetField('scale'))}
        </div>
        <select
          className="setting-custom-select"
          value={effective.scaleMode ?? 'actualSize'}
          onChange={(e) => {
            const nextMode = e.target.value as PageScaleMode;
            setDraftOverride((prev) => ({ ...prev, scaleMode: nextMode }));
          }}
        >
          <option value="actualSize">实际大小 (100%)</option>
          <option value="shrinkOversized">仅缩小过大页</option>
          <option value="fitPrintable">适应可打印区域</option>
        </select>
      </div>

      <div className="drawer-field">
        <div className="drawer-field-head">
          <Typography.Text strong>页码范围</Typography.Text>
          {renderStatus(isPageRangeOverridden, () => handleResetField('pageRange'))}
        </div>
        <Input
          value={
            draftOverride.pageRange?.expression ??
            (effective.pageRange.mode === 'custom' ? effective.pageRange.expression : '')
          }
          placeholder="留空打印全部页，或输入如 1,3,5-8"
          onChange={(event) => {
            const val = event.target.value;
            if (!val.trim()) {
              handleResetField('pageRange');
            } else {
              setDraftOverride((prev) => ({
                ...prev,
                pageRange: { mode: 'custom', expression: val },
              }));
            }
          }}
        />
        <Typography.Text type="secondary" className="field-hint">
          直接输入页码（如 1,3,5-8）生效；清空文本框或点击“恢复为全局”即可打印全部页。
        </Typography.Text>
      </div>
    </Drawer>
  );
}
