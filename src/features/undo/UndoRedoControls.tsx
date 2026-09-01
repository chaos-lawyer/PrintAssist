import React from 'react';
import { Button, Tooltip, Space } from 'antd';
import { Undo2, Redo2 } from 'lucide-react';

export interface UndoRedoControlsProps {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
  onUndo: () => void;
  onRedo: () => void;
}

export function UndoRedoControls({
  canUndo,
  canRedo,
  undoLabel,
  redoLabel,
  onUndo,
  onRedo,
}: UndoRedoControlsProps) {
  const undoTitle = canUndo
    ? undoLabel
      ? `撤销：${undoLabel}（Ctrl+Z）`
      : '撤销（Ctrl+Z）'
    : '无操作可撤销（Ctrl+Z）';

  const redoTitle = canRedo
    ? redoLabel
      ? `重做：${redoLabel}（Ctrl+Y）`
      : '重做（Ctrl+Y）'
    : '无操作可重做（Ctrl+Y）';

  return (
    <Space size={6} className="header-undo-redo-group">
      <Tooltip title={undoTitle}>
        <Button
          type="text"
          className="header-history-btn header-undo-btn"
          icon={<Undo2 size={16} />}
          disabled={!canUndo}
          onClick={onUndo}
          aria-label={canUndo ? `撤销 ${undoLabel || ''}` : '撤销'}
        />
      </Tooltip>
      <Tooltip title={redoTitle}>
        <Button
          type="text"
          className="header-history-btn header-redo-btn"
          icon={<Redo2 size={16} />}
          disabled={!canRedo}
          onClick={onRedo}
          aria-label={canRedo ? `重做 ${redoLabel || ''}` : '重做'}
        />
      </Tooltip>
    </Space>
  );
}
