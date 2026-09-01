// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { UndoRedoControls } from './UndoRedoControls';

describe('UndoRedoControls Component', () => {
  it('renders disabled buttons when history is empty', () => {
    render(
      <UndoRedoControls
        canUndo={false}
        canRedo={false}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
      />,
    );

    const undoBtn = screen.getByRole('button', { name: /撤销/ });
    const redoBtn = screen.getByRole('button', { name: /重做/ });

    expect(undoBtn.hasAttribute('disabled')).toBe(true);
    expect(redoBtn.hasAttribute('disabled')).toBe(true);
  });

  it('renders active undo button with dynamic operation label and triggers onUndo', () => {
    const handleUndo = vi.fn();
    const handleRedo = vi.fn();

    render(
      <UndoRedoControls
        canUndo={true}
        canRedo={false}
        undoLabel="移除 3 个文件"
        onUndo={handleUndo}
        onRedo={handleRedo}
      />,
    );

    const undoBtn = screen.getByRole('button', { name: /撤销 移除 3 个文件/ });
    expect(undoBtn.hasAttribute('disabled')).toBe(false);

    fireEvent.click(undoBtn);
    expect(handleUndo).toHaveBeenCalledTimes(1);
    expect(handleRedo).not.toHaveBeenCalled();
  });

  it('renders active redo button and triggers onRedo', () => {
    const handleUndo = vi.fn();
    const handleRedo = vi.fn();

    render(
      <UndoRedoControls
        canUndo={false}
        canRedo={true}
        redoLabel="清空 10 个文件"
        onUndo={handleUndo}
        onRedo={handleRedo}
      />,
    );

    const redoBtn = screen.getByRole('button', { name: /重做 清空 10 个文件/ });
    expect(redoBtn.hasAttribute('disabled')).toBe(false);

    fireEvent.click(redoBtn);
    expect(handleRedo).toHaveBeenCalledTimes(1);
  });
});
